import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { BinnacleAttentionItem, BinnacleExtTab } from '../types'
import { capNodes, setAttention, setTab, toNodes } from '../hooks/modules/ext/ext.ts'

describe('attention items', () => {
  test('the same id replaces, empty text clears, text becomes one line of at most 80', () => {
    const a = setAttention([], 'p', { id: 'a', level: 'warn', text: 'one' })
    const b = a.ok ? setAttention(a.list, 'p', { id: 'a', level: 'error', text: 'two\nlines ' + 'x'.repeat(100) }) : a
    expect(b.ok && b.list.length).toBe(1)
    expect(b.ok && b.list[0]?.level).toBe('error')
    expect(b.ok && b.list[0]?.text.length).toBe(80)
    expect(b.ok && b.list[0]?.text.startsWith('two lines')).toBe(true)
    expect(b.ok ? setAttention(b.list, 'p', { id: 'a', level: 'info', text: '' }) : b).toEqual({ ok: true, list: [] })
  })
  test('three per plugin, other plugins unaffected, unknown levels read as info', () => {
    let list: BinnacleAttentionItem[] = []
    for (const id of ['a', 'b', 'c']) {
      const r = setAttention(list, 'p', { id, level: 'loud', text: id })
      if (r.ok) list = r.list
    }
    expect(list.map(x => x.level)).toEqual(['info', 'info', 'info'])
    const fourth = setAttention(list, 'p', { id: 'd', level: 'info', text: 'd' })
    expect(fourth.ok).toBe(false)
    expect(!fourth.ok && fourth.reason.startsWith('binnacle:')).toBe(true)
    expect(setAttention(list, 'q', { id: 'd', level: 'info', text: 'd' }).ok).toBe(true)
  })
})

describe('tabs', () => {
  test('two per plugin; empty rows remove a tab; an update keeps its place', () => {
    const rows = [{ text: 'x' }]
    let list: BinnacleExtTab[] = []
    for (const id of ['a', 'b']) {
      const r = setTab(list, 'p', { id, title: id.toUpperCase(), rows })
      if (r.ok) list = r.list
    }
    expect(setTab(list, 'p', { id: 'c', title: 'C', rows }).ok).toBe(false)
    const upd = setTab(list, 'p', { id: 'a', title: 'A2', rows })
    expect(upd.ok && upd.list.map(t => t.title)).toEqual(['A2', 'B'])
    const gone = setTab(list, 'p', { id: 'a', title: 'A', rows: [] })
    expect(gone.ok && gone.list.map(t => t.id)).toEqual(['b'])
  })
  test('past 2000 nodes the rest is dropped and counted; only drawn fields are kept', () => {
    const big = Array.from({ length: 1500 }, (_, i) => ({ text: `n${i}`, children: [{ text: `c${i}` }] }))
    const r = setTab([], 'p', { id: 't', title: 'T', rows: big })
    expect(r.ok && r.list[0]?.rows.at(-1)).toEqual({ text: '… 1000 more rows not shown', dim: true })
    expect(capNodes([{ text: 'a', extra: 1 } as never]).rows).toEqual([{ text: 'a' }])
  })
  test('nodes get stable keys under their tab', () => {
    const n = toNodes([{ text: 'g', children: [{ text: 'l', color: 'green' }] }], 'ext:p/t')
    expect(n[0]?.key).toBe('ext:p/t/0')
    expect(n[0]?.children?.[0]).toMatchObject({ key: 'ext:p/t/0/0', text: 'l', color: 'green' })
  })
  test('a row with an id unique among its siblings is keyed by the id, so rows added above it keep it open', () => {
    const before = toNodes([{ text: 'card' }, { id: 'done', text: 'Finished', children: [{ text: 'x' }] }], 'ext:p/t')
    const after = toNodes([{ text: 'card' }, { text: 'more' }, { text: 'rows' }, { id: 'done', text: 'Finished', children: [{ text: 'x' }] }], 'ext:p/t')
    expect(after[3]?.key).toBe(before[1]?.key)
    expect(after[3]?.key).toBe('ext:p/t/#done')
    expect(after[3]?.children?.[0]?.key).toBe('ext:p/t/#done/0')
    const dup = toNodes([{ id: 'a', text: '1' }, { id: 'a', text: '2' }], 'ext:p/t')
    expect(dup.map(n => n.key)).toEqual(['ext:p/t/0', 'ext:p/t/1'])
  })
  test('rows keep id, cols, press and buttons, cleaned and capped', () => {
    const { rows } = capNodes([{
      id: 'r1', text: 'row', press: true,
      cols: [[{ text: 'a' }], [{ text: 'b\x1b', color: 'bad colour' }], [], [], [], [], [{ text: 'seventh' }]],
      buttons: [...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, label: `Button number ${i} long label` })), { id: 'e', label: '' }],
    }, { press: true, text: 'no id: not pressable' }, { buttons: [{ id: 'x', label: 'X' }] }] as never)
    expect(rows[0]?.id).toBe('r1')
    expect(rows[0]?.press).toBe(true)
    expect(rows[0]?.cols?.length).toBe(6)
    expect(rows[0]?.cols?.[1]).toEqual([{ text: 'b^[' }])
    expect(rows[0]?.buttons?.length).toBe(6)
    expect(rows[0]?.buttons?.[0]?.label).toBe('Button number 0 lon…')
    expect(rows[1]?.press).toBeUndefined()
    expect(rows[2]?.text).toBe('')
    expect(rows[2]?.buttons).toEqual([{ id: 'x', label: 'X' }])
  })
})

