import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { files, home } from './files.ts'

// `/clear` and an in-process `/resume <id>` start `$.state` over under the new session id, and no session.start
// follows (probed on Claude Code 2.1.296). The kit keeps `$.state` for the whole test, so `reset()` does what the
// host does: every binnacle value reads as never written until it is written again. The version is the kit's, so
// a compare-and-set lands as it does on the host. `reset(held)` instead makes the values read as `held` until
// written: what a reload of binnacle's code finds, `$.state` kept and the module fresh.
function resettable(on: On) {
  let wiped = false
  let held: Record<string, unknown> = {}
  const fresh = new Set<string>()
  on('state.get', async (_$, e, next) => {
    const r = (await next(e)) as unknown as { value: { value?: unknown; version: number } }
    if (!wiped || e.plugin !== 'binnacle' || fresh.has(e.key)) return r as never
    return { value: { value: held[e.key], version: r.value.version } } as never
  })
  on('state.set', async (_$, e, next) => {
    const r = (await next(e)) as unknown as { value: { isSet: boolean } }
    if (wiped && e.plugin === 'binnacle' && r.value.isSet) fresh.add(e.key)
    return r as never
  })
  return { reset: (values: Record<string, unknown> = {}) => { wiped = true; held = values; fresh.clear() } }
}

const USAGE = { value: { startedAt: 0, context: { window: 1_000_000, tokens: 1_000, percent: 0.1 }, rateLimits: [], cost: { usd: 1.25 } } }
const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' }, viewport: { columns: 200, rows: 50 } }
const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const STORED = { version: 1, status: { cost: false }, rules: { 'git.force-push': false }, plugins: { packy: false } }

/** A session with a store and session files the test can read, a clock, and a session id the test moves. */
function world(on: On, id: () => string) {
  const disk = files(on)
  home(on)
  const clock = mock.clock(on, { now: 5_000 })
  const stored = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('session.id', () => ({ value: id() }))
  on('session.usage', () => USAGE as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  // What the host draws where binnacle draws nothing.
  on('ui.render', () => Fragment({}))
  return { clock, stored, disk }
}

const shown = (s: unknown) => (s as { status: Record<string, boolean> }).status

test('a toggle after /clear changes one stored setting and keeps the rest', async ($, on) => {
  let id = 's1'
  const { stored } = world(on, () => id)
  const { reset } = resettable(on)
  stored.set('settings', STORED)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  // Nothing has drawn or run since the /clear: the held settings read as the defaults.
  await $.command.run({ command: 'binnacle', args: 'status hide cwd' })
  const s = stored.get('settings') as typeof STORED & { status: Record<string, boolean> }
  expect(shown(s).cwd).toBe(false)
  expect(shown(s).cost).toBe(false)
  expect(s.rules).toEqual({ 'git.force-push': false })
  expect(s.plugins).toEqual({ packy: false })
  await $.command.run({ command: 'binnacle', args: 'guard on k8s.all-namespaces' })
  const r = stored.get('settings') as typeof STORED
  expect(r.rules).toEqual({ 'git.force-push': false, 'k8s.all-namespaces': true })
  expect(shown(r).cost).toBe(false)
  expect(shown(r).cwd).toBe(false)
})

test('two settings changes made at once both stick', async ($, on) => {
  const { stored } = world(on, () => 's1')
  stored.set('settings', STORED)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await Promise.all([
    $.command.run({ command: 'binnacle', args: 'status hide cwd' }),
    $.command.run({ command: 'binnacle', args: 'guard off sql.unbounded' }),
    $.command.run({ command: 'binnacle', args: 'status show cost' }),
  ])
  const s = stored.get('settings') as typeof STORED
  expect(shown(s).cwd).toBe(false)
  expect(shown(s).cost).toBe(true)
  expect(s.rules).toEqual({ 'git.force-push': false, 'sql.unbounded': false })
  // What is held, and drawn, is what was stored last.
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'item-cwd' }))?.text?.trimEnd()).toBe('[ ] cwd')
  expect((await ui.find({ key: 'item-cost' }))?.text?.trimEnd()).toBe('[✓] cost')
  expect((await ui.find({ key: 'rule-sql.unbounded' }))?.text).toMatch(/^\[ \]/)
  await ui.unmount()
})

test('a Settings button after /clear flips the stored value, not the held default', async ($, on) => {
  let id = 's1'
  const { stored } = world(on, () => id)
  const { reset } = resettable(on)
  stored.set('settings', STORED)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'item-cost' })
  expect(shown(stored.get('settings')).cost).toBe(true)
  expect((stored.get('settings') as typeof STORED).rules).toEqual({ 'git.force-push': false })
  await ui.unmount()
})

