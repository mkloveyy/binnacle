import { expect, mock, test } from 'claude-code/testing'
import { files, home } from './files.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const PROC = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
const DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new', ''].join('\n')
const EDIT = {
  filePath: '/repo/a.ts', oldString: 'old', newString: 'new', originalFile: 'keep\nold\n', userModified: false, replaceAll: false,
  structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' keep', '-old', '+new'] }],
}
const NOT_REPO = PROC('', 128, 'fatal: not a git repository (or any of the parent directories): .git')

test('/binnacle diff lists changed and untracked files and draws the selected diff', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const runs: { argv: string[]; cwd?: string }[] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_$, e) => {
    const call = e as unknown as { argv: string[]; init?: { cwd?: string; timeoutMs?: number } }
    runs.push({ argv: [...call.argv], cwd: call.init?.cwd })
    return call.argv.includes('status') ? PROC(' M src/a.ts\n?? notes.md\n') : PROC(DIFF)
  })
  const r = await $.command.run({ command: 'binnacle', args: 'diff' })
  expect(r.text).toContain('opened')
  expect(runs).toEqual([
    {
      argv: ['git', '--no-optional-locks', '-c', 'core.quotepath=false', 'diff-index', '-p', '-M', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD'],
      cwd: '/repo',
    },
    { argv: ['git', '--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain'], cwd: '/repo' },
  ])
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', text: /▸ M\s+src\/a\.ts\s+\+1\s+−1/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /\?\s+notes\.md\s+untracked/ })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: /\+new/ })).toBeDefined()
  await ui.press({ key: 'file-1' })
  expect(await ui.find({ type: 'Text', text: /untracked file/ })).toBeDefined()
  await ui.unmount()
})

test("a turn's own edits are shown under Turn #N, and outside a repository Workspace says so", async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: EDIT, text: 'ok' }) as never)
  on('process.run', () => NOT_REPO)
  await $.turn.start({ text: 'edit it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/repo/a.ts', old_string: 'old', new_string: 'new' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  expect(await ui.find({ type: 'Text', text: 'not a git repository' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '(Tab, then r)' })).toBeDefined()
  await ui.select({ key: 'diff-source', value: 't1' })
  // A turn's source has nothing to refresh: no hint.
  expect(await ui.find({ type: 'Text', text: '(Tab, then r)' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /M\s+a\.ts\s+\+1\s+−1/ })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: /\+new/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /patch too large to keep/ })).toBeUndefined()
  await ui.unmount()
})

test('a narrow docked pane says how to widen it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('process.run', () => PROC(''))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 64 } })
  await ui.press({ key: 'tab-diff' })
  expect(await ui.find({ type: 'Text', text: /ctrl\+x ← widens this pane/ })).toBeDefined()
  await ui.redraw({ ...PANE.props, bodyColumns: 120 })
  expect(await ui.find({ type: 'Text', text: /widens this pane/ })).toBeUndefined()
  await ui.unmount()
})

test('an edit whose patch was too large to keep says so instead of drawing nothing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const huge = { ...EDIT, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-' + 'x'.repeat(95_000), '+y'] }] }
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: huge, text: 'ok' }) as never)
  on('process.run', () => NOT_REPO)
  await $.turn.start({ text: 'rewrite it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  await ui.select({ key: 'diff-source', value: 't1' })
  expect(await ui.find({ type: 'Button', text: /▸ M\s+a\.ts\s+\+1\s+−1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'patch too large to keep' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /after resume/ })).toBeUndefined()
  await ui.unmount()
})

test('a turn from before this process says its diff was not kept', async ($, on) => {
  mock.clock(on, { now: 50_000 })
  const saved = {
    version: 1, sessionId: 's1', startedAt: 0, endedAt: 1_000, cwd: '/repo', firstPrompt: 'edit it',
    events: [
      { at: 100, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'edit it' },
      { at: 200, turnId: 't1', agentId: null, kind: 'edit', tool: 'Edit', file: '/repo/a.ts', added: 1, removed: 1 },
    ],
    counts: [],
  }
  files(on).seed('s1', saved)
  home(on)
  const stored = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', () => NOT_REPO)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  await ui.select({ key: 'diff-source', value: 't1' })
  expect(await ui.find({ type: 'Text', text: 'diff not kept after resume — use Workspace' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /patch too large to keep/ })).toBeUndefined()
  await ui.unmount()
})

test('/binnacle diff opens the pane before git answers, and shows that it is reading', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const order: string[] = []
  let release = (): void => undefined
  const gate = new Promise<void>(r => { release = r })
  on('ui.open', () => { order.push('open'); return { value: { isPlaced: true } } })
  on('process.run', async () => { order.push('git'); await gate; return PROC(DIFF) })
  const pending = $.command.run({ command: 'binnacle', args: 'diff' })
  while (!order.includes('git')) await new Promise(r => setTimeout(r, 1))
  expect(order[0]).toBe('open')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /reading the working tree/ })).toBeDefined()
  release()
  expect((await pending).text).toContain('opened')
  await ui.redraw(PANE.props)
  expect(await ui.find({ type: 'Text', text: /reading the working tree/ })).toBeUndefined()
  expect(await ui.find({ type: 'Code', text: /\+new/ })).toBeDefined()
  await ui.unmount()
})