describe("other plugins' text", () => {
  const RAW = 'a\x1b[31mb\x07c\x00d\x9be'
  const SHOWN = 'a^[[31mb^Gc^@d�e'
  test('control characters in attention text, tab titles and rows are drawn as visible stand-ins', () => {
    const a = setAttention([], 'p', { id: 'a', level: 'warn', text: RAW })
    expect(a.ok && a.list[0]?.text).toBe(SHOWN)
    const t = setTab([], 'p', { id: 't', title: 'T\x1b\x07\x00\x9b', rows: [{ text: RAW, children: [{ text: RAW }] }] })
    expect(t.ok && t.list[0]?.title).toBe('T^[^G^@�')
    expect(t.ok && t.list[0]?.rows).toEqual([{ text: SHOWN, children: [{ text: SHOWN }] }])
  })
  test('a colour the terminal would refuse is dropped', () => {
    const colors = ['green', '#aabbcc', '#abc', 'gr\x1been', '', '#,(x', 'rgb(1,2,3)']
    const r = capNodes(colors.map(color => ({ text: 'x', color })))
    expect(r.rows.map(x => x.color)).toEqual(['green', '#aabbcc', '#abc', undefined, undefined, undefined, undefined])
  })
  test('rows that are not objects are skipped and the rest kept; a tab of none is removed', () => {
    const rows = [null, 5, 'x', { text: 'ok', children: [null, { text: 'k' }] }] as never[]
    expect(capNodes(rows)).toEqual({ rows: [{ text: 'ok', children: [{ text: 'k' }] }], dropped: 0 })
    const t = setTab([], 'p', { id: 't', title: 'T', rows })
    expect(t.ok && t.list[0]?.rows).toEqual([{ text: 'ok', children: [{ text: 'k' }] }])
    expect(setTab(t.ok ? t.list : [], 'p', { id: 't', title: 'T', rows: [null] as never[] })).toEqual({ ok: true, list: [] })
  })
  test('row text and ids are bounded in state', () => {
    const t = setTab([], 'p', { id: 'i'.repeat(1000), title: 'T', rows: [{ text: 'x'.repeat(10_000) }] })
    expect(t.ok && t.list[0]?.rows[0]?.text.length).toBe(500)
    expect(t.ok && t.list[0]?.id.length).toBe(200)
    const a = setAttention([], 'p', { id: 'i'.repeat(1000), level: 'info', text: 'x' })
    expect(a.ok && a.list[0]?.id.length).toBe(200)
    expect(a.ok && setAttention(a.list, 'p', { id: 'i'.repeat(1000), level: 'info', text: '' })).toEqual({ ok: true, list: [] })
  })
})

