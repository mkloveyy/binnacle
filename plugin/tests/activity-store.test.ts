import { describe, expect, test } from 'claude-code/testing'
import { append, bump, newSession } from '../hooks/modules/activity/events.ts'
import { AGE_MAX, INDEX_KEY, INDEX_MAX, SESSION_MAX, TOTAL_MAX, entryOf, repairAgentTurns, evict, hasTurn, normalizeIndex, normalizeSession, prune, sessionKey, sizeOf, storeIds, unlisted, upsertIndex } from '../hooks/modules/activity/store.ts'
import { dataDir, fileIds, recordPath, sessionsDir, validId } from '../hooks/modules/activity/paths.ts'

const DAY = 24 * 60 * 60 * 1000
const entry = (sessionId: string, startedAt: number, bytes: number) => ({ sessionId, startedAt, endedAt: null, cwd: '/w', firstPrompt: '', bytes })

describe('keys and sizes', () => {
  test('keys', () => {
    expect(INDEX_KEY).toBe('activity:index')
    expect(sessionKey('abc')).toBe('activity:abc')
    expect(sizeOf({ a: 1 })).toBe(7)
  })
  test('sizes are UTF-8 bytes, as the file system limit counts them', () => {
    expect(sizeOf('é')).toBe(4)
    expect(sizeOf('研发')).toBe(8)
    expect(sizeOf('😀')).toBe(6)
  })
  test('one record stays under the 4 MiB file limit; all of them under 100 MiB', () => {
    expect(SESSION_MAX).toBe(3 * 1024 * 1024)
    expect(TOTAL_MAX).toBe(100 * 1024 * 1024)
  })
})

describe('prune', () => {
  test('drops the oldest one-off events first and keeps turns, agents and counts', () => {
    let s = newSession('s1', 0, '/w')
    s = append(s, { at: 0, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'p' })
    for (let i = 0; i < 100; i++) s = append(s, { at: i, turnId: 't1', agentId: null, kind: 'guard', ruleId: `r${i}`, action: 'deny', summary: 'x'.repeat(100) })
    s = append(s, { at: 200, turnId: 't1', agentId: null, kind: 'turn-end', durationMs: 1, costUsd: null, aborted: false })
    const p = prune(s, 3000)
    expect(sizeOf(p)).toBeLessThan(3001)
    expect(p.events[0]?.kind).toBe('turn-start')
    expect(p.events.at(-1)?.kind).toBe('turn-end')
    const kept = p.events.filter(ev => ev.kind === 'guard')
    expect(kept.at(-1)).toMatchObject({ ruleId: 'r99' })
    expect(kept.length).toBeLessThan(100)
    expect(prune(p, 3000)).toBe(p)
    for (let max = 1500; max < 3200; max += 13) expect(sizeOf(prune(s, max))).toBeLessThan(max + 1)
    const dropped = s.events.filter(ev => ev.kind === 'guard' && !kept.some(k => k === ev))
    expect(dropped.length + kept.length).toBe(100)
    expect(sizeOf({ ...p, events: [...p.events, dropped.at(-1)] })).toBeGreaterThan(3000)
  })
})

