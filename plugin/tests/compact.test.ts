import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { BinnacleCompactions } from '../types'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { compactHeading, compactRows, compactView, foreignIds, parseBoundaries, slugOf, summarize, transcriptPath } from '../hooks/modules/compact/history.ts'
import { layoutRows, type Span } from '../hooks/modules/ui/cols.ts'
import { normalizeSession, prune } from '../hooks/modules/activity/store.ts'
import { DEFAULT_SETTINGS } from '../hooks/core/settings.ts'
import { buildGroups } from '../hooks/modules/status/segments.ts'

/** The test clock: the day the fixtures happen on, so their times show without a date. */
const NOW = Date.parse('2026-10-12T08:00:00Z')

const row = (uuid: string, t: string, trigger: string, pre: number, post = 57_000) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: t, compactMetadata: { trigger, preTokens: pre, postTokens: post, durationMs: 19_000 } })
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('⇣N on the status line (user, 2026-10-13: keep it when the context figures shorten)', () => {
  const snap = { model: 'claude-opus-5-5', effort: 'high', contextTokens: 413_000, contextWindow: 1_000_000, contextPercent: 41, startedAt: 0, costUsd: 1, turnCostUsd: null, limits: [], cwd: '/r', home: '/h' }
  const forms = (n: number) => buildGroups(snap, DEFAULT_SETTINGS, 0, null, { compactions: n }).find(g => g.id === 'context')?.forms.map(f => f.map(sp => sp.text).join('')) ?? []
  test('every form but the narrowest keeps ⇣N; none at 0', () => {
    const f = forms(2)
    expect(f.slice(0, -1).every(t => t.includes('⇣2'))).toBe(true)
    expect(f.at(-2)).toBe('ctx 413k 41% ⇣2')
    expect(f.at(-1)).toBe('ctx 41%')
    expect(forms(0).some(t => t.includes('⇣'))).toBe(false)
  })
})

describe('transcript and boundaries (§5.2)', () => {
  test('the path from the cwd realpath (characters outside [A-Za-z0-9-] become -)', () => {
    expect(slugOf('/Users/make/.claude-mem/observer-sessions')).toBe('-Users-make--claude-mem-observer-sessions')
    expect(transcriptPath('/h', '/private/tmp/bn-x.y', 's1')).toBe('/h/.claude/projects/-private-tmp-bn-x-y/s1.jsonl')
  })
  test('boundary rows parsed, junk skipped; back-links other than this id', () => {
    const b = parseBoundaries([row('u1', '2026-10-12T05:02:00Z', 'auto', 121_000), 'junk', '', row('u2', '2026-10-12T06:00:00Z', 'manual', 72_000)].join('\n'))
    expect(b.map(x => [x.uuid, x.trigger, x.pre, x.post, x.durationMs])).toEqual([['u1', 'auto', 121_000, 57_000, 19_000], ['u2', 'manual', 72_000, 57_000, 19_000]])
    expect(foreignIds(`"session_id":"${A}"\n"session_id":"${B}"\n"session_id":"${A}"`, B)).toEqual([A])
    expect(summarize(b)).toMatchObject({ count: 2, auto: 1, manual: 1, last: { uuid: 'u2' } })
  })
})

describe('the saved record (§5.1)', () => {
  const ev = { at: 5, turnId: 't1', agentId: null, kind: 'compact' as const, trigger: 'auto', tokensBefore: 121_000, tokensAfter: null, durationMs: 19_000 }
  test('a compaction is read back from the store, and kept when the record is pruned', () => {
    const s = append(append(newSession('s1', 0, '/repo'), { at: 1, turnId: 't1', agentId: null, kind: 'error', tool: 'Bash', summary: 'x', message: 'm' }), ev)
    expect(normalizeSession(JSON.parse(JSON.stringify(s)))?.events.map(e => e.kind)).toEqual(['error', 'compact'])
    expect(prune(s, 10).events.map(e => e.kind)).toEqual(['compact'])
  })
})