test('control characters in a diff are drawn as visible stand-ins, in Workspace and in a turn', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const dirty = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,1 +1,1 @@', '-page\fbreak', '+\x1b[31mred', ''].join('\n')
  const edit = { ...EDIT, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-page\fbreak', '+\x1b[31mred'] }] }
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: edit, text: 'ok' }) as never)
  on('process.run', (_$, e) => ((e as unknown as { argv: string[] }).argv.includes('status') ? PROC('') : PROC(dirty)))
  await $.turn.start({ text: 'edit it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  expect(await ui.find({ type: 'Code', text: '@@ -1,1 +1,1 @@\n-page^Lbreak\n+^[[31mred' })).toBeDefined()
  await ui.select({ key: 'diff-source', value: 't1' })
  expect(await ui.find({ type: 'Code', text: '@@ -1,1 +1,1 @@\n-page^Lbreak\n+^[[31mred' })).toBeDefined()
  await ui.unmount()
})

test('a turn no longer in the list falls back to Workspace, with its Refresh button and a fresh read', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let sid = 's1'
  let runs = 0
  on('session.id', () => ({ value: sid }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: EDIT, text: 'ok' }) as never)
  on('process.run', () => { runs++; return NOT_REPO })
  await $.turn.start({ text: 'edit it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/repo/a.ts', old_string: 'old', new_string: 'new' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  await ui.select({ key: 'diff-source', value: 't1' })
  expect(await ui.find({ type: 'Button', key: 'diff-refresh' })).toBeUndefined()
  sid = 's2'
  await $.turn.start({ text: 'after clear', turnId: 't2' })
  await ui.press({ key: 'tab-overview' })
  const before = runs
  await ui.press({ key: 'tab-diff' })
  expect(runs).toBeGreaterThan(before)
  expect(await ui.find({ type: 'Button', key: 'diff-refresh' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'not a git repository' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /a\.ts/ })).toBeUndefined()
  await ui.unmount()
})

test('a hunk over the drawing cap, a file without content changes, and git that cannot start each say so', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const huge = '-' + 'x'.repeat(95_000)
  let out: unknown = PROC(['diff --git a/big.txt b/big.txt', '--- a/big.txt', '+++ b/big.txt', '@@ -1,1 +1,0 @@', huge, ''].join('\n'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => ((e as unknown as { argv: string[] }).argv.includes('status') ? PROC('') : out) as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  expect(await ui.find({ type: 'Text', text: 'hunk too large to draw' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  out = PROC(['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,1 +1,1 @@', '-a', '+b', '@@ -9,1 +8,0 @@', huge, ''].join('\n'))
  await ui.press({ key: 'diff-refresh' })
  expect(await ui.find({ type: 'Text', text: '… 1 more hunk' })).toBeDefined()
  out = PROC(['diff --git a/old.ts b/gone.ts', 'similarity index 100%', 'rename from old.ts', 'rename to gone.ts', ''].join('\n'))
  await ui.press({ key: 'diff-refresh' })
  expect(await ui.find({ type: 'Text', text: 'no content changes' })).toBeDefined()
  out = { deny: 'spawn git ENOENT' }
  await ui.press({ key: 'diff-refresh' })
  expect(await ui.find({ type: 'Text', text: /^git could not run: / })).toBeDefined()
  await ui.unmount()
})

test('the Diff tab says r refreshes only after Tab leaves the Source picker', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => NOT_REPO)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  expect(await ui.find({ type: 'Text', text: /^\(Tab, then r\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /refreshes/ })).toBeUndefined()
  await ui.unmount()
})

test('a session with 70 edited turns still draws the Diff tab: Workspace and the 63 newest turns are offered', async ($, on) => {
  mock.clock(on, { now: 500_000 })
  const events: unknown[] = []
  for (let i = 1; i <= 70; i++) {
    events.push({ at: i * 1_000, turnId: `t${i}`, agentId: null, kind: 'turn-start', prompt: `edit ${i}` })
    events.push({ at: i * 1_000 + 1, turnId: `t${i}`, agentId: null, kind: 'edit', tool: 'Edit', file: '/repo/a.ts', added: 1, removed: 1 })
  }
  files(on).seed('s1', { version: 1, sessionId: 's1', startedAt: 0, endedAt: null, cwd: '/repo', firstPrompt: 'edit 1', events, counts: [] })
  home(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('process.run', () => NOT_REPO)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-diff' })
  const select = await ui.find({ type: 'Select', key: 'diff-source' })
  expect(select).toBeDefined()
  const options = (select?.props as { options: { value: string; label: string }[] }).options
  expect(options).toHaveLength(64)
  expect(options.slice(0, 2).map(o => o.label)).toEqual(['Workspace', 'Turn #70'])
  expect(options.at(-1)?.label).toBe('Turn #8')
  await ui.unmount()
})

test('a small selected file leaves the list what its code does not need: 200 long rows at 300 columns all drawn', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const path = (f: number) => `src/modules/very/deep/package/name/component-${f}/implementation-of-the-feature-${f}.ts`
  const diff = Array.from({ length: 200 }, (_, f) => [`diff --git a/${path(f)} b/${path(f)}`, `--- a/${path(f)}`, `+++ b/${path(f)}`, '@@ -1,1 +1,1 @@', '-old', '+new'].join('\n')).join('\n') + '\n'
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_$, e) => ((e as unknown as { argv: string[] }).argv.includes('status') ? PROC('') : PROC(diff)))
  await $.command.run({ command: 'binnacle', args: 'diff' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 300 } })
  // Each row is ~300 characters: half the budget holds about 140 of them, the whole of it all 200.
  expect(await ui.find({ type: 'Text', text: /more files/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button', text: /implementation-of-the-feature-\d+\.ts/ })).length).toBe(200)
  expect(await ui.find({ type: 'Code', text: /\+new/ })).toBeDefined()
  expect(await ui.find({ text: /more characters, not drawn/ })).toBeUndefined()
  await ui.unmount()
})