describe('index', () => {
  test('upsert replaces by id', () => {
    const a = upsertIndex([entry('s1', 1, 10)], entry('s1', 1, 20))
    expect(a).toEqual([entry('s1', 1, 20)])
  })
  test(`sessions started more than 90 days ago go, never the current one`, () => {
    expect(AGE_MAX).toBe(90 * DAY)
    const now = 100 * DAY
    const idx = [entry('s1', 5 * DAY, 10), entry('s2', 9 * DAY, 10), entry('s3', 10 * DAY, 10), entry('s4', 50 * DAY, 10)]
    expect(evict(idx, 's4', now)).toEqual({ keep: [entry('s3', 10 * DAY, 10), entry('s4', 50 * DAY, 10)], drop: ['s1', 's2'] })
    expect(evict(idx, 's1', now).drop).toEqual(['s2'])
    expect(evict(idx, 's4', 94 * DAY).drop).toEqual([])
  })
  test('size no longer counts: big sessions inside the caps stay', () => {
    const idx = [entry('s1', 1, 3_000_000), entry('s2', 2, 3_000_000), entry('s3', 3, 3_000_000)]
    expect(evict(idx, 's3', 10).drop).toEqual([])
  })
  test(`at most ${INDEX_MAX} sessions are kept, the oldest dropped first, never the current one`, () => {
    const idx = Array.from({ length: INDEX_MAX + 3 }, (_, i) => entry(`s${i}`, i, 10))
    expect(INDEX_MAX).toBe(500)
    expect(evict(idx, `s${INDEX_MAX + 2}`, INDEX_MAX).drop).toEqual(['s0', 's1', 's2'])
    expect(evict(idx, 's0', INDEX_MAX).drop).toEqual(['s1', 's2', 's3'])
    expect(evict(idx.slice(0, INDEX_MAX), 's0', INDEX_MAX).drop).toEqual([])
  })
  test('the age cap and the count cap together', () => {
    const now = 200 * DAY
    const idx = [...Array.from({ length: 3 }, (_, i) => entry(`old${i}`, i, 10)), ...Array.from({ length: INDEX_MAX + 1 }, (_, i) => entry(`s${i}`, now - DAY + i, 10))]
    expect(evict(idx, `s${INDEX_MAX}`, now).drop).toEqual(['old0', 'old1', 'old2', 's0'])
  })
  test('past the total size the oldest go, the current session never', () => {
    const idx = [entry('s1', 1, 40), entry('s2', 2, 40), entry('s3', 3, 40)]
    expect(evict(idx, 's3', 10, AGE_MAX, INDEX_MAX, 100).drop).toEqual(['s1'])
    expect(evict(idx, 's3', 10, AGE_MAX, INDEX_MAX, 40).drop).toEqual(['s1', 's2'])
    expect(evict(idx, 's1', 10, AGE_MAX, INDEX_MAX, 40).drop).toEqual(['s2', 's3'])
    expect(evict(idx, 's3', 10, AGE_MAX, INDEX_MAX, 120).drop).toEqual([])
  })
  test('a session with no turn is not worth saving', () => {
    expect(hasTurn(newSession('s1', 0, '/w'))).toBe(false)
    expect(hasTurn(append(newSession('s1', 0, '/w'), { at: 0, turnId: 't1', agentId: null, kind: 'turn-start', prompt: '' }))).toBe(true)
  })
  test('saved sessions the index lost are found among the files and the store keys', () => {
    const keys = ['settings', INDEX_KEY, sessionKey('s1'), sessionKey('lost'), sessionKey('me'), 'statusLineNoticeShown']
    expect(storeIds(keys)).toEqual(['s1', 'lost', 'me'])
    expect(unlisted(['s1', 'lost', 'me', 'gone', 'lost'], [entry('s1', 1, 1)], 'me')).toEqual(['lost', 'gone'])
  })
  test('entryOf copies the summary fields', () => {
    const s = { ...newSession('s1', 5, '/w'), firstPrompt: 'hi' }
    expect(entryOf(s, 42)).toEqual({ sessionId: 's1', startedAt: 5, endedAt: null, cwd: '/w', firstPrompt: 'hi', bytes: 42 })
  })
})

describe('files', () => {
  test('a saved session lives in the plugin data directory, one file each', () => {
    expect(dataDir('/home/u')).toBe('/home/u/.claude/plugins/data/binnacle-binnacle')
    expect(sessionsDir('/home/u')).toBe('/home/u/.claude/plugins/data/binnacle-binnacle/sessions')
    expect(recordPath('/home/u', '0f3a-9_b')).toBe('/home/u/.claude/plugins/data/binnacle-binnacle/sessions/0f3a-9_b.json')
  })
  test('an id with a slash, dots or anything but letters, digits, _ and - never becomes a path', () => {
    for (const id of ['', '..', '../x', 'a/b', '/etc/passwd', 'a.b', 'a b', 'a\\b', '-', '*']) expect(validId(id)).toBe(id === '-')
    for (const id of ['', '..', '../x', 'a/b', 'x/../../y']) expect(recordPath('/home/u', id)).toBeNull()
    expect(recordPath('', 's1')).toBeNull()
  })
  test('the listing gives the ids of session files only', () => {
    const at = { size: 1, mtimeMs: 1 }
    expect(fileIds([{ name: 's1.json', kind: 'file', ...at }, { name: 'sub', kind: 'dir', ...at }, { name: 'x.json', kind: 'other', ...at }, { name: 'notes.txt', kind: 'file', ...at }, { name: 'a.b.json', kind: 'file', ...at }])).toEqual(['s1'])
  })
})

