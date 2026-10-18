import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { CHUNK, entriesOf, FIRST_WINDOW, keepNewest, MAX_CHARS, readArgv, sizeLabel, splitChunk, utf8Length } from '../hooks/modules/search/transcript.ts'
import { CHECK_EVERY, MAX_OCCURRENCES, MAX_QUERY, SEARCH_MS, SUBSEQUENCE_SCAN, resultLine, scan, scoreTerm, snippet, stoppedNote, terms, toView, turnAt } from '../hooks/modules/search/fuzzy.ts'
import { widthOf } from '../hooks/modules/ui/cols.ts'
import { files } from './files.ts'

const user = (t: string, text: string, uuid = 'u') => JSON.stringify({ type: 'user', timestamp: t, uuid, message: { content: text } })
const assistant = (t: string, blocks: unknown[]) => JSON.stringify({ type: 'assistant', timestamp: t, uuid: 'a', message: { content: blocks } })
/** scan's hits: what a search finds. */
const searchHits = (...a: Parameters<typeof scan>) => scan(...a).hits
const E = (role: 'you' | 'claude', text: string, at: number) => ({ role, text, norm: text.toLowerCase(), at, uuid: '', sidechain: false })

describe('reading the transcript in chunks (§6.1)', () => {
  test('byte lengths without encoders', () => {
    expect(utf8Length('aé中😀')).toBe(1 + 2 + 3 + 4)
  })
  test('only whole lines, through the last newline; the next read starts at a line start, never mid-character', () => {
    expect(splitChunk('a\nb\nhalf')).toEqual({ lines: ['a', 'b'], consumed: 4, noBreak: false })
    expect(splitChunk('中\n半')).toEqual({ lines: ['中'], consumed: 4, noBreak: false })
    expect(splitChunk('tail of a line\nnext\npart', true)).toEqual({ lines: ['next'], consumed: 20, noBreak: false })
    expect(splitChunk('rest of a long line\n', true)).toEqual({ lines: [], consumed: 20, noBreak: false })
  })
  test('a chunk with no line break says so: the caller skips a too-long line, or waits at the end', () => {
    expect(splitChunk('noline')).toEqual({ lines: [], consumed: 0, noBreak: true })
    expect(splitChunk('only a tail', true)).toEqual({ lines: [], consumed: 0, noBreak: true })
  })
  test('the read command passes the path and numbers as arguments, never as shell text', () => {
    expect(readArgv('/p a/$x', 10, 3)).toEqual(['perl', '-e', 'open(my $f, "<", $ARGV[0]) or exit 1; binmode $f; seek($f, $ARGV[1], 0); read($f, my $b, $ARGV[2]); binmode STDOUT; print $b', '--', '/p a/$x', '10', '3'])
    expect([CHUNK, FIRST_WINDOW]).toEqual([3 * 1024 * 1024, 24 * 1024 * 1024])
    expect([sizeLabel(24 * 1024 * 1024), sizeLabel(850 * 1024)]).toEqual(['24 MB', '850 KB'])
  })
})

