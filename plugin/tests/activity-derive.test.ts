import { describe, expect, test } from 'claude-code/testing'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { AUTO_SETTLED_MS, awaitsApproval, guardEntries, lastReceipt, liveRows } from '../hooks/modules/activity/derive.ts'

describe('views derived from the event stream', () => {
  test('guard entries keep the v0.1 shape, newest 50', () => {
    let s = newSession('s1', 0, '/w')
    for (let i = 0; i < 55; i++) s = append(s, { at: i, turnId: 't1', agentId: null, kind: 'guard', ruleId: 'r', action: 'deny', summary: `c${i}` })
    const log = guardEntries(s)
    expect(log).toHaveLength(50)
    expect(log[0]).toEqual({ at: 5, ruleId: 'r', action: 'deny', summary: 'c5' })
    expect(guardEntries(null)).toEqual([])
  })
  test('the last turn receipt counts agents, edits and errors of that turn', () => {
    let s = newSession('s1', 0, '/w')
    s = append(s, { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'p' })
    s = append(s, { at: 2, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 't', parentAgentId: null, background: false })
    s = append(s, { at: 3, turnId: 't1', agentId: null, kind: 'edit', tool: 'Edit', file: '/w/a', added: 1, removed: 0 })
    s = append(s, { at: 4, turnId: 't1', agentId: 'a1', kind: 'error', tool: 'Bash', summary: 'x', message: 'boom' })
    s = append(s, { at: 5, turnId: 't1', agentId: null, kind: 'turn-end', durationMs: 19_000, costUsd: 0.08, aborted: false })
    expect(lastReceipt(s)).toEqual({ durationMs: 19_000, agents: 1, edits: 1, errors: 1, costDelta: 0.08 })
    expect(lastReceipt(newSession('s2', 0, '/w'))).toBeNull()
  })
})

describe('awaiting approval (no API says when an ask is settled)', () => {
  const ask = { toolUseId: 'q', agentId: 'a1', tool: 'Bash', summary: 'ping -c 90 127.0.0.1', decision: 'ask' as const, decider: 'unknown' as const, at: 0 }
  test('an ask waits after ASK_AFTER_MS; in auto mode the classifier has settled it by AUTO_SETTLED_MS and the call runs', () => {
    expect(awaitsApproval(ask, 2_999, false)).toBe(false)
    expect(awaitsApproval(ask, 3_000, false)).toBe(true)
    expect(awaitsApproval(ask, 10 * AUTO_SETTLED_MS, false)).toBe(true)
    expect(awaitsApproval(ask, 3_000, true)).toBe(true)
    expect(awaitsApproval(ask, AUTO_SETTLED_MS, true)).toBe(false)
    expect(awaitsApproval({ ...ask, decision: 'deny' }, 5_000, false)).toBe(false)
  })
  test("the Agents tab's live row: approval? while it waits, running once auto mode has settled it", () => {
    const s = append(append(newSession('s', 0, '/r'), { at: 0, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' }),
      { at: 0, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'ping', parentAgentId: null, background: true })
    expect(liveRows(s, [ask], 20_000, 0, 5, false)[0]?.text).toMatch(/^⏸ Explore · approval\?/)
    expect(liveRows(s, [ask], 20_000, 0, 5, true)[0]?.text).toMatch(/^● Explore/)
  })
})