describe('reading back', () => {
  test('a damaged record is unreadable; bad events are dropped', () => {
    expect(normalizeSession(undefined)).toBeNull()
    expect(normalizeSession({ version: 2 })).toBeNull()
    const ok = normalizeSession({ version: 1, sessionId: 's1', startedAt: 1, events: [{ at: 1, turnId: 't', agentId: null, kind: 'turn-start', prompt: 'p' }, 'junk'], counts: [] })
    expect(ok?.events).toHaveLength(1)
    expect(ok?.endedAt).toBeNull()
    expect(ok?.cwd).toBe('')
    const guard = { at: 1, turnId: 't', agentId: null, kind: 'guard', ruleId: 'r', action: 'deny', summary: 's' }
    const bad = normalizeSession({ version: 1, sessionId: 's1', startedAt: 1, events: [guard, { ...guard, at: 'x' }, { ...guard, turnId: 1 }, { at: 1, turnId: 't' }], counts: [{ turnId: 't', agentId: null, files: 1, shell: 0, other: 0 }, { files: 1 }, 7, null] })
    expect(bad?.events).toHaveLength(1)
    expect(bad?.counts).toHaveLength(1)
    expect(normalizeSession({ version: 1, sessionId: 's1', startedAt: 1, events: [], counts: 'x' })).toBeNull()
  })
  test('an event missing a field its kind needs is dropped, the rest kept', () => {
    const at = { at: 1, turnId: 't', agentId: null }
    const good = [
      { ...at, kind: 'turn-start', prompt: 'p' },
      { ...at, kind: 'turn-end', durationMs: 1, costUsd: null, aborted: false },
      { ...at, agentId: 'a', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 't', parentAgentId: null, background: false },
      { ...at, agentId: 'a', kind: 'agent-end', durationMs: 1, tokensIn: null, tokensOut: 2, aborted: false, report: ['r'] },
      { ...at, kind: 'perm', tool: 'Bash', summary: 's', decision: 'ask', decider: 'user', outcome: 'denied-by-user' },
      { ...at, kind: 'guard', ruleId: 'r', action: 'deny', summary: 's' },
      { ...at, kind: 'error', tool: 'Bash', summary: 's', message: 'm' },
      { ...at, kind: 'edit', tool: 'Edit', file: '/f', added: 1, removed: 0 },
    ]
    const broken = [
      { ...at, kind: 'turn-start' },
      { ...at, kind: 'turn-end', durationMs: '1', costUsd: null, aborted: false },
      { ...at, agentId: 'a', kind: 'agent-start', agentType: 'Explore', model: 'm', parentAgentId: null, background: false },
      { ...at, agentId: 'a', kind: 'agent-end', durationMs: 1, tokensIn: null, tokensOut: 2, aborted: false, report: 'r' },
      { ...at, kind: 'perm', tool: 'Bash', decision: 'ask', decider: 'user', outcome: null },
      { ...at, kind: 'guard', ruleId: 'r', action: 'deny' },
      { ...at, kind: 'error', tool: 'Bash', summary: 's' },
      { ...at, kind: 'edit', tool: 'Edit', added: 1, removed: 0 },
      { ...at, agentId: 7, kind: 'turn-start', prompt: 'p' },
      { ...at, kind: 'what', prompt: 'p' },
    ]
    const s = normalizeSession({ version: 1, sessionId: 's1', startedAt: 1, events: [...good, ...broken], counts: [{ turnId: 't', agentId: null, files: 'x', shell: 0, other: 0 }] })
    expect(s?.events).toEqual(good)
    expect(s?.counts).toEqual([])
  })
  test('a damaged index reads as empty, bad rows dropped', () => {
    expect(normalizeIndex('x')).toEqual([])
    expect(normalizeIndex([entry('s1', 1, 2), { sessionId: 3 }])).toEqual([entry('s1', 1, 2)])
    expect(normalizeIndex([null, 'x', [], { sessionId: 's', startedAt: 1 }, { sessionId: 's', bytes: 1 }, entry('s2', 2, 3)])).toEqual([entry('s2', 2, 3)])
  })
  test('an index entry missing its summary fields reads with defaults', () => {
    expect(normalizeIndex([{ sessionId: 's1', startedAt: 1, bytes: 2 }])).toEqual([{ sessionId: 's1', startedAt: 1, endedAt: null, cwd: '', firstPrompt: '', bytes: 2 }])
    expect(normalizeIndex([{ sessionId: 's1', startedAt: 1, endedAt: 'x', cwd: 3, firstPrompt: null, bytes: 2 }])).toEqual([{ sessionId: 's1', startedAt: 1, endedAt: null, cwd: '', firstPrompt: '', bytes: 2 }])
  })
})

