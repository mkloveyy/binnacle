import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

test('the settings tab toggles a status item and persists it', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const writes: { key: string; value: unknown }[] = []
  on('state.set', ($, e, next) => { writes.push(e as never); return next(e) })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'item-cwd' })).toBeDefined()
  await ui.press({ key: 'item-cwd' })
  const s = writes.filter(w => w.key === 'settings').at(-1)?.value as { status: { cwd: boolean } } | undefined
  expect(s?.status.cwd).toBe(false)
  await ui.unmount()
})

test('subcommands change settings and list rules', async ($, on) => {
  const stored: unknown[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_$, e) => { if (e.key === 'settings') stored.push(e.value); return { value: undefined } })
  mock.clock(on)
  const hide = await $.command.run({ command: 'binnacle', args: 'status hide cwd' })
  expect(hide.text).toBe('cwd hidden.')
  expect((stored.at(-1) as { status: { cwd: boolean } }).status.cwd).toBe(false)
  const off = await $.command.run({ command: 'binnacle', args: 'guard off git.force-push' })
  expect(off.text).toBe('rule git.force-push turned off.')
  const list = await $.command.run({ command: 'binnacle', args: 'guard list' })
  expect(list.text).toContain('✗ git.force-push')
  expect(list.text).toContain('✓ k8s.all-namespaces')
  const bad = await $.command.run({ command: 'binnacle', args: 'dance' })
  expect(bad.text).toContain('Usage:')
})

test('the overview tab shows the context breakdown title', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Context/ })).toBeDefined()
  await ui.unmount()
})

test('the permissions tab says what each count covers', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  // The tab bar says Permissions; the page keeps its full title (spec §4.3).
  expect(await ui.find({ key: 'perm-title', text: /^Permissions & guard$/ })).toBeDefined()
  // The perm tally lives in memory for the process; the guard lines come from the session record, kept across resume.
  expect(await ui.find({ type: 'Text', text: /^Permission checks\s+0 since Claude Code started$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Guard in this session\s+blocked 0 · asked 0 · auto 0$/ })).toBeDefined()
  await ui.unmount()
})

test('the overview legend names each colour of the context bar, and the bar fits the pane', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const breakdown = {
    categories: [
      { name: 'System prompt', tokens: 4_000, kind: 'used' },
      { name: 'Messages', tokens: 221_000, kind: 'used' },
      { name: 'Free space', tokens: 775_000, kind: 'free' },
    ],
    totalTokens: 225_000, rawMaxTokens: 1_000_000, isAutoCompactEnabled: false,
  }
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 225_000, percent: 22.5, breakdown }, rateLimits: [] } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /█ messages\s+221k\s+22%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /─ free space\s+775k\s+78%/ })).toBeDefined()
  // bodyColumns 100 → a 98-cell bar: exactly the width, so it never wraps.
  expect((await ui.find({ type: 'Text', text: /^█+─+$/ }))?.text?.length).toBe(98)
  await ui.unmount()
})

test('settings explains what each built-in guard rule covers', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ type: 'Text', text: /^Guard rules\s+deny refuses · ask asks unless nothing is lost$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}rm -r on paths outside the project/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}force push to main, master/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}SQL in MCP tools: .*WHERE/ })).toBeDefined()
  await ui.unmount()
})

test('the settings status row wraps, so every item is reachable at the default dock width', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 63 } })
  await ui.press({ key: 'tab-settings' })
  for (const item of ['model', 'effort', 'context', 'limits', 'duration', 'cost', 'cwd']) {
    expect(await ui.find({ key: `item-${item}` })).toBeDefined()
  }
  // The test host lays nothing out, so assert what the host's layout needs: the row that holds every item button wraps.
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => JSON.stringify(b.children).includes('item-cwd'))
  expect(rows.at(-1)?.props.flexWrap).toBe('wrap')
  await ui.unmount()
})
