import { describe, expect, test } from 'claude-code/testing'
import { ALL, PER_AGENT, QUIET_MS, anomalies, callEnded, callSummary, callStarted, callsOf, emptyLive, endRunning, newTurn, outcomeOf, tallyAsk, tallyCheck, tallyGuard } from '../hooks/modules/flow/live.ts'

const start = (l: ReturnType<typeof emptyLive>, id: string, agentId: string | null, at: number, tool = 'Bash') =>
  callStarted(l, { id, agentId, tool, summary: `cmd ${id}`, startedAt: at })

describe('call buffer', () => {
  test('a call runs, then ends with its outcome; the newest come first', () => {
    let l = start(emptyLive(), 'c1', null, 1)
    l = start(l, 'c2', null, 2)
    expect(callsOf(l, null, 3).map(c => [c.id, c.outcome])).toEqual([['c2', 'running'], ['c1', 'running']])
    l = callEnded(l, 'c1', 5, 'error', 'ENOENT x')
    expect(callsOf(l, null, 3)[1]).toMatchObject({ id: 'c1', outcome: 'error', endedAt: 5, error: 'ENOENT x' })
  })
  test('per agent at most PER_AGENT, in all at most ALL, the oldest dropped', () => {
    let l = emptyLive()
    for (let i = 0; i < PER_AGENT + 5; i++) l = start(l, `m${i}`, null, i)
    expect(callsOf(l, null, 100)).toHaveLength(PER_AGENT)
    expect(callsOf(l, null, 100).at(-1)?.id).toBe('m5')
    for (let a = 0; a < 5; a++) for (let i = 0; i < 15; i++) l = start(l, `a${a}-${i}`, `a${a}`, 100 + a * 20 + i)
    expect(l.calls.length).toBe(ALL)
  })
  test('the same id started twice is one call', () => {
    const l = start(start(emptyLive(), 'c1', null, 1), 'c1', null, 2)
    expect(l.calls).toHaveLength(1)
  })
  test('a new turn keeps the calls of agents still running (a background agent carries on), drops the rest', () => {
    let l = start(start(start(emptyLive(), 'm', null, 1), 'b1', 'bg', 2), 'x1', 'done', 3)
    l = newTurn(l, new Set(['bg']))
    expect(l.calls.map(c => c.id)).toEqual(['b1'])
    expect(anomalies(l, [{ agentId: 'bg', at: 0 }], 10 * QUIET_MS, null)).toEqual([])
  })
  test("when a loop ends, its calls still running end too, with no error text (so they are never 'the same error')", () => {
    let l = start(start(start(emptyLive(), 'm1', null, 1), 'm2', null, 2), 'a1', 'a', 3)
    l = endRunning(endRunning(l, null, 10), null, 11)
    expect(l.calls.map(c => [c.id, c.outcome, c.endedAt])).toEqual([['m1', 'error', 10], ['m2', 'error', 10], ['a1', 'running', null]])
    expect(anomalies(l, [], 20, null)).toEqual([])
  })
  test('a turn the person starts empties the calls and the tally', () => {
    const l = newTurn(tallyGuard(start(emptyLive(), 'c1', null, 1)))
    expect(l.calls).toEqual([])
    expect(l.tally.denyGuard).toBe(0)
  })
})

describe('outcomes', () => {
  test('a refusal is denied; an asked call refused in its dialog is denied; another failure is an error', () => {
    expect(outcomeOf({ deny: 'binnacle: no' }, false)).toBe('denied')
    expect(outcomeOf({ isError: true, text: "The user doesn't want to proceed with this tool use" }, true)).toBe('denied')
    expect(outcomeOf({ isError: true, text: 'boom' }, true)).toBe('error')
    expect(outcomeOf({ isError: true, text: 'boom' }, false)).toBe('error')
    expect(outcomeOf({}, false)).toBe('ok')
  })
})