describe('turns a subagent started (Claude Code 2.1.299–2.1.300, before 0.5.0)', () => {
  type S = ReturnType<typeof newSession>
  const turn = (s: S, at: number, turnId: string, prompt: string, auto = false) =>
    append(s, { at, turnId, agentId: null, kind: 'turn-start', prompt, ...(auto ? { auto: true as const, via: 'hand-back' as const } : {}) })
  const spawn = (s: S, at: number, turnId: string, agentId: string) =>
    append(s, { at, turnId, agentId, kind: 'agent-start', agentType: 'Explore', model: 'm', task: 't', parentAgentId: null, background: false })
  const ended = (s: S, at: number, turnId: string) => append(s, { at, turnId, kind: 'turn-end', agentId: null, durationMs: 1, costUsd: null, aborted: false })
  const sample = (): S => {
    let s = turn(newSession('s', 0, '/w'), 1_000, 'p1', 'look around')
    s = spawn(s, 2_000, 'p1', 'a1')
    s = spawn(s, 2_000, 'p1', 'a2')
    s = turn(s, 2_050, 'x1', 'task one')
    s = turn(s, 2_080, 'x2', 'task two')
    // A main tool call after them was put under the last one.
    s = append(s, { at: 2_500, turnId: 'x2', agentId: null, kind: 'error', tool: 'Bash', summary: 'ls', message: 'no' })
    s = bump(s, 'x2', null, 'Bash')
    s = ended(s, 9_000, 'p1')
    return turn(s, 10_000, 'p2', 'next one')
  }
  test('they go, and what was put under them goes back to the turn they came in', () => {
    const r = repairAgentTurns(sample())
    expect(r.events.filter(e => e.kind === 'turn-start').map(e => e.turnId)).toEqual(['p1', 'p2'])
    expect(r.events.find(e => e.kind === 'error')?.turnId).toBe('p1')
    expect(r.counts).toEqual([expect.objectContaining({ turnId: 'p1', agentId: null, shell: 1 })])
  })
  test('a turn the person started, a hand-back, one with an end, or one long after a spawn stays; it is idempotent', () => {
    let s = spawn(turn(newSession('s', 0, '/w'), 1_000, 'p1', 'go'), 2_000, 'p1', 'a1')
    s = turn(s, 2_050, 'h1', '<agent-message from="a1">', true)
    s = turn(s, 4_000, 'p2', 'late')
    s = ended(turn(s, 5_000, 'p3', 'ended'), 6_000, 'p3')
    expect(repairAgentTurns(s)).toBe(s)
    const once = repairAgentTurns(sample())
    expect(repairAgentTurns(once)).toBe(once)
  })
  test('no more turns go than agents were spawned just before', () => {
    let s = spawn(turn(newSession('s', 0, '/w'), 1_000, 'p1', 'go'), 2_000, 'p1', 'a1')
    s = turn(turn(s, 2_050, 'x1', 'a'), 2_060, 'x2', 'b')
    expect(repairAgentTurns(s).events.filter(e => e.kind === 'turn-start').map(e => e.turnId)).toEqual(['p1', 'x2'])
  })
  test('a saved record is repaired as it is read', () => {
    const raw = JSON.parse(JSON.stringify(sample()))
    expect(normalizeSession(raw)?.events.filter(e => e.kind === 'turn-start').map(e => e.turnId)).toEqual(['p1', 'p2'])
  })
})

test('fields binnacle no longer knows are dropped when a record is read', () => {
  const s = normalizeSession({ version: 1, sessionId: 's', startedAt: 0, endedAt: null, cwd: '/r', firstPrompt: '', events: [], counts: [], legacyField: [{ arg: 'p/s', at: 1 }] })
  expect(s !== null && 'legacyField' in s).toBe(false)
})