test('after /clear the settings in effect are the stored ones again, as soon as anything draws', async ($, on) => {
  let id = 's1'
  const { stored, clock } = world(on, () => id)
  const { reset } = resettable(on)
  stored.set('settings', STORED)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  await clock.settle()
  expect((await ui.find({ key: 'item-cost' }))?.text?.trimEnd()).toBe('[ ] cost')
  expect((await ui.find({ key: 'rule-git.force-push' }))?.text).toMatch(/^\[ \]/)
  await ui.unmount()
})

test('a prompt right after /clear runs with the stored guard settings', async ($, on) => {
  let id = 's1'
  const { stored } = world(on, () => id)
  const { reset } = resettable(on)
  stored.set('settings', STORED)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  await $.turn.start({ text: 'go', turnId: 't1' })
  const list = await $.command.run({ command: 'binnacle', args: 'guard list' })
  expect(list.text).toContain('✗ git.force-push')
})

test('the status line is back right after /clear, before the next prompt', async ($, on) => {
  let id = 's1'
  const { stored, clock } = world(on, () => id)
  const { reset } = resettable(on)
  stored.set('settings', { version: 1, status: { cwd: false }, rules: {}, plugins: {} })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  const first = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  await clock.settle()
  await first.unmount()
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Text', text: '$1.25' })).toBeDefined()
  await hint.unmount()
})

test('after an in-process /resume the Activity tab shows the resumed session at once', async ($, on) => {
  let id = 's1'
  const { stored, disk, clock } = world(on, () => id)
  const { reset } = resettable(on)
  disk.seed('s0', { version: 1, sessionId: 's0', startedAt: 1, endedAt: 2, cwd: '/repo', firstPrompt: 'earlier work', events: [{ at: 1, turnId: 't0', agentId: null, kind: 'turn-start', prompt: 'earlier work' }], counts: [] })
  stored.set('activity:index', [{ sessionId: 's0', startedAt: 1, endedAt: 2, cwd: '/repo', firstPrompt: 'earlier work', bytes: 200 }])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'one', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  reset()
  // Time passes before the switch, so s1 reopened and closed again would carry a later end.
  await clock.advance(1_000)
  // The host starts $.state over before it moves to the resumed id: nothing of s1 is loaded back meanwhile.
  const early = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  await clock.settle()
  await early.unmount()
  id = 's0'
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'No activity yet.' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /session s0 · claude --resume s0/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /earlier work/ })).toBeDefined()
  expect((disk.record('s1') as { endedAt: number | null }).endedAt).toBe(5_000)
  await ui.unmount()
})

test('permission checks count for the whole process, across /clear', async ($, on) => {
  let id = 's1'
  const { clock } = world(on, () => id)
  const { reset } = resettable(on)
  on('tool.check', () => ({ decision: 'allow' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.check({ tool: 'Read', input: { file_path: '/repo/a' }, tool_use_id: 'tu1' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu2' } as never)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  await $.tool.check({ tool: 'Bash', input: { command: 'pwd' }, tool_use_id: 'tu3' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Permission checks\s+3 since Claude Code started/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /files 1 · shell 2 · other 0/ })).toBeDefined()
  await ui.unmount()
})

/** A rule pack that registers its rule at session.start, as the example pack does. */
const PACK: Plugin = {
  name: 'packy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.register({ id: 'packy.second', pack: 'packy', title: 'Second', action: 'ask' })
      return r
    })
  },
}

test('after a reload of binnacle, /clear brings back the count, rules and effort the host still held', async ($, on) => {
  let id = 's1'
  const { clock } = world(on, () => id)
  const { reset } = resettable(on)
  on('tool.check', () => ({ decision: 'allow' }))
  // A reload or worker respawn: $.state keeps what the old code wrote, this module starts empty, session.start fires again.
  reset({
    perm: { allow: 4, ask: 0, deny: 0, files: 4, shell: 0, other: 0 },
    extRules: [{ id: 'packy.first', pack: 'packy', title: 'First', action: 'deny' }],
    effort: 'high',
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu1' } as never)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  reset()
  id = 's2'
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Permission checks\s+5 since Claude Code started/ })).toBeDefined()
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'rule-packy.first' })).toBeDefined()
  await ui.unmount()
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect((await hint.find({ key: 'status-effort' }))?.text).toBe('high')
  await hint.unmount()
})

test('a rule registered after a reload of binnacle joins the rules the host still held', { plugins: [PACK] }, async ($, on) => {
  world(on, () => 's1')
  const { reset } = resettable(on)
  reset({ extRules: [{ id: 'packy.first', pack: 'packy', title: 'First', action: 'deny' }] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'rule-packy.first' })).toBeDefined()
  expect(await ui.find({ key: 'rule-packy.second' })).toBeDefined()
  await ui.unmount()
})
