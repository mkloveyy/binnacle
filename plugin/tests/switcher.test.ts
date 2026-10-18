import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DEFAULT_SETTINGS } from '../hooks/core/settings.ts'
import { buildGroups } from '../hooks/modules/status/segments.ts'
import { failText } from '../hooks/modules/ui/switcher.ts'

/**
 * The model and the effort live on the status line again, coloured, each a plain button that opens Claude Code's own
 * picker (`/model`, `/effort` with no argument, P2-2): its list of models, its `s` for this session only. Nothing is
 * drawn above the prompt (P2-1: a Select on the status line cannot be opened, a Button can be pressed).
 */
describe('model and effort on the status line (pure)', () => {
  const snap = { model: 'claude-opus-5-5', effort: 'high', contextTokens: 1, contextWindow: 10, contextPercent: 10, startedAt: 0, costUsd: 1, turnCostUsd: null, limits: [], cwd: '/r', home: '/h' }
  test('the model group is back, its two parts marked to press and coloured', () => {
    const g = buildGroups(snap, DEFAULT_SETTINGS, 0).find(x => x.id === 'model')
    expect(g?.forms[0]).toEqual([
      { text: 'Opus 5.5', color: 'green', press: 'model' },
      { text: ' · ', dim: true },
      { text: 'high', color: 'magenta', press: 'effort' },
    ])
    expect(g?.forms[1]?.filter(sp => sp.press).map(sp => [sp.text, sp.press])).toEqual([['Opus', 'model'], ['hi', 'effort']])
  })
  test('a failed command toasts its first line, control characters made visible', () => {
    expect(failText('model', new Error('boom\nsecond line'))).toBe('model picker did not open: Error: boom')
    expect(failText('effort', 'bad \x1b[31m')).toBe('effort picker did not open: bad ^[[31m')
  })
})

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const MODE = { component: 'SessionMode' as const, props: { modes: ['focus'] } }
const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' }, viewport: { columns: 200, rows: 50 } }
const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 } } }
const MODEL_ROW = { key: 'model', label: 'Model', kind: 'choice', value: 'haiku', options: ['default', 'opus'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false }

/** A session with a model and the /config rows; every `/model` and `/effort` run is recorded with its argument. */
/** `effort`: as a turn has reported it (binnacle keeps it in `$.state`); absent, no turn has yet. */
function world(on: On, { rows = [MODEL_ROW] as unknown[], model = 'claude-opus-5-5', fail, effort }: { rows?: unknown[]; model?: string; fail?: string; effort?: string } = {}) {
  mock.clock(on)
  mock.store(on)
  const runs: { command: string; args: string }[] = []
  const toasts: string[] = []
  let current = model
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('session.model', () => ({ value: current }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 1, percent: 1 }, rateLimits: [], cost: { usd: 1 } } }) as never)
  on('config.list', () => ({ value: rows }) as never)
  if (effort !== undefined) {
    on('state.get', async (_$, e, next) => {
      const r = (await next(e)) as unknown as { value: { version: number } }
      return (e.plugin === 'binnacle' && e.key === 'effort' ? { value: { value: effort, version: r.value.version } } : r) as never
    })
  }
  for (const command of ['model', 'effort', 'rename'] as const) {
    on('command.run', { command }, (_$, e) => {
      runs.push({ command, args: e.args })
      // A hook that throws is skipped and the kit's bottom hook rejects the call: the reason the toast shows.
      if (fail !== undefined) throw new Error(fail)
      // The picker closes on a pick: here, `s` on Sonnet 5.5 for this session.
      if (command === 'model') current = 'claude-sonnet-5-5'
      return { text: '' }
    })
  }
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('model.fork', () => ({ value: { isAnswered: true, text: '三原色列举\n', usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } }) as never)
  return { runs, toasts }
}

test('the status line draws the model and the effort as plain buttons in their colours; nothing is drawn above the prompt', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  const model = await hint.find({ key: 'status-model' })
  expect(model?.type).toBe('Button')
  expect(model?.text).toBe('Opus 5.5')
  expect(model?.props.plain).toBe(true)
  expect((await hint.find({ type: 'Text', text: 'Opus 5.5' }))?.props.color).toBe('green')
  // No turn has reported an effort yet: it is left out (Claude Code shows its own above the prompt).
  expect(await hint.find({ key: 'status-effort' })).toBeUndefined()
  expect(await hint.find({ type: 'Text', text: /—/ })).toBeUndefined()
  expect(await hint.find({ type: 'Text', text: /^ctx / })).toBeDefined()
  await hint.unmount()
  // binnacle no longer answers the band at all: with no other plugin, nothing is drawn there.
  const band = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...BAND }).then(() => 'drawn', (err: unknown) => String(err))
  expect(band).toMatch(/no implementation for ui\.render/)
})

