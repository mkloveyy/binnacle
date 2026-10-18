import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

const USAGE = { value: { startedAt: 0, context: { window: 1_000_000, tokens: 1_000, percent: 0.1 }, rateLimits: [] } }
const MODE = { component: 'SessionMode' as const, props: { modes: [] as string[] } }

const BTN: Plugin = {
  name: 'btny',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      const v = await $.binnacle.version({})
      $.ui.toast(`btny sees api ${v.api} binnacle ${v.binnacle}`)
      await $.binnacle.button({ id: 'go', label: '✎ go\x1b' })
      await $.binnacle.button({ id: 'orphan', label: 'orphan' })
      return r
    })
    on('binnacle.notify', async ($, e, next) => {
      if (next.origin.plugin !== 'binnacle' || e.plugin !== 'btny' || e.id === 'orphan') return next(e)
      $.ui.toast(`btny got ${e.kind} ${e.id}`)
      return { value: { handled: true } }
    })
  },
}

test('a plugin button sits in the footer, survives /clear, and a press tells its plugin', { plugins: [BTN] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(toasts).toContain('btny sees api 1 binnacle 0.6.0')
  // /clear: session.end, and no session.start after it (spec F21).
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect((await mode.find({ key: 'ext-btn-btny-go' }))?.text).toBe('✎ go^[')
  await mode.press({ key: 'ext-btn-btny-go' })
  expect(toasts).toContain('btny got press go')
  // Nobody handles it: binnacle's own handler answers, nothing is thrown at the press.
  await mode.press({ key: 'ext-btn-btny-orphan' })
  expect(toasts.filter(t => t.includes('orphan'))).toEqual([])
  await mode.unmount()
})

const SEG: Plugin = {
  name: 'segy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.segment({ id: 'deploy', text: '⛵ deploying', color: 'yellow', priority: 7, press: true })
      await $.binnacle.line({ id: 'row', forms: [[{ text: 'segy wide line with everything in it' }], [{ text: 'segy short' }]], press: true })
      return r
    })
    on('binnacle.notify', async ($, e, next) => {
      if (next.origin.plugin !== 'binnacle' || e.plugin !== 'segy') return next(e)
      $.ui.toast(`segy got ${e.kind} ${e.id}`)
      return { value: { handled: true } }
    })
  },
}
const HINT = (columns: number) => ({ component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' }, viewport: { columns, rows: 50 } })

test('a plugin segment joins the status line; its line picks the form that fits; both press', { plugins: [SEG] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const wide = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT(200) })
  expect((await wide.find({ key: 'status-ext-segy-deploy' }))?.text).toBe('⛵ deploying')
  expect((await wide.find({ key: 'line-segy-row' }))?.text).toBe('segy wide line with everything in it')
  await wide.press({ key: 'status-ext-segy-deploy' })
  await wide.press({ key: 'line-segy-row' })
  expect(toasts).toContain('segy got press deploy')
  expect(toasts).toContain('segy got press row')
  await wide.unmount()
  // 40 columns leave the status line its floor of 30: the line takes its short form (fit's order is tested in ext-api).
  const narrow = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT(40) })
  expect((await narrow.find({ key: 'line-segy-row' }))?.text).toBe('segy short')
  await narrow.unmount()
})

const SET: Plugin = {
  name: 'sety',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      const s = await $.binnacle.setting({ id: 'line', title: 'Sprint line', default: true })
      $.ui.toast(`sety starts with ${s.value}`)
      await $.binnacle.button({ id: 'b', label: 'SB' })
      return r
    })
    on('binnacle.notify', async ($, e, next) => {
      if (next.origin.plugin !== 'binnacle' || e.plugin !== 'sety' || e.kind !== 'setting') return next(e)
      $.ui.toast(`sety ${e.id} is now ${e.value}`)
      return { value: { handled: true } }
    })
  },
}
const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

test('a plugin setting shows under the plugin in Settings, toggles and tells it; turning the plugin off hides its button only', { plugins: [SET] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(toasts).toContain('sety starts with true')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'pset-sety-line' }))?.text).toMatch(/\[✓\] Sprint line/)
  await ui.press({ key: 'pset-sety-line' })
  expect(toasts).toContain('sety line is now false')
  expect((await ui.find({ key: 'pset-sety-line' }))?.text).toMatch(/\[ \] Sprint line/)
  await ui.press({ key: 'plugin-sety' })
  expect(await ui.find({ key: 'pset-sety-line' })).toBeDefined()
  await ui.unmount()
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect(await mode.find({ key: 'ext-btn-sety-b' })).toBeUndefined()
  await mode.unmount()
})

const TABY: Plugin = {
  name: 'taby',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.tab({ id: 't', title: 'Taby', rows: [
        { text: 'Sprints', bold: true, cols: [[{ text: '2 active' }]] },
        { id: 'sprint:a', text: 'alpha', press: true, cols: [[{ text: 'dev' }], [{ text: '3/5' }]] },
        { id: 'bar', buttons: [{ id: 'start', label: 'Start' }] },
      ] })
      return r
    })
    on('binnacle.notify', async ($, e, next) => {
      if (next.origin.plugin !== 'binnacle' || e.plugin !== 'taby') return next(e)
      $.ui.toast(`taby got ${e.kind} ${e.id}${e.kind === 'press' && e.row ? ` on ${e.row}` : ''}`)
      return { value: { handled: true } }
    })
  },
}

test('a plugin tab: aligned cols, a pressed row, a row of buttons, an open notice; still there after /clear', { plugins: [TABY] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-ext:taby/t' })
  expect(toasts).toContain('taby got open t')
  expect((await ui.find({ key: 'node-ext:taby/t/1' }))?.text).toMatch(/^ {2}alpha\s+dev {2}3\/5$/)
  await ui.press({ key: 'node-ext:taby/t/1' })
  expect(toasts).toContain('taby got press sprint:a')
  await ui.press({ key: 'ext-rb-ext:taby/t/2-start' })
  expect(toasts).toContain('taby got press start on bar')
  await ui.unmount()
})

test('with the status line off, a plugin turned off stays off in the footer after /clear', { plugins: [BTN], options: { status_enabled: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let id = 's1'
  // /clear starts $.state over (spec F21): binnacle's atoms read as their defaults until something loads them back.
  let wiped = false
  const fresh = new Set<string>()
  on('state.get', async (_$, e, next) => {
    const r = (await next(e)) as unknown as { value: { value?: unknown; version: number } }
    if (!wiped || e.plugin !== 'binnacle' || fresh.has(e.key)) return r as never
    return { value: { value: undefined, version: r.value.version } } as never
  })
  on('state.set', async (_$, e, next) => {
    const r = (await next(e)) as unknown as { value: { isSet: boolean } }
    if (wiped && e.plugin === 'binnacle' && r.value.isSet) fresh.add(e.key)
    return r as never
  })
  on('session.id', () => ({ value: id }))
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'plugin-btny' })
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  wiped = true
  id = 's2'
  // The first drawing after /clear asks for the settings to be loaded back; the next one has them.
  const first = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  await first.unmount()
  await clock.settle()
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect(await mode.find({ key: 'ext-btn-btny-go' })).toBeUndefined()
  await mode.unmount()
})
