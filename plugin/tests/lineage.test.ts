import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DEFAULT_SETTINGS, normalizeSettings, setLineage } from '../hooks/core/settings.ts'
import { lineage, parseBoundaries, type FileHistory } from '../hooks/modules/compact/history.ts'

const row = (uuid: string, t: string, pre: number) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: t, compactMetadata: { trigger: 'auto', preTokens: pre, postTokens: 1_000, durationMs: 9_000 } })
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const [b1, b2] = parseBoundaries([row('u1', '2026-10-12T05:00:00Z', 453_597), row('u2', '2026-10-12T06:00:00Z', 237_226)].join('\n'))

describe('lineage (§5.3)', () => {
  test('boundaries de-duplicated by uuid across the chain (probe M2: 2, not 3)', async () => {
    const files: Record<string, FileHistory> = { [B]: { boundaries: [b2!], predecessors: [A] }, [A]: { boundaries: [b1!, b2!], predecessors: [] } }
    const l = await lineage(B, async id => files[id] ?? null)
    expect(l.boundaries.map(b => b.uuid)).toEqual(['u1', 'u2'])
    expect([l.sessions, l.missing]).toEqual([2, false])
  })
  test('a predecessor that is gone sets missing; a cycle is read once; at most maxHops files', async () => {
    const gone = await lineage(B, async id => (id === B ? { boundaries: [b2!], predecessors: [C] } : null))
    expect([gone.boundaries.length, gone.missing]).toEqual([1, true])
    let reads = 0
    const cycle = await lineage(B, async id => { reads++; return { boundaries: [], predecessors: [id === B ? A : B] } })
    expect([reads, cycle.sessions]).toEqual([2, 2])
    // The stub chain ends at 20 files, so a lineage without its cap stops there and fails fast instead of looping.
    let hops = 0
    const capped = await lineage('0', async id => { hops++; return { boundaries: [], predecessors: Number(id) < 19 ? [String(Number(id) + 1)] : [] } }, 3)
    expect(hops).toBe(3)
    // Cut at the cap with earlier sessions left unread: they are reported missing, as a gone file is.
    expect([capped.sessions, capped.missing]).toEqual([3, true])
    // A chain that ends within the cap is whole.
    const whole = await lineage('0', async id => ({ boundaries: [], predecessors: Number(id) < 2 ? [String(Number(id) + 1)] : [] }), 3)
    expect([whole.sessions, whole.missing]).toEqual([3, false])
  })
})

describe('the setting', () => {
  test('off by default, kept through normalize, set by setLineage', () => {
    expect(DEFAULT_SETTINGS.history).toEqual({ lineage: false })
    expect(normalizeSettings({ history: { lineage: true } }).history).toEqual({ lineage: true })
    expect(normalizeSettings({ history: { lineage: 'yes' } }).history).toEqual({ lineage: false })
    expect(setLineage(DEFAULT_SETTINGS, true).history.lineage).toBe(true)
  })
})

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const PROC = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const PATH = (id: string) => `/home/u/.claude/projects/-repo/${id}.jsonl`

/** Session s1 forked from A: its file copies A's last boundary; A's file holds both. */
function world(on: On, { withA = true, seed = {} as Record<string, unknown> } = {}) {
  const clock = mock.clock(on)
  // A store the test can read back (the kit's mock.store has no reader).
  const stored = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/repo' } }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path === PATH('s1') || (withA && e.path === PATH(A)) }))
  on('fs.list', () => ({ value: [{ name: '-repo', kind: 'dir', size: 0, mtimeMs: 0 }] }) as never)
  const greps: string[] = []
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const file = argv[argv.length - 1]
    greps.push(`${argv[1]} ${file}`)
    if (argv[1] === '-F') return PROC(file === PATH(A) ? `${row('u1', '2026-10-12T05:00:00Z', 453_597)}\n${row('u2', '2026-10-12T06:00:00Z', 237_226)}\n` : `${row('u2', '2026-10-12T06:00:00Z', 237_226)}\n`)
    if (argv[1] === '-oE') return file === PATH('s1') ? PROC(`"session_id":"${A}"\n`) : PROC('', 1)
    return PROC('')
  })
  return { clock, greps, stored }
}

test('with the setting on, the Overview counts across the fork chain', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Compactions\s+1 in this file \(1 may be copied/ })).toBeDefined()
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'history-lineage' }))?.text).toMatch(/^\[ \] count compactions across forks/)
  await ui.press({ key: 'history-lineage' })
  expect((await ui.find({ key: 'history-lineage' }))?.text).toMatch(/^\[✓\]/)
  await ui.press({ key: 'tab-overview' })
  expect(await ui.find({ type: 'Text', text: /^Compactions\s+2 across 2 sessions · 2 auto/ })).toBeDefined()
  await ui.unmount()
})

test('an earlier session that is not found falls back to this file and says so', async ($, on) => {
  const { clock } = world(on, { withA: false, seed: { settings: { version: 1, status: {}, rules: {}, plugins: {}, history: { lineage: true } } } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Compactions\s+1 across 1 session · earlier sessions not found/ })).toBeDefined()
  await ui.unmount()
})

test('the lineage setting is saved through the settings store, and a double press leaves it as it was', async ($, on) => {
  const { clock, stored } = world(on, { seed: { settings: { version: 1, status: {}, rules: {}, plugins: {}, history: { lineage: false } } } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const saved = async (): Promise<unknown> => (stored.get('settings') as { history?: { lineage?: unknown } } | undefined)?.history?.lineage
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'history-lineage' })
  await clock.settle()
  expect(await saved()).toBe(true)
  expect((await ui.find({ key: 'history-lineage' }))?.text).toMatch(/^\[✓\]/)
  await Promise.all([ui.press({ key: 'history-lineage' }), ui.press({ key: 'history-lineage' })])
  await clock.settle()
  expect(await saved()).toBe(true)
  expect((await ui.find({ key: 'history-lineage' }))?.text).toMatch(/^\[✓\]/)
  await ui.press({ key: 'history-lineage' })
  await clock.settle()
  expect(await saved()).toBe(false)
  await ui.unmount()
})

test("with the setting on, this session's own transcript is grepped once per read", async ($, on) => {
  const { clock, greps } = world(on, { seed: { settings: { version: 1, status: {}, rules: {}, plugins: {}, history: { lineage: true } } } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const own = greps.filter(g => g === `-F ${PATH('s1')}`).length
  expect(own).toBeGreaterThan(0)
  expect(own).toBe(greps.filter(g => g === `-F ${PATH(A)}`).length)
})