test('pressing the model opens /model with no argument, the effort /effort: Claude Code\'s own pickers', async ($, on) => {
  const w = world(on, { effort: 'high' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  await hint.press({ key: 'status-model' })
  await hint.press({ key: 'status-effort' })
  expect(w.runs).toEqual([{ command: 'model', args: '' }, { command: 'effort', args: '' }])
  expect(w.toasts).toEqual([])
  // The line is read again once the picker closes: the new model shows at once, not at the next turn.
  expect((await hint.find({ key: 'status-model' }))?.text).toBe('Sonnet 5.5')
  await hint.unmount()
})

test('a model the policy locks is plain text; the effort still opens its picker', async ($, on) => {
  world(on, { rows: [{ ...MODEL_ROW, isLocked: true }], effort: 'high' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ key: 'status-model' })).toBeUndefined()
  expect(await hint.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect((await hint.find({ key: 'status-effort' }))?.type).toBe('Button')
  await hint.unmount()
})

test('a picker command that throws is toasted with its first line', async ($, on) => {
  const w = world(on, { fail: 'no picker here\nmore' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  await hint.press({ key: 'status-model' })
  expect(w.toasts).toHaveLength(1)
  // The kit rejects a call whose hook threw with its own reason; the toast carries the first line of whatever came back.
  expect(w.toasts[0]).toMatch(/^model picker did not open: \S/)
  await hint.unmount()
})

test('control characters in a model id are made visible on the button', async ($, on) => {
  world(on, { model: 'claude-x\x1b[31m' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect((await hint.find({ key: 'status-model' }))?.text).toBe('claude-x^[[31m')
  await hint.unmount()
})

test('Settings → model off leaves only the effort button', async ($, on) => {
  world(on, { effort: 'high' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'binnacle', args: 'status hide model' })
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ key: 'status-model' })).toBeUndefined()
  expect(await hint.find({ key: 'status-effort' })).toBeDefined()
  await hint.unmount()
})

/**
 * The right of the prompt footer (SessionMode, P2-4: its buttons can be clicked): Claude Code's own mode labels, then
 * `⚑ guard N` when binnacle's guard has refused something, and `☰ binnacle`. The status line keeps none of them.
 */
test('the footer\'s right keeps Claude Code\'s labels and adds ☰ binnacle; the status line has neither', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect(await mode.find({ type: 'Text', text: 'focus' })).toBeDefined()
  expect((await mode.findAll({ type: 'Button' })).map(b => [b.key, b.text])).toEqual([['mode-panel', '☰ binnacle']])
  await mode.unmount()
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Button', text: /☰|✎/ })).toBeUndefined()
  await hint.unmount()
})

test('☰ binnacle opens the panel, and closes it when it is up', async ($, on) => {
  world(on)
  const opened: string[] = []
  const closed: string[] = []
  let up = false
  on('ui.panes', () => ({ value: up ? [{ id: 'binnacle' }] : [] }) as never)
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  await mode.press({ key: 'mode-panel' })
  expect(opened).toEqual(['binnacle'])
  up = true
  await mode.press({ key: 'mode-panel' })
  expect(closed).toEqual(['binnacle'])
  await mode.unmount()
})

test('binnacle no longer touches /rename: a bare /rename passes through, and Overview has no Rename', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'rename', args: '' })
  expect(w.runs.filter(r => r.command === 'rename')).toEqual([{ command: 'rename', args: '' }])
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'ov-rename' })).toBeUndefined()
  await ui.unmount()
})

test('after binnacle\'s guard refuses a command, ⚑ guard 1 opens the panel on Permissions', async ($, on) => {
  world(on)
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect(await mode.find({ key: 'mode-guard' })).toBeUndefined()
  await mode.unmount()
  await $.tool.call({ tool: 'Bash', command: 'kubectl get pods -A' })
  mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect((await mode.find({ key: 'mode-guard' }))?.text).toBe('⚑ guard 1')
  await mode.press({ key: 'mode-guard' })
  await mode.unmount()
  expect(opened).toEqual(['binnacle'])
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect((await ui.find({ key: 'tab-perm' }))?.props.variant).toBe('primary')
  await ui.unmount()
})