describe('what the Overview shows (§5.4)', () => {
  const s0 = newSession('s1', 0, '/repo')
  const file = parseBoundaries([row('u1', '2026-10-12T05:02:00Z', 'auto', 121_000), row('u2', '2026-10-12T06:00:00Z', 'auto', 72_000, 30_000)].join('\n'))
  const c: BinnacleCompactions = { sessionId: 's1', found: true, file, copied: false, lineage: null }
  test('this file: count, auto / manual, last time; the copy note when the file has back-links', () => {
    expect(compactHeading(compactView(c, s0), NOW)).toMatch(/^2 in this file · 2 auto · last \d\d:\d\d$/)
    expect(compactHeading(compactView({ ...c, copied: true }, s0), NOW)).toMatch(/^2 in this file \(1 may be copied from the session it came from\) · 2 auto/)
  })
  test('no transcript found: the live record\'s compactions', () => {
    const s = append(s0, { at: 5, turnId: 't1', agentId: null, kind: 'compact', trigger: 'manual', tokensBefore: 49_606, tokensAfter: 7_612, durationMs: 4_051 })
    expect(compactHeading(compactView({ ...c, found: false, file: [] }, s), NOW)).toMatch(/^1 this session · 1 manual · last/)
    expect(compactHeading(compactView(null, s), NOW)).toMatch(/^1 this session/)
  })
  test('a compaction recorded live whose boundary row the file does not hold yet is counted once (the transcript is written behind)', () => {
    const t1 = Date.parse('2026-10-12T05:02:00Z')
    // The first one's boundary row lies in its own next() span: [at − durationMs, at]. The second is not in the file yet.
    let s = append(s0, { at: t1 + 15_000, turnId: 't1', agentId: null, kind: 'compact', trigger: 'auto', tokensBefore: 121_000, tokensAfter: 57_000, durationMs: 19_000 })
    s = append(s, { at: Date.parse('2026-10-12T07:00:00Z'), turnId: 't1', agentId: null, kind: 'compact', trigger: 'manual', tokensBefore: 49_606, tokensAfter: 7_612, durationMs: 4_051 })
    const one = parseBoundaries(row('u1', '2026-10-12T05:02:00Z', 'auto', 121_000))
    expect(compactHeading(compactView({ ...c, file: one }, s), NOW)).toMatch(/^2 in this file · 1 auto · 1 manual · last \d\d:\d\d$/)
    expect(compactView({ ...c, file: one }, s).list.map(b => b.trigger)).toEqual(['auto', 'manual'])
    // Both already written: each counted once.
    expect(compactView({ ...c, file: [...one, ...parseBoundaries(row('u2', '2026-10-12T06:59:58Z', 'manual', 49_606))] }, s).list).toHaveLength(2)
  })
  test('a row without a readable time is skipped: it could never be matched to its live compaction', () => {
    const bad = JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: 'u0', timestamp: 'not a time', compactMetadata: { trigger: 'manual' } })
    expect(parseBoundaries([bad, row('u1', '2026-10-12T05:02:00Z', 'auto', 121_000)].join('\n')).map(b => b.uuid)).toEqual(['u1'])
    const s = append(s0, { at: Date.parse('2026-10-12T07:00:00Z'), turnId: 't1', agentId: null, kind: 'compact', trigger: 'manual', tokensBefore: 1, tokensAfter: 1, durationMs: 1_000 })
    expect(compactView({ ...c, file: parseBoundaries(bad) }, s).list).toHaveLength(1)
  })
  test("a sub-agent's compaction is not added to this file's or the chain's count (its row is in another file), but is in the live record", () => {
    const s = append(s0, { at: Date.parse('2026-10-12T07:00:00Z'), turnId: 't1', agentId: 'a1', kind: 'compact', trigger: 'auto', tokensBefore: 1, tokensAfter: 1, durationMs: 1_000 })
    expect(compactView(c, s).list).toHaveLength(2)
    expect(compactView({ ...c, lineage: { boundaries: file, sessions: 1, missing: false } }, s).list).toHaveLength(2)
    expect(compactView(null, s).list).toHaveLength(1)
  })
  test('two compactions close together: each row pairs with one live compaction, so the second is counted until its row lands', () => {
    const t = Date.parse('2026-10-12T08:00:00Z')
    // A ran 08:00:00–08:00:10, B 08:00:11–08:00:21: A's row lies in B's window too.
    let s = append(s0, { at: t + 10_000, turnId: 't1', agentId: null, kind: 'compact', trigger: 'manual', tokensBefore: 1, tokensAfter: 1, durationMs: 10_000 })
    s = append(s, { at: t + 21_000, turnId: 't1', agentId: null, kind: 'compact', trigger: 'manual', tokensBefore: 1, tokensAfter: 1, durationMs: 10_000 })
    const a = parseBoundaries(row('ua', '2026-10-12T08:00:09Z', 'manual', 1))
    expect(compactView({ ...c, file: a }, s).list).toHaveLength(2)
    // B's row, written behind, arrives at the next read: still two.
    const b = parseBoundaries(row('ub', '2026-10-12T08:00:20Z', 'manual', 1))
    expect(compactView({ ...c, file: [...a, ...b] }, s).list).toHaveLength(2)
  })
  test('rows: time, trigger, before → after, how long, numbers aligned', () => {
    const lines = layoutRows(compactRows(compactView(c, s0), NOW), 60).map(l => (l as Span[]).map(x => x.text).join(''))
    expect(lines[0]).toMatch(/^\d\d:\d\d {2}auto\s+72k {2}→ {2}30k {2}19s$/)
    expect(lines[1]).toMatch(/^\d\d:\d\d {2}auto\s+121k {2}→ {2}57k {2}19s$/)
  })
  test('rows from another day carry the date, and then every row does so the column stays aligned', () => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString()
    const file = parseBoundaries([row('u1', at(12, 5), 'auto', 121_000), row('u2', at(13, 19), 'auto', 72_000)].join('\n'))
    const v = compactView({ ...c, file }, s0)
    const lines = layoutRows(compactRows(v, new Date(2026, 9, 13, 20, 0).getTime()), 60).map(l => (l as Span[]).map(x => x.text).join(''))
    expect(lines[0]).toMatch(/^10-13 19:00 {2}auto/)
    expect(lines[1]).toMatch(/^10-12 05:00 {2}auto/)
    expect(compactHeading(v, new Date(2026, 9, 13, 20, 0).getTime())).toMatch(/last 19:00$/)
    expect(compactHeading(v, new Date(2026, 9, 14, 8, 0).getTime())).toMatch(/last 10-13 19:00$/)
  })
})

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' }, viewport: { columns: 200, rows: 50 } }
/** A compaction leaves at least one message (the harness refuses an empty list in and out). */
const MSGS = [{ role: 'user', text: 'go', toolUses: [] }]
const PROC = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