describe('tally', () => {
  test('checks by who decided; asks by how they ended; the guard', () => {
    let l = emptyLive()
    l = tallyCheck(l, 'allow', 'rule', false)
    l = tallyCheck(l, 'allow', 'hook', false)
    l = tallyCheck(l, 'allow', 'other', false)
    l = tallyCheck(l, 'deny', 'rule', false)
    l = tallyCheck(l, 'deny', 'hook', false)
    l = tallyCheck(l, 'deny', 'hook', true)
    l = tallyCheck(l, 'deny', 'other', false)
    l = tallyCheck(l, 'ask', 'other', false)
    l = tallyAsk(l, 'approved')
    l = tallyAsk(l, 'denied-by-user')
    l = tallyAsk(l, 'denied-by-classifier')
    l = tallyAsk(l, 'denied-by-hook')
    l = tallyAsk(l, 'unknown')
    l = tallyGuard(l)
    // An ask that ended as neither approved nor refused (`unknown`: the tool failed after the approval) was approved.
    expect(l.tally).toEqual({ allowRules: 1, allowHook: 1, allowAuto: 1, askApproved: 2, askDeniedYou: 1, askDeniedAuto: 1, askDeniedHook: 1, denyRules: 1, denyHook: 1, denyAuto: 1, denyGuard: 2 })
  })
})

describe('anomalies', () => {
  test('the same error twice in one agent', () => {
    let l = emptyLive()
    for (const id of ['e1', 'e2']) l = callEnded(start(l, id, 'a1', 1, 'Read'), id, 2, 'error', 'ENOENT hooks/store.ts')
    expect(anomalies(l, [], 3, null)).toEqual([{ agentId: 'a1', text: 'same error ×2 · ENOENT hooks/store.ts' }])
    // One error only, or the same text from another tool: nothing.
    const one = callEnded(start(emptyLive(), 'e1', 'a1', 1, 'Read'), 'e1', 2, 'error', 'x')
    expect(anomalies(callEnded(start(one, 'e2', 'a1', 1, 'Grep'), 'e2', 2, 'error', 'x'), [], 3, null)).toEqual([])
  })
  test('the last two calls of an agent denied', () => {
    let l = emptyLive()
    for (const id of ['d1', 'd2']) l = callEnded(start(l, id, null, 1), id, 2, 'denied')
    expect(anomalies(l, [], 3, null)).toEqual([{ agentId: null, text: 'denied ×2 in a row' }])
    expect(anomalies(callEnded(start(l, 'ok', null, 3), 'ok', 4, 'ok'), [], 5, null)).toEqual([])
  })
  test('a running agent quiet for QUIET_MS, not one with a call still running', () => {
    const l = callEnded(start(emptyLive(), 'c1', 'a1', 1_000), 'c1', 2_000, 'ok')
    expect(anomalies(l, [{ agentId: 'a1', at: 0 }], 2_000 + QUIET_MS, null)).toEqual([{ agentId: 'a1', text: 'quiet 2m00s' }])
    expect(anomalies(l, [{ agentId: 'a1', at: 0 }], 2_000 + QUIET_MS - 1, null)).toEqual([])
    expect(anomalies(start(l, 'c2', 'a1', 3_000), [{ agentId: 'a1', at: 0 }], 10 * QUIET_MS, null)).toEqual([])
    // No call at all: quiet since it started.
    expect(anomalies(emptyLive(), [{ agentId: 'a2', at: 0 }], QUIET_MS, null)).toEqual([{ agentId: 'a2', text: 'quiet 2m00s' }])
  })
  test('context from 80%', () => {
    expect(anomalies(emptyLive(), [], 0, 79.9)).toEqual([])
    expect(anomalies(emptyLive(), [], 0, 82.4)).toEqual([{ agentId: null, text: 'context 82% · compaction near' }])
  })
})

describe('call summaries', () => {
  test("the tool's name is drawn beside the summary, so a summary that starts with it loses it", () => {
    expect(callSummary('Read', 'Read /repo/src/cart.py')).toBe('/repo/src/cart.py')
    expect(callSummary('Agent', 'Agent')).toBe('')
    expect(callSummary('Bash', 'ls -la')).toBe('ls -la')
    expect(callSummary('Read', 'Readme.md')).toBe('Readme.md')
  })
})