const PACK: Plugin = {
  name: 'packy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.attention({ id: 'a', level: 'warn', text: 'packy needs a look' })
      await $.binnacle.tab({ id: 't', title: 'Packy', rows: [{ text: 'group', children: [{ text: 'leaf one', color: 'green' }] }] })
      return r
    })
  },
}
const USAGE = { value: { startedAt: 0, context: { window: 1_000_000, tokens: 1_000, percent: 0.1 }, rateLimits: [] } }
const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' }, viewport: { columns: 200, rows: 50 } }
const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

test('a plugin adds an attention item and a tab under its own name, and the person can turn it off', { plugins: [PACK] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // An attention item is a toast under the plugin's name (no line under the status line any more).
  expect(toasts).toContain('packy: packy needs a look')
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Text', text: 'packy needs a look' })).toBeUndefined()
  await hint.unmount()

  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect((await ui.find({ key: 'tab-ext:packy/t' }))?.text).toBe('Packy')
  await ui.press({ key: 'tab-ext:packy/t' })
  await ui.press({ key: 'node-ext:packy/t/0' })
  expect((await ui.findAll({ type: 'Text', text: /leaf one/ })).some(t => t.props.color === 'green')).toBe(true)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'plugin-packy' })
  expect(await ui.find({ key: 'tab-ext:packy/t' })).toBeUndefined()
  await ui.unmount()
})

test('the session ending (/clear, with no session.start after it) keeps plugin tabs; only their open rows close', { plugins: [PACK] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-ext:packy/t' })
  await ui.press({ key: 'node-ext:packy/t/0' })
  await ui.unmount()
  expect(writes.filter(w => w.key === 'extOpen').at(-1)?.value).toEqual(['ext:packy/t/0'])
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(writes.filter(w => w.key === 'extOpen').at(-1)?.value).toEqual([])
  ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect((await ui.find({ key: 'tab-ext:packy/t' }))?.text).toBe('Packy')
  await ui.unmount()
})

test('picking a session on the Activity tab leaves open rows in a plugin tab open', { plugins: [PACK] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-ext:packy/t' })
  await ui.press({ key: 'node-ext:packy/t/0' })
  expect(await ui.find({ type: 'Text', text: /leaf one/ })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'current' })
  await ui.press({ key: 'tab-ext:packy/t' })
  expect(await ui.find({ type: 'Text', text: /leaf one/ })).toBeDefined()
  await ui.unmount()
})

const GREEDY: Plugin = {
  name: 'greedy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      for (const id of ['a', 'b', 'c']) await $.binnacle.attention({ id, level: 'info', text: id })
      await $.binnacle.attention({ id: 'd', level: 'info', text: 'd' }).catch((err: unknown) => $.ui.log(String(err)))
      return r
    })
  },
}

test("a call over a limit rejects the caller's promise with binnacle's reason", { plugins: [GREEDY] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const logs: string[] = []
  on('ui.log', (_$, e) => { logs.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(logs.some(l => l.includes('binnacle: greedy already shows 3 attention items'))).toBe(true)
})

const NOISY: Plugin = {
  name: 'noisy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.attention({ id: 'a', level: 'warn', text: 'x\x1b[31mred\x07' })
      await $.binnacle.tab({ id: 't', title: 'T\x1b', rows: [{ text: 'g\x9b', children: [{ text: 'leaf\x00', color: 'gr\x1been' }] }] })
      return r
    })
  },
}

test("control characters and bad colours from a plugin never stop binnacle's status line or pane drawing", { plugins: [NOISY] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(toasts).toContain('noisy: x^[[31mred^G')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect((await ui.find({ key: 'tab-ext:noisy/t' }))?.text).toBe('T^[')
  await ui.press({ key: 'tab-ext:noisy/t' })
  await ui.press({ key: 'node-ext:noisy/t/0' })
  expect(await ui.find({ type: 'Text', text: /leaf\^@/ })).toBeDefined()
  await ui.unmount()
})