describe('index entries (§6.2)', () => {
  test('your prompts, the replies, tool calls and results, summaries; masked; other rows ignored', () => {
    expect(entriesOf(user('2026-10-12T06:02:00Z', 'why does API_KEY=sk123 wrap')).map(e => [e.role, e.text])).toEqual([['you', 'why does API_KEY=*** wrap']])
    expect(entriesOf(assistant('2026-10-12T06:03:00Z', [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Because' }, { type: 'tool_use', name: 'Bash', input: { command: 'sextant list --json' } }])).map(e => [e.role, e.text]))
      .toEqual([['claude', 'Because'], ['tool', 'Bash · sextant list --json']])
    expect(entriesOf(JSON.stringify({ type: 'user', timestamp: '2026-10-12T06:04:00Z', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ok' }] }] } }))[0]?.role).toBe('result')
    expect(entriesOf(JSON.stringify({ type: 'user', isCompactSummary: true, timestamp: '2026-10-12T06:04:00Z', message: { content: 'This session is being continued' } }))[0]?.role).toBe('summary')
    expect(entriesOf(JSON.stringify({ type: 'cost-state', timestamp: '2026-10-12T06:04:00Z' }))).toEqual([])
    expect(entriesOf('{bad')).toEqual([])
    expect(entriesOf(user('2026-10-12T06:02:00Z', 'x'.repeat(5_000)))[0]?.text).toHaveLength(2_000)
  })
  test('at most 20 000 entries, the oldest dropped', () => {
    expect(keepNewest([E('you', 'a', 1)], [E('you', 'b', 2), E('you', 'c', 3)], 2).map(e => e.text)).toEqual(['b', 'c'])
  })
  test('at most 32 000 000 characters an index (text and norm), the oldest dropped', () => {
    expect(MAX_CHARS).toBe(32_000_000)
    const list = [E('you', 'Aaaa', 1), E('you', 'bbbb', 2), E('you', 'Cccc', 3)].map(e => (e.norm === e.text ? { ...e, norm: undefined } : e))
    // Aaaa and Cccc hold 8 characters each (text and norm), bbbb 4: 20 in all.
    expect(keepNewest([], list, 10, 11).map(e => e.text)).toEqual(['Cccc'])
    expect(keepNewest([], list, 10, 20).map(e => e.text)).toEqual(['Aaaa', 'bbbb', 'Cccc'])
  })
  test('norm is kept only when it differs from the text', () => {
    expect(entriesOf(user('2026-10-12T06:02:00Z', 'all lower case'))[0]?.norm).toBeUndefined()
    expect(entriesOf(user('2026-10-12T06:02:00Z', 'Mixed Case'))[0]?.norm).toBe('mixed case')
  })
  test('a user row the person did not type (isMeta) is indexed as meta, not as you', () => {
    expect(entriesOf(JSON.stringify({ type: 'user', isMeta: true, timestamp: '2026-10-12T06:04:00Z', message: { content: 'Base directory for this skill' } }))[0]?.role).toBe('meta')
  })
})

describe('fuzzy matching (§6.3)', () => {
  test('terms: lower case, whitespace-split, a quoted phrase kept whole', () => {
    expect(terms('Sextant  "row wrap" x')).toEqual(['sextant', 'row wrap', 'x'])
  })
  test('tiers: whole word 4, word start 3, substring 2, subsequence below 1 (ASCII, 3+ characters only)', () => {
    expect(scoreTerm('row', 'the sextant row wraps', false).score).toBe(4)
    expect(scoreTerm('wrap', 'the sextant row wraps', false).score).toBe(3)
    expect(scoreTerm('xta', 'the sextant row', false).score).toBe(2)
    const sub = scoreTerm('sxnt', 'the sextant row', true).score
    expect(sub > 0 && sub < 1).toBe(true)
    expect(scoreTerm('任清', '研发任务上线清单', true).score).toBe(0)
    expect(scoreTerm('上线', '研发任务上线清单', false).score > 0).toBe(true)
  })
  test('every term must match; your words get +0.5; ties newest first; under 2 characters nothing', () => {
    const hits = searchHits([E('claude', 'sextant row wraps', 2), E('you', 'sextant row wraps', 1), E('you', 'only sextant', 3)], 'sextant row')
    expect(hits.map(h => [h.entry.role, h.entry.at])).toEqual([['you', 1], ['claude', 2]])
    expect(searchHits([E('you', 'abc', 1)], 'a')).toEqual([])
  })
  test('pathological terms on a full index stay fast: the subsequence tier scans the newest entries within a time budget', () => {
    const words = ['the', 'sextant', 'row', 'wraps', 'because', 'every', 'eager', 'reader', 'sees', 'a', 'queue', 'of', 'audio', 'events']
    const entries = Array.from({ length: 20_000 }, (_, i) => {
      const text = Array.from({ length: 160 }, (_, j) => words[(i * 7 + j * 13) % words.length]).join(' ')
      return E(i % 2 ? 'you' : 'claude', text, i)
    })
    // A clock that counts its reads, so a busy machine cannot make this flaky: the substring tier reads it once every
    // CHECK_EVERY entries and gets through; ten reads later the subsequence tier is cut. Without a deadline nothing
    // would read the clock or say it stopped.
    const allowed = Math.ceil(entries.length / CHECK_EVERY) + 10
    for (const q of ['eeeeee', 'aeiouaei', 'sextant "row wraps" xyzq']) {
      let reads = 0
      const r = scan(entries, q, { now: () => reads++, until: allowed })
      expect({ q, tier: r.cut?.tier, within: (r.cut?.searched ?? Infinity) <= 11 * CHECK_EVERY, reads: reads <= allowed + 2 })
        .toEqual({ q, tier: 'subsequence', within: true, reads: true })
    }
    // As register.tsx calls it, the plugin's clock and SEARCH_MS: about 60 ms here (300 ms with no deadline); the bound
    // is loose, for a loaded machine.
    const t = performance.now()
    searchHits(entries, 'eeeeee', { now: () => performance.now(), until: t + SEARCH_MS })
    expect(performance.now() - t).toBeLessThan(2_000)
  })
  test('a query of one repeated term is one term; a term looks at its first MAX_OCCURRENCES places in a text (fix round 2)', () => {
    expect(terms('e e E "b c" "b c"')).toEqual(['e', 'b c'])
    expect(MAX_OCCURRENCES).toBe(32)
    // The whole word comes after 40 places inside words: it is past the cap, so the term scores as a substring.
    expect(scoreTerm('e', 'xe'.repeat(40) + ' e', false).score).toBe(2)
    expect(scoreTerm('e', 'xe'.repeat(10) + ' e', false).score).toBe(4)
  })
  test('100 × e on a 16 000-entry index stops at the deadline (both tiers), by the clock it is given (fix round 2)', () => {
    const entries = Array.from({ length: 16_000 }, (_, i) => E('claude', 'every eager reader sees the queue of events '.repeat(20), i))
    for (const q of ['e '.repeat(100), 'e'.repeat(100)]) {
      let reads = 0
      const t = performance.now()
      const r = scan(entries, q, { now: () => reads++, until: 50 })
      // The counted reads are the deadline; the time bound is loose (1.3 s here with no deadline, ~80 ms with it).
      expect({ q: q.slice(0, 5), reads: reads > 0 && reads <= 54, cut: r.cut !== null, slow: performance.now() - t > 1_000 })
        .toEqual({ q: q.slice(0, 5), reads: true, cut: true, slow: false })
    }
  })
  test('the subsequence tier looks at the newest SUBSEQUENCE_SCAN entries only (fix round 2)', () => {
    expect(SUBSEQUENCE_SCAN).toBe(5_000)
    const filler = Array.from({ length: SUBSEQUENCE_SCAN }, (_, i) => E('claude', 'nothing to see', i + 1))
    // "sxnt" is no substring of "the sextant row", only a subsequence of it.
    expect(searchHits([E('you', 'the sextant row', 0), ...filler], 'sxnt')).toEqual([])
    expect(searchHits([E('you', 'the sextant row', 0), ...filler.slice(1)], 'sxnt').map(h => h.entry.text)).toEqual(['the sextant row'])
  })
  test('the deadline stops the substring scan and the subsequence scan (fix round 2)', () => {
    const plain = Array.from({ length: 1_000 }, (_, i) => E('claude', `abc ${i}`, i))
    let reads = 0
    const found = searchHits(plain, 'abc', { now: () => reads++, until: 3 }).length
    expect(found > 0 && found < 1_000).toBe(true)
    expect(searchHits(plain, 'abc').length).toBe(1_000)
    // Only subsequence matches: the substring tier reads the clock once every CHECK_EVERY entries and finds nothing.
    const loose = Array.from({ length: 1_000 }, (_, i) => E('claude', `the sextant ${i}`, i))
    reads = 0
    const some = searchHits(loose, 'sxnt', { now: () => reads++, until: Math.ceil(1_000 / CHECK_EVERY) + 3 }).length
    expect(some > 0 && some < 1_000).toBe(true)
    expect(searchHits(loose, 'sxnt').length).toBe(1_000)
  })
  test('a search cut by the deadline says which tier stopped and how many of the newest rows it looked at (final wave)', () => {
    const plain = Array.from({ length: 1_000 }, (_, i) => E('claude', `abc ${i}`, i))
    let reads = 0
    // The clock is read before entries 0, 16, 32, 48 and 64 from the newest; the fifth read is past the deadline.
    const cut = scan(plain, 'abc', { now: () => reads++, until: 3 })
    expect(cut.cut).toEqual({ tier: 'substring', searched: 4 * CHECK_EVERY })
    expect(cut.hits).toHaveLength(4 * CHECK_EVERY)
    expect(stoppedNote(cut.cut)).toBe('stopped early · newest 64 rows searched')
    expect(scan(plain, 'abc').cut).toBeNull()
    expect(stoppedNote(null)).toBeNull()
    const loose = Array.from({ length: 1_000 }, (_, i) => E('claude', `the sextant ${i}`, i))
    reads = 0
    const sub = scan(loose, 'sxnt', { now: () => reads++, until: Math.ceil(1_000 / CHECK_EVERY) + 3 })
    expect(sub.cut?.tier).toBe('subsequence')
    expect(stoppedNote(sub.cut)).toMatch(/^stopped early · close matches from the newest \d+ rows$/)
  })
  test('the snippet centres the hit and marks cuts with …', () => {
    const sn = snippet('a'.repeat(50) + 'needle' + 'b'.repeat(50), 50, 56, 20)
    expect(sn.hit).toBe('needle')
    expect(sn.before.startsWith('…') && sn.after.endsWith('…')).toBe(true)
    expect((sn.before + sn.hit + sn.after).length).toBeLessThanOrEqual(20)
  })
})

describe('results (§6.4)', () => {
  test('a result maps to the last turn that began at or before it', () => {
    let s = append(newSession('s1', 0, '/r'), { at: 100, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'a' })
    s = append(s, { at: 200, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'b' })
    expect([turnAt(s, 150), turnAt(s, 250), turnAt(s, 50), turnAt(null, 1)]).toEqual([{ turnId: 't1', n: 1 }, { turnId: 't2', n: 2 }, null, null])
  })
  test('your prompt is written just before its turn starts: the next turn within 5 s that saved it, or any within 2 s', () => {
    let s = append(newSession('s1', 0, '/r'), { at: 100_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'a' })
    s = append(s, { at: 200_000, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'why API_KEY=*** wraps' })
    expect(turnAt(s, 199_700, 'why API_KEY=*** wraps')).toEqual({ turnId: 't2', n: 2 })
    expect(turnAt(s, 195_500, 'why API_KEY=*** wraps')).toEqual({ turnId: 't2', n: 2 })
    // More than 5 s before: the time rule, even with the same text.
    expect(turnAt(s, 194_000, 'why API_KEY=*** wraps')).toEqual({ turnId: 't1', n: 1 })
    // Other text (a pasted image, a command's expansion): the next turn only when it began within 2 s.
    expect(turnAt(s, 198_500, 'something else')).toEqual({ turnId: 't2', n: 2 })
    expect(turnAt(s, 197_000, 'something else')).toEqual({ turnId: 't1', n: 1 })
    // Before every turn and far from the first: none.
    expect(turnAt(s, 50_000, 'a')).toBeNull()
    const hit = (role: 'you' | 'claude') => ({ entry: { ...E(role, 'why API_KEY=*** wraps', 199_700) }, score: 4, start: 0, end: 3 })
    expect([toView(hit('you'), s).n, toView(hit('claude'), s).n]).toEqual([2, 1])
  })
  test('a result row: time, #N, role, the hit in suggestion bold', () => {
    const at = new Date(2026, 9, 12, 14, 2).getTime()
    const l = resultLine({ at, turnId: 't9', n: 9, role: 'you', text: 'why does the sextant row wrap', start: 13, end: 24 }, 60)
    expect(l.map(s => s.text).join('')).toBe('14:02    #9  you     why does the sextant row wrap')
    expect(l.find(s => s.text === 'sextant row')).toEqual({ text: 'sextant row', color: 'suggestion', bold: true })
    expect(resultLine({ at, turnId: null, n: null, role: 'tool', text: 'x', start: 0, end: 1 }, 60)[0]?.text).toContain('#—')
  })
})

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const PROC = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const PATH = '/home/u/.claude/projects/-repo/s1.jsonl'

const T0 = new Date(2026, 9, 12, 14, 0).getTime()
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString()
const LINES = [user(iso(2), 'why does the sextant row wrap at 70 columns'), assistant(iso(3), [{ type: 'text', text: 'the sextant row wraps because the list is wider' }]), user(iso(4), 'remember token=abcdef123456 for later')].join('\n') + '\n'

/**
 * A session with a transcript of `size` bytes whose reads answer `content(offset, length)`. Turn t1 began at 14:00
 * local time; lines written later fall in it.
 */
function world(on: On, opts: {
  size: () => number
  content: (offset: number, length: number) => string
  found?: boolean
  /** What the store holds, saved sessions' files by id, and other transcripts by path. */
  seed?: Record<string, unknown>
  records?: Record<string, unknown>
  others?: Record<string, string>
  /** Holds a read of `path` at `offset` until the promise it gives settles; `fail` refuses it as a timeout would. */
  gate?: (path: string, offset: number) => Promise<void> | void | 'fail'
}) {
  const disk = files(on)
  for (const [id, r] of Object.entries(opts.records ?? {})) disk.seed(id, r)
  mock.clock(on, { now: T0 })
  mock.store(on, opts.seed)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  const other = (path: string): string | undefined => opts.others?.[path]
  on('fs.stat', (_$, e) => {
    const o = other(e.path)
    const size = e.path === PATH ? opts.size() : o !== undefined ? utf8Length(o) : null
    return ({ value: size !== null ? { kind: 'file', size, mtimeMs: size, isLink: false } : { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/repo' } }) as never
  })
  on('fs.exists', (_$, e) => ({ value: ((opts.found ?? true) && e.path === PATH) || other(e.path) !== undefined }))
  on('fs.list', () => ({ value: [] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  const reads: { offset: number; length: number }[] = []
  const all: { path: string; offset: number }[] = []
  on('process.run', async (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    if (argv[0] === 'perl') {
      const path = argv[4] as string
      const offset = Number(argv[5])
      const length = Number(argv[6])
      all.push({ path, offset })
      if ((await opts.gate?.(path, offset)) === 'fail') return { deny: 'process.run: timed out after 10000 ms' } as never
      if (path !== PATH) return PROC((other(path) ?? '').slice(offset, offset + length))
      reads.push({ offset, length })
      return PROC(opts.content(offset, length))
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { reads, toasts, all }
}

const pathOf = (id: string) => `/home/u/.claude/projects/-repo/${id}.jsonl`
const saved = (id: string, startedAt: number) => ({
  [id]: { version: 1, sessionId: id, startedAt, endedAt: startedAt + 1, cwd: '/repo', firstPrompt: id, counts: [], events: [{ at: startedAt, turnId: `${id}-t1`, agentId: null, kind: 'turn-start', prompt: id }] },
})
const indexOf = (...ids: string[]) => ({ 'activity:index': ids.map((id, i) => ({ sessionId: id, startedAt: i + 1, endedAt: i + 2, cwd: '/repo', firstPrompt: id, bytes: 100 })) })
/** Waits until a read of `path` has begun (the held one): the next step must start while it is held. */
async function reading(all: { path: string }[], path: string): Promise<void> {
  for (let i = 0; i < 200 && !all.some(r => r.path === path); i++) await new Promise(r => setTimeout(r, 1))
  if (!all.some(r => r.path === path)) throw new Error(`no read of ${path} began`)
}
/** The Search field's key now: it changes on every Enter, so Claude Code draws the query again in the field it emptied. */
const queryKey = async (ui: { find: (q: { type: string }) => Promise<{ key?: string } | undefined> }): Promise<string> => (await ui.find({ type: 'Input' }))?.key ?? 'search-query'

const deferred = () => {
  let open = () => {}
  const p = new Promise<void>(r => { open = r })
  return { p, open }
}

test('a query lists matches with time, turn and role; Enter shows the whole message in place, a button opens the turn in Activity', async ($, on) => {
  const w = world(on, { size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  expect(await ui.find({ type: 'Button', text: /^ 14:02 {4}#1 {2}you {5}why does the sextant row wrap/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /claude\s+the sextant row wraps/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 matches · Enter shows the whole message$/ })).toBeDefined()
  expect(w.reads).toEqual([{ offset: 0, length: utf8Length(LINES) }])
  // f (P1 #3): free on the pane; a focused Select or Input takes letter keys itself.
  expect((await ui.find({ key: 'tab-search' }))?.props.hotkey).toBe('f')
  // Enter: the Search tab stays; the whole message, its time and turn, and for a reply the turn's prompt, under the row.
  await ui.press({ key: 'hit-1' })
  expect((await ui.find({ key: 'tab-search' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: /^14:03 · turn #1 · claude$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'prompt: look' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'the sextant row wraps because the list is wider' })).toBeDefined()
  // Enter again closes it; another row opens only that one.
  await ui.press({ key: 'hit-1' })
  expect(await ui.find({ type: 'Text', text: 'prompt: look' })).toBeUndefined()
  await ui.press({ key: 'hit-0' })
  expect(await ui.find({ type: 'Text', text: 'why does the sextant row wrap at 70 columns' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'prompt: look' })).toBeUndefined()
  // The button under it opens that turn in Activity.
  await ui.press({ key: 'hit-0-activity' })
  expect((await ui.find({ key: 'tab-activity' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: 'prompt: look' })).toBeDefined()
  await ui.unmount()
})

test('what is indexed is masked; a row from before any turn says #— and cannot be opened', async ($, on) => {
  const early = user(new Date(T0 - 3_600_000).toISOString(), 'sextant before any turn') + '\n'
  const text = early + LINES
  const w = world(on, { size: () => utf8Length(text), content: (o, l) => text.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'token' })
  expect(await ui.find({ type: 'Button', text: /token=\*\*\* for later/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /abcdef123456/ })).toBeUndefined()
  await ui.input({ key: await queryKey(ui), text: 'before any turn' })
  expect(await ui.find({ type: 'Button', text: /#—/ })).toBeDefined()
  await ui.press({ key: 'hit-0' })
  expect(await ui.find({ type: 'Text', text: 'sextant before any turn' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'no Activity record for that time' })).toBeDefined()
  expect(await ui.find({ key: 'hit-0-activity' })).toBeUndefined()
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('/binnacle search <query> opens the tab with results; more than 400 are counted', async ($, on) => {
  const many = Array.from({ length: 450 }, (_, i) => user(iso(5), `needle number ${i}`)).join('\n') + '\n'
  world(on, { size: () => utf8Length(many), content: (o, l) => many.slice(o, o + l) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const r = await $.command.run({ command: 'binnacle', args: 'search needle' })
  expect(r.text).toContain('opened')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect((await ui.findAll({ type: 'Button', text: /needle number/ })).length).toBe(400)
  expect(await ui.find({ type: 'Text', text: /^450 matches · 50 more not shown · Enter shows the whole message$/ })).toBeDefined()
  await ui.unmount()
})

test('a big transcript is indexed from its newest 24 MB, then read on from where it stopped after each turn', async ($, on) => {
  let size = FIRST_WINDOW + 1_000
  const line = user(iso(2), 'sextant row') + '\n'
  // The first read starts inside a line (its rest is dropped); every read past what exists answers nothing.
  const w = world(on, { size: () => size, content: (o, l) => (o === 1_000 ? `half a line\n${line}` : '').slice(0, l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  expect(w.reads[0]).toEqual({ offset: 1_000, length: CHUNK })
  const stoppedAt = w.reads[1]?.offset
  expect(stoppedAt).toBe(1_000 + utf8Length(`half a line\n${line}`))
  expect(await ui.find({ type: 'Text', text: /last 24 MB of 24 MB/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /sextant row/ })).toBeDefined()
  const before = w.reads.length
  size += utf8Length(line)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  expect(w.reads[before]?.offset).toBe(stoppedAt)
  await ui.unmount()
})

test('a line longer than a chunk is skipped and counted; a missing transcript says so', async ($, on) => {
  const line = user(iso(2), 'sextant row') + '\n'
  const size = CHUNK + 200
  const w = world(on, { size: () => size, content: (o, l) => (o === 0 ? 'y'.repeat(50) : o === CHUNK ? `rest of it\n${line}` : '').slice(0, l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  expect(w.reads.slice(0, 2)).toEqual([{ offset: 0, length: CHUNK }, { offset: CHUNK, length: 200 }])
  expect(await ui.find({ type: 'Text', text: /1 long line skipped/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /sextant row/ })).toBeDefined()
  await ui.unmount()
})

test('with no transcript found the tab says so instead of searching', async ($, on) => {
  world(on, { size: () => 0, content: () => '', found: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant' })
  expect(await ui.find({ type: 'Text', text: 'transcript not found' })).toBeDefined()
  await ui.unmount()
})

describe('what reaches the screen (§6.4, §6.5)', () => {
  test('an indexed text is masked, then its control characters made visible', () => {
    expect(entriesOf(user('2026-10-12T06:02:00Z', 'ring\x07 the token=abc bell'))[0]?.text).toBe('ring^G the token=*** bell')
  })
  test('a read that began inside a multi-byte character counts each stray byte once', () => {
    // '中' is e4 b8 ad: a read from its second byte decodes b8 ad as two U+FFFD.
    expect(splitChunk('�� rest\nnext\n', true)).toEqual({ lines: ['next'], consumed: 2 + 6 + 5, noBreak: false })
  })
  test('a row of wide characters stays within the width', () => {
    const at = new Date(2026, 9, 12, 14, 2).getTime()
    const l = resultLine({ at, turnId: 't1', n: 1, role: 'you', text: '研发任务上线清单'.repeat(10), start: 8, end: 10 }, 50)
    expect(widthOf(l)).toBeLessThanOrEqual(50)
    expect(l.some(s => s.text === '研发' && s.bold === true)).toBe(true)
  })
})

test('at 300 columns with long matching rows the page stays under the host cut; rows past the budget are counted', { timeoutMs: 30_000 }, async ($, on) => {
  const many = Array.from({ length: 450 }, (_, i) => user(iso(5), `needle ${i} ${'word '.repeat(300)}`)).join('\n') + '\n'
  world(on, { size: () => utf8Length(many), content: (o, l) => many.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 300 } })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'needle' })
  expect(await ui.find({ text: /more characters, not drawn/ })).toBeUndefined()
  const shown = (await ui.findAll({ type: 'Button', text: /needle \d+/ })).length
  expect(shown).toBeGreaterThan(100)
  expect(shown).toBeLessThan(400)
  expect(await ui.find({ type: 'Text', text: new RegExp(`^450 matches · ${450 - shown} more not shown · Enter shows the whole message$`) })).toBeDefined()
  await ui.unmount()
})

test('with Search open, the end of a turn reads on by itself and redraws the results', async ($, on) => {
  let text = LINES
  const w = world(on, { size: () => utf8Length(text), content: (o, l) => text.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  const before = w.reads.length
  text += user(iso(6), 'one more sextant row question') + '\n'
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.reads[before]?.offset).toBe(utf8Length(LINES))
  expect(await ui.find({ type: 'Button', text: /one more sextant row question/ })).toBeDefined()
  await ui.unmount()
})

test('with the pane closed on Search, the ends of later turns read nothing (final review)', async ($, on) => {
  let text = LINES
  const w = world(on, { size: () => utf8Length(text), content: (o, l) => text.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  await ui.unmount()
  // The turn the tab was drawn in may still read on once when it ends; the turns after it, with no drawing, do not.
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const before = w.reads.length
  for (const id of ['t2', 't3']) {
    text += user(iso(6), `one more sextant row question ${id}`) + '\n'
    await $.turn.start({ text: 'again', turnId: id })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
  }
  expect(w.reads.length).toBe(before)
})

describe('fix round 1 (B12 review)', () => {
  test('an older search of another session does not replace the newer one (I1)', async ($, on) => {
    const gate = deferred()
    let first = true
    const others = { [pathOf('s2')]: user(iso(1), 'sextant in the saved session') + '\n' }
    const w = world(on, {
      size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l), seed: indexOf('s2'), records: saved('s2', T0 - 86_400_000), others,
      gate: path => { if (path === PATH && first) { first = false; return gate.p } },
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    const slow = ui.input({ key: await queryKey(ui), text: 'sextant' })
    await reading(w.all, PATH)
    await ui.select({ key: 'search-session', value: 's2' })
    gate.open()
    await slow
    expect(await ui.find({ type: 'Button', text: /sextant in the saved session/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /sextant row wrap/ })).toBeUndefined()
    await ui.unmount()
  })

  test('an older query that finishes last does not replace the newer one (I1)', async ($, on) => {
    const gate = deferred()
    let first = true
    const w = world(on, { size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l), gate: () => { if (first) { first = false; return gate.p } } })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    const slow = ui.input({ key: await queryKey(ui), text: 'sextant' })
    await reading(w.all, PATH)
    await ui.input({ key: await queryKey(ui), text: 'remember' })
    gate.open()
    await slow
    expect(await ui.find({ type: 'Button', text: /remember token/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /sextant row wrap/ })).toBeUndefined()
    await ui.unmount()
  })

  test('results of another query are not drawn while the typed one waits for its search', async ($, on) => {
    world(on, { size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l) })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    await ui.input({ key: await queryKey(ui), text: 'sextant row' })
    expect(await ui.find({ type: 'Button', text: /sextant row wrap/ })).toBeDefined()
    await ui.input({ key: await queryKey(ui), text: 'remember', kind: 'change' })
    expect(await ui.find({ type: 'Button', text: /sextant row wrap/ })).toBeUndefined()
    await ui.unmount()
  })

  test('at most two indexes are kept, the least recently used dropped (M6)', async ($, on) => {
    const others = { [pathOf('s2')]: user(iso(1), 'sextant two') + '\n', [pathOf('s3')]: user(iso(1), 'sextant three') + '\n' }
    const w = world(on, { size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l), seed: indexOf('s2', 's3'), records: { ...saved('s2', 1), ...saved('s3', 2) }, others })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    const readsOf = (id: string) => w.all.filter(r => r.path === (id === 's1' ? PATH : pathOf(id))).length
    await ui.input({ key: await queryKey(ui), text: 'sextant' })
    await ui.select({ key: 'search-session', value: 's2' })
    await ui.select({ key: 'search-session', value: 'current' })
    expect([readsOf('s1'), readsOf('s2')]).toEqual([1, 1])
    // s1 was used last: s3 pushes s2 out, not s1.
    await ui.select({ key: 'search-session', value: 's3' })
    await ui.select({ key: 'search-session', value: 'current' })
    expect(readsOf('s1')).toBe(1)
    await ui.select({ key: 'search-session', value: 's2' })
    expect(readsOf('s2')).toBe(2)
    expect(await ui.find({ type: 'Button', text: /sextant two/ })).toBeDefined()
    await ui.unmount()
  })

  test('a transcript that shrank (rewritten) is read again from the start', async ($, on) => {
    let text = LINES
    const w = world(on, { size: () => utf8Length(text), content: (o, l) => text.slice(o, o + l) })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    await ui.input({ key: await queryKey(ui), text: 'sextant' })
    const before = w.reads.length
    text = user(iso(5), 'sextant short') + '\n'
    await ui.input({ key: await queryKey(ui), text: 'sextant' })
    expect(w.reads[before]?.offset).toBe(0)
    expect(await ui.find({ type: 'Button', text: /sextant short/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /sextant row wrap/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a read that fails keeps what was read, says so, and is tried again at the next search (M2)', async ($, on) => {
    const line = user(iso(2), 'sextant row') + '\n'
    // One indexed row, then plain filler lines to a little past one chunk: the second read is the one that fails.
    const text = line + ('f'.repeat(99) + '\n').repeat(Math.ceil(CHUNK / 100) + 2)
    let broken = true
    const w = world(on, {
      size: () => utf8Length(text), content: (o, l) => text.slice(o, o + l),
      gate: (_p, offset) => (offset > 0 && broken ? 'fail' : undefined),
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    await ui.input({ key: await queryKey(ui), text: 'sextant row' })
    expect(await ui.find({ type: 'Text', text: /transcript could not be read/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /sextant row/ })).toBeDefined()
    const stoppedAt = w.all[1]?.offset
    // The first chunk ended at its last line break (all ASCII here: characters are bytes).
    expect(stoppedAt).toBe(text.lastIndexOf('\n', CHUNK - 1) + 1)
    broken = false
    const before = w.all.length
    await ui.input({ key: await queryKey(ui), text: 'sextant row' })
    expect(w.all[before]?.offset).toBe(stoppedAt)
    expect(await ui.find({ type: 'Text', text: /transcript could not be read/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the query is drawn printable and kept to 200 characters (M5)', async ($, on) => {
    world(on, { size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l) })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'look', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-search' })
    await ui.input({ key: await queryKey(ui), text: 'com\x07pass', kind: 'change' })
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('com^Gpass')
    await ui.input({ key: await queryKey(ui), text: 'x'.repeat(500), kind: 'change' })
    expect(MAX_QUERY).toBe(200)
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('x'.repeat(200))
    await ui.unmount()
  })
})

test('a first read that fails inside a CJK character is tried again with the same skip, so the next read starts at a line start (fix round 2)', async ($, on) => {
  // The file begins with 中 (3 bytes) and a newline; its newest FIRST_WINDOW bytes start at byte 1, inside 中.
  const line = user(iso(2), 'sextant row') + '\n'
  let broken = true
  const w = world(on, {
    size: () => FIRST_WINDOW + 1, content: (o, l) => (o === 1 ? `\uFFFD\uFFFD\n${line}` : '').slice(0, l),
    gate: () => (broken ? 'fail' : undefined),
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  expect(await ui.find({ type: 'Text', text: /transcript could not be read/ })).toBeDefined()
  broken = false
  const before = w.all.length
  await ui.input({ key: await queryKey(ui), text: 'sextant row' })
  expect(w.all[before]?.offset).toBe(1)
  // 中 is 3 bytes, then the newline: the line after it ends at 4 + its length.
  expect(w.all[before + 1]?.offset).toBe(4 + utf8Length(line))
  expect(await ui.find({ type: 'Button', text: /sextant row/ })).toBeDefined()
  await ui.unmount()
})

test('a search from the tab is bounded by the time budget: register.tsx gives search its clock and deadline (fix round 2)', { timeoutMs: 30_000 }, async ($, on) => {
  const text = Array.from({ length: 6_000 }, (_, i) => user(iso(5), `every eager reader sees the queue of events ${i} `.repeat(18))).join('\n') + '\n'
  world(on, { size: () => utf8Length(text), content: (o, l) => text.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  await ui.input({ key: await queryKey(ui), text: 'queue' })
  // The index is built; this search only scans it.
  const t = performance.now()
  await ui.input({ key: await queryKey(ui), text: 'e'.repeat(100) })
  // Whether the deadline cut the scan does not hang on how busy the machine is (the full scan takes seconds): the
  // info line says it stopped. The time bound is loose, for a loaded machine.
  expect(await ui.find({ type: 'Text', text: /· stopped early · (?:newest [\d,]+ rows searched|close matches from the newest [\d,]+ rows)$/ })).toBeDefined()
  expect(performance.now() - t).toBeLessThan(2_000)
  await ui.unmount()
})

test('Enter keeps the query in the field: Claude Code empties it on Enter, so the field is drawn again under a new key with the query', async ($, on) => {
  world(on, { size: () => utf8Length(LINES), content: (o, l) => LINES.slice(o, o + l) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-search' })
  const before = await queryKey(ui)
  await ui.input({ key: before, text: 'sextant row' })
  const field = await ui.find({ type: 'Input' })
  expect(field?.key).not.toBe(before)
  expect(field?.props.value).toBe('sextant row')
  // Typing alone (no Enter) keeps the key, so the field is not drawn again under the person's fingers.
  await ui.input({ key: field!.key!, text: 'sextant', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.key).toBe(field?.key)
  await ui.unmount()
})