/** A session whose transcript is (or is not) at the slug path; grep answers with the given lines. */
function world(on: On, { found = true, boundaries = [] as string[], ids = '' } = {}) {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 1, percent: 1 }, rateLimits: [] } }) as never)
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/repo' } }) as never)
  on('fs.exists', (_$, e) => ({ value: found && e.path === '/home/u/.claude/projects/-repo/s1.jsonl' }))
  on('fs.list', () => ({ value: [] }))
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    const argv = [...(e as unknown as { argv: string[] }).argv]
    runs.push(argv)
    if (argv[0] === 'grep' && argv[1] === '-F') return boundaries.length ? PROC(boundaries.join('\n') + '\n') : PROC('', 1)
    if (argv[0] === 'grep' && argv[1] === '-oE') return ids ? PROC(ids) : PROC('', 1)
    return PROC('')
  })
  return { runs, clock }
}

test('a compaction is recorded with its trigger and token counts, under the current turn; a skipped one is not', async ($, on) => {
  world(on, { found: false })
  // The compaction saves the session: the record is read from the file written.
  let file = ''
  on('fs.write', (_$, e) => { if (e.path.endsWith('/sessions/s1.json')) file = e.text; return { value: undefined } })
  let skip = false
  on('session.compact', () => (skip ? { skip: 'another plugin said no' } : { messages: MSGS, tokensBefore: 121_000, tokensAfter: 57_000 }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.compact({ trigger: 'auto', messages: MSGS } as never)
  skip = true
  await $.session.compact({ trigger: 'manual', messages: MSGS } as never)
  const s = JSON.parse(file) as { events: { kind: string }[] }
  const compacts = s.events.filter(ev => ev.kind === 'compact')
  expect(compacts).toEqual([expect.objectContaining({ kind: 'compact', turnId: 't1', agentId: null, trigger: 'auto', tokensBefore: 121_000, tokensAfter: 57_000, durationMs: expect.any(Number) })])
})

test('the transcript\'s boundaries are counted in the Overview and as ⇣N on the status line', async ($, on) => {
  const { runs, clock } = world(on, { boundaries: [row('u1', '2026-10-12T05:02:00Z', 'auto', 121_000), row('u2', '2026-10-12T06:00:00Z', 'auto', 72_000)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Compactions\s+2 in this file · 2 auto · last 10-12 \d\d:\d\d$/ })).toBeDefined()
  // And in the session card at the top, with no scrolling.
  expect(await ui.find({ type: 'Text', text: /^│ compact +2\s+│$/ })).toBeDefined()
  expect(runs).toContainEqual(['grep', '-F', '"subtype":"compact_boundary"', '/home/u/.claude/projects/-repo/s1.jsonl'])
  await ui.unmount()
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Text', text: /⇣2/ })).toBeDefined()
  await hint.unmount()
})

test('a file with back-links says one may be copied', async ($, on) => {
  const { clock } = world(on, { boundaries: [row('u1', '2026-10-12T05:02:00Z', 'auto', 121_000)], ids: `"session_id":"${A}"\n` })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1 in this file \(1 may be copied from the session it came from\)/ })).toBeDefined()
  await ui.unmount()
})

test('with no transcript found, the compactions recorded live are shown', async ($, on) => {
  const { clock } = world(on, { found: false })
  on('session.compact', () => ({ messages: MSGS, tokensBefore: 49_606, tokensAfter: 7_612 }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.compact({ trigger: 'manual', messages: MSGS } as never)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Compactions\s+1 this session · 1 manual/ })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /⇣ compacted · manual\s+50k → 8k\s+0s/ })).toBeDefined()
  await ui.unmount()
})

test('a /compact the host did not report (2.1.300 fires no session.compact for it) is counted when the next turn ends', async ($, on) => {
  const boundaries: string[] = []
  const { clock } = world(on, { boundaries })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  // The transcript gains a boundary with no event: /compact on 2.1.300.
  boundaries.push(row('u1', '2026-10-12T05:02:00Z', 'manual', 121_000))
  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Compactions\s+1 in this file/ })).toBeDefined()
  await ui.unmount()
})
