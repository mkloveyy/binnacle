import { describe, expect, mock, test } from 'claude-code/testing'
import type { BinnacleActivitySession } from '../types'
import { append, bump, newSession } from '../hooks/modules/activity/events.ts'
import { liveRows } from '../hooks/modules/activity/derive.ts'
import { files, home } from './files.ts'

const T0 = 100_000
const base = (): BinnacleActivitySession => append(newSession('s1', 0, '/repo'), { at: T0, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
const start = (s: BinnacleActivitySession, agentId: string, at: number, background = false) =>
  append(s, { at, turnId: 't1', agentId, kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'find store writes', parentAgentId: null, background })
const ASK = { toolUseId: 'u1', agentId: 'a1', tool: 'Bash', summary: 'rm -rf /tmp/x', decision: 'ask' as const, decider: 'unknown' as const, at: T0 + 10_000 }

describe('liveRows', () => {
  test('a running agent with its steps', () => {
    let s = start(base(), 'a1', T0 + 1_000)
    s = bump(bump(s, 't1', 'a1', 'Bash'), 't1', 'a1', 'Read')
    expect(liveRows(s, [], T0 + 63_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([{ text: '● Explore · find store writes · 1m02s · 2 steps', color: 'blue' }])
  })
  test('an ask open for 3 seconds or more replaces the running row', () => {
    const s = start(base(), 'a1', T0 + 1_000)
    expect(liveRows(s, [ASK], T0 + 12_000, 0)[0]?.text.startsWith('●')).toBe(true)
    expect(liveRows(s, [ASK], T0 + 20_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([{ text: '⏸ Explore · approval? rm -rf /tmp/x · 10s', color: 'yellow' }])
    expect(liveRows(s, [{ ...ASK, agentId: null }], T0 + 20_000, 0)[0]?.text.startsWith('●')).toBe(true)
  })
  test('a background agent that finished shows until the next turn starts', () => {
    let s = start(base(), 'a1', T0 + 1_000, true)
    s = append(s, { at: T0 + 5_000, turnId: 't1', agentId: 'a1', kind: 'agent-end', durationMs: 4_000, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
    expect(liveRows(s, [], T0 + 30_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([{ text: '✓ Explore · find store writes · done 25s ago', color: 'green' }])
    s = append(s, { at: T0 + 40_000, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'next' })
    expect(liveRows(s, [], T0 + 41_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([])
  })
  test("a finished background agent and this turn's denials stay through the turn Claude Code starts to hand the report back", () => {
    let s = start(base(), 'a1', T0 + 1_000, true)
    s = append(s, { at: T0 + 4_000, turnId: 't1', agentId: 'a1', kind: 'perm', tool: 'Bash', summary: 'mkdir x', decision: 'ask', decider: 'user', outcome: 'denied-by-user' })
    s = append(s, { at: T0 + 5_000, turnId: 't1', agentId: 'a1', kind: 'agent-end', durationMs: 4_000, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
    // 2.1.296 starts the hand-back turn about 150 ms after the agent ends (e2e 2026-10-12, row 20).
    s = append(s, { at: T0 + 5_150, turnId: 't2', agentId: null, kind: 'turn-start', prompt: '<task-notification> …', auto: true })
    expect(liveRows(s, [], T0 + 30_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([
      { text: '✓ Explore · find store writes · done 25s ago', color: 'green' },
      { text: '✗ 1 denied this turn', color: 'red' },
    ])
    s = append(s, { at: T0 + 40_000, turnId: 't3', agentId: null, kind: 'turn-start', prompt: 'next' })
    expect(liveRows(s, [], T0 + 41_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([])
  })
  test('a record with no turn the person started (a relay worker, a session begun by a hand-back) counts from its newest turn', () => {
    let s = append(newSession('s1', 0, '/repo'), { at: T0, turnId: 't1', agentId: null, kind: 'turn-start', prompt: '<task-notification>', auto: true })
    s = append(s, { at: T0 + 1, turnId: 't1', agentId: null, kind: 'error', tool: 'Bash', summary: 'w', message: 'boom' })
    expect(liveRows(s, [], T0 + 10, 0).map(({ text, color }) => ({ text, color }))).toEqual([{ text: '✗ 1 error this turn', color: 'red' }])
    s = append(s, { at: T0 + 20, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'from a peer', auto: true })
    expect(liveRows(s, [], T0 + 30, 0).map(({ text, color }) => ({ text, color }))).toEqual([])
  })
  test('denials and errors of this turn are summed in one row', () => {
    let s = base()
    s = append(s, { at: T0 + 1, turnId: 't1', agentId: null, kind: 'guard', ruleId: 'r', action: 'deny', summary: 'x' })
    s = append(s, { at: T0 + 2, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: 'y', decision: 'ask', decider: 'user', outcome: 'denied-by-user' })
    s = append(s, { at: T0 + 3, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: 'z', decision: 'ask', decider: 'unknown', outcome: 'approved' })
    s = append(s, { at: T0 + 4, turnId: 't1', agentId: null, kind: 'error', tool: 'Bash', summary: 'w', message: 'boom' })
    expect(liveRows(s, [], T0 + 10, 0).map(({ text, color }) => ({ text, color }))).toEqual([{ text: '✗ 2 denied · 1 error this turn', color: 'red' }])
  })
  test('at most five rows', () => {
    let s = base()
    for (let i = 0; i < 7; i++) s = start(s, `a${i}`, T0 + i)
    const rows = liveRows(s, [], T0 + 1_000, 0)
    expect(rows).toHaveLength(5)
    expect(rows[4]?.text).toBe('… and 3 more')
  })
  test('a foreground agent whose turn has ended is not running', () => {
    let s = start(base(), 'a1', T0 + 1_000)
    s = append(s, { at: T0 + 9_000, turnId: 't1', agentId: null, kind: 'turn-end', durationMs: 9_000, costUsd: null, aborted: true })
    expect(liveRows(s, [], T0 + 10_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([])
    expect(liveRows(start(s, 'a2', T0 + 2_000, true), [], T0 + 10_000, 0).map(({ text, color }) => ({ text, color }))).toEqual([{ text: '● Explore · find store writes · 8s · 0 steps', color: 'blue' }])
  })
  test('agents from before this process started are not shown as running', () => {
    expect(liveRows(start(base(), 'a1', T0 + 1_000), [], T0 + 5_000, T0 + 2_000).map(({ text, color }) => ({ text, color }))).toEqual([])
    expect(liveRows(null, [], 0, 0).map(({ text, color }) => ({ text, color }))).toEqual([])
  })
})

const ABOVE = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} } }
const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
/** What the host draws beneath the plugins: an empty column. */
const HOST = () => Fragment({})
const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'p', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}

test('nothing is drawn above the prompt: no agent rows there', async ($, on) => {
  mock.clock(on)
  on('ui.render', HOST)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.check', () => ({ decision: 'deny', rule: 'Bash(rm:*)' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'denied' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'tu1' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...ABOVE })
  expect(await ui.find({ type: 'Text', text: /[●✓✗⏸]/ })).toBeUndefined()
  await ui.unmount()
})

test('a resumed agent that never ended is not shown as running in the Agents tab; one started in this process is', async ($, on) => {
  mock.clock(on, { now: 50_000 })
  // The saved record began before the old agent did, so only this process's start time hides it.
  files(on).seed('s1', {
    version: 1, sessionId: 's1', startedAt: 1_000, endedAt: 2_000, cwd: '/repo', firstPrompt: 'go', counts: [],
    events: [
      { at: 1_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' },
      { at: 1_500, turnId: 't1', agentId: 'old', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'old task', parentAgentId: null, background: false },
    ],
  })
  home(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /^ ● .*old task/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /old task\s+—\s+0 steps\s+unfinished/ })).toBeDefined()
  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.agent.spawn(SPAWN)
  await ui.redraw(PANE.props)
  expect(await ui.find({ type: 'Text', text: /^ ● Explore\s+find store writes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ ● .*old task/ })).toBeUndefined()
  await ui.unmount()
})

test('a clock that fails at session start still registers /binnacle', async ($, on) => {
  on('clock.now', () => ({ deny: 'no clock' }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => { registered.push(e.name); return { value: { command: e.name } } })
  const logs: string[] = []
  on('ui.log', (_$, e) => { logs.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['binnacle'])
  expect(logs).toEqual([expect.stringContaining('binnacle: activity recording failed (')])
})

test('without the band no timer runs while nothing is open', async ($, on) => {
  const clock = mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.check', () => ({ decision: 'ask', reason: 'needs approval' }))
  const redraws = { n: 0 }
  on('ui.invalidate', () => { redraws.n++; return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1', agentId: 'a1' })
  // The one-off background read of the compaction history (B10) runs at once and redraws once; it is no timer.
  await clock.settle()
  redraws.n = 0
  // The status line's own 15-second clock is the only one left.
  await clock.advance(14_000)
  expect(redraws.n).toBe(0)
})
