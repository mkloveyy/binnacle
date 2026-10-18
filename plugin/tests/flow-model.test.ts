import { describe, expect, test } from 'claude-code/testing'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { callEnded, callStarted, emptyLive, tallyCheck } from '../hooks/modules/flow/live.ts'
import { flowView, moving, runningAgents } from '../hooks/modules/flow/model.ts'

type S = ReturnType<typeof newSession>
const turn = (s: S, at: number, turnId: string, prompt: string) => append(s, { at, turnId, agentId: null, kind: 'turn-start', prompt })
const spawn = (s: S, at: number, turnId: string, agentId: string, parent: string | null = null, background = false) =>
  append(s, { at, turnId, agentId, kind: 'agent-start', agentType: `T-${agentId}`, model: 'm', task: `task ${agentId}`, parentAgentId: parent, background })
const end = (s: S, at: number, turnId: string, agentId: string, aborted = false) =>
  append(s, { at, turnId, agentId, kind: 'agent-end', durationMs: 1, tokensIn: 1, tokensOut: 1, aborted, report: [] })

describe('flowView', () => {
  test('this turn: its number and prompt, main calls, the agents main spawned with their own calls', () => {
    let s = turn(newSession('s', 0, '/r'), 10, 't1', 'first')
    s = turn(s, 100, 't2', 'second')
    s = spawn(s, 110, 't2', 'a1')
    s = spawn(s, 120, 't2', 'a2')
    s = spawn(s, 130, 't2', 'g1', 'a1')
    s = end(s, 150, 't2', 'a2')
    let l = callStarted(emptyLive(), { id: 'm1', agentId: null, tool: 'Bash', summary: 'ls', startedAt: 101 })
    l = callStarted(l, { id: 'x1', agentId: 'a1', tool: 'Grep', summary: 'store', startedAt: 140 })
    const v = flowView(s, l, [], 200, 0, null)
    expect(v.turn).toEqual({ n: 2, prompt: 'second', at: 100, endedAt: null })
    expect(v.mainCalls.map(c => c.id)).toEqual(['m1'])
    expect(v.agents.map(a => [a.agentId, a.running])).toEqual([['a1', true], ['a2', false]])
    expect(v.agents[0]?.calls.map(c => c.id)).toEqual(['x1'])
    expect(v.agents[0]?.children).toEqual([{ type: 'T-g1', running: true, at: 130 }])
  })
  test('an agent from before this process is not running; a background one still running from an earlier turn is shown', () => {
    let s = turn(newSession('s', 0, '/r'), 10, 't1', 'old')
    s = spawn(s, 20, 't1', 'ghost')
    s = spawn(s, 60, 't1', 'bg', null, true)
    s = turn(s, 100, 't2', 'now')
    const v = flowView(s, emptyLive(), [], 200, 50, null)
    expect(v.agents.map(a => a.agentId)).toEqual(['bg'])
    expect(runningAgents(s, 50)).toBe(1)
  })
  test("the footer's count is the agents drawn as cards: one an agent spawned is not counted", () => {
    let s = turn(newSession('s', 0, '/r'), 10, 't1', 'go')
    s = spawn(s, 20, 't1', 'a1')
    s = spawn(s, 30, 't1', 'g1', 'a1')
    expect(runningAgents(s, 0)).toBe(1)
  })
  test("an agent team's teammate is not drawn as a card nor counted: it runs in its own pane and reports no end", () => {
    let s = turn(newSession('s', 0, '/r'), 10, 't1', 'go')
    s = spawn(s, 20, 't1', 'a1')
    s = append(s, { at: 30, turnId: 't1', agentId: 'm1', kind: 'agent-start', agentType: 'general', model: 'm', task: 'teammate', parentAgentId: null, background: true, teammate: true })
    expect(flowView(s, emptyLive(), [], 100, 0, null).agents.map(a => a.agentId)).toEqual(['a1'])
    expect(runningAgents(s, 0)).toBe(1)
  })
  test('waiting asks are those past ASK_AFTER_MS; anomalies flag their cards; moving says when to redraw', () => {
    let s = turn(newSession('s', 0, '/r'), 0, 't1', 'go')
    s = spawn(s, 10, 't1', 'a1')
    let l = emptyLive()
    for (const id of ['e1', 'e2']) l = callEnded(callStarted(l, { id, agentId: 'a1', tool: 'Read', summary: 'f', startedAt: 20 }), id, 30, 'error', 'ENOENT')
    const ask = { toolUseId: 'q', agentId: null, tool: 'Bash', summary: 'git push --force', decision: 'ask' as const, decider: 'unknown' as const, at: 1_000 }
    const v = flowView(s, tallyCheck(l, 'allow', 'rule', false), [ask], 3_999, 0, 85)
    expect(v.waiting).toEqual([])
    const w = flowView(s, l, [ask], 4_000, 0, 85)
    expect(w.waiting).toEqual([{ tool: 'Bash', summary: 'git push --force', at: 1_000 }])
    expect(w.agents[0]?.flags).toEqual(['same error ×2 · ENOENT'])
    expect(w.mainFlags).toEqual(['context 85% · compaction near'])
    expect(moving(w)).toBe(true)
    // In auto mode an ask past AUTO_SETTLED_MS was settled by the classifier: its call runs, nothing waits.
    expect(flowView(s, l, [ask], 1_000 + 15_000, 0, 85, true).waiting).toEqual([])
    expect(v.tally.allowRules).toBe(1)
  })
  test('the log: calls, spawns, agent ends and denials of this turn, newest first', () => {
    let s = turn(newSession('s', 0, '/r'), 0, 't1', 'go')
    s = spawn(s, 10, 't1', 'a1')
    s = end(s, 40, 't1', 'a1', true)
    s = append(s, { at: 50, turnId: 't1', agentId: null, kind: 'guard', ruleId: 'git.force-push', action: 'deny', summary: 'git push --force' })
    const l = callEnded(callStarted(emptyLive(), { id: 'c', agentId: null, tool: 'Bash', summary: 'ls', startedAt: 30 }), 'c', 31, 'ok')
    const v = flowView(s, l, [], 60, 0, null)
    expect(v.log.map(x => [x.at, x.who, x.mark, x.text])).toEqual([
      [50, 'guard', 'failed', 'denied git push --force · git.force-push'],
      [40, 'T-a1', 'failed', 'aborted'],
      [30, 'main', 'done', 'Bash ls'],
      [10, 'main', 'spawn', 'spawned T-a1'],
    ])
  })
  test('no session: idle, nothing moves', () => {
    const v = flowView(null, emptyLive(), [], 0, 0, null)
    expect(v.turn).toBeNull()
    expect(moving(v)).toBe(false)
  })
})
