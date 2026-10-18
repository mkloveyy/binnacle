import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { files, home, sessionFile } from './files.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'p', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}
const ANSWER = (value: string) => (_$: unknown, e: { questions: { question: string }[] }) => ({ result: { questions: e.questions, answers: { [e.questions[0].question]: value } }, text: '' })
const saved = (sessionId: string, prompt: string) => ({
  version: 1, sessionId, startedAt: 0, endedAt: 1, cwd: '/w/proj', firstPrompt: prompt,
  events: [{ at: 0, turnId: 'o1', agentId: null, kind: 'turn-start', prompt }], counts: [],
})
const indexRow = (sessionId: string, prompt: string) => ({ sessionId, startedAt: 0, endedAt: 1, cwd: '/w/proj', firstPrompt: prompt, bytes: 100 })

type Asked = { questions: { question: string }[] }

function mapStore(on: On, seed: Record<string, unknown> = {}) {
  const stored = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  return stored
}

/** The store in a Map, saved sessions as files in memory (`records`, by id), HOME `/home/u`. Before the test's own hooks. */
function saves(on: On, seed: Record<string, unknown> = {}, records: Record<string, unknown> = {}, options: Parameters<typeof files>[1] = {}) {
  const disk = files(on, options)
  home(on)
  for (const [id, r] of Object.entries(records)) disk.seed(id, r)
  return { stored: mapStore(on, seed), disk }
}

test('the Activity tab shows turns with their agents, and a selected node its details', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.turn.start({ text: 'look around', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ answer: 'Found it.', durationMs: 62_000, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /▾ #1\s+you\s+look around\s+running/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /✓ Explore\s+find store writes\s+1m02s/ })).toBeDefined()
  await ui.press({ key: 'node-agent:a1' })
  expect(await ui.find({ type: 'Text', text: 'Found it.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude --resume s1/ })).toBeDefined()
  await ui.unmount()
})

test("the turn holding a background agent stays open when Claude Code's hand-back turn comes after it", async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('prompt.submit', async (_$, e) => {
    await $.turn.start({ text: e.text, turnId: e.origin.kind === 'composer' ? 't1' : 't2' })
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'look around', origin: { kind: 'composer' }, wait: false })
  await $.agent.spawn({ ...SPAWN, background: true })
  await $.prompt.submit({ text: '<task-notification> done', origin: { kind: 'task-notification' }, wait: false })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /▾ #1\s+you\s+look around/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Explore\s+find store writes/ })).toBeDefined()
  await ui.unmount()
})

test('a saved session can be picked from the session list', async ($, on) => {
  mock.clock(on)
  saves(on, { 'activity:index': [indexRow('old', 'earlier work')] }, { old: saved('old', 'earlier work') })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'old' })
  expect(await ui.find({ type: 'Button', text: /#1\s+you\s+earlier work\s+unfinished/ })).toBeDefined()
  await ui.unmount()
})

test('a saved session still in the store from before 0.4.0 can be picked too', async ($, on) => {
  mock.clock(on)
  saves(on, { 'activity:index': [indexRow('old', 'earlier work')], 'activity:old': saved('old', 'earlier work') })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'old' })
  expect(await ui.find({ type: 'Button', text: /#1\s+you\s+earlier work\s+unfinished/ })).toBeDefined()
  await ui.unmount()
})

test('a saved session or index entry with a missing field still lets the Activity tab draw', async ($, on) => {
  mock.clock(on)
  saves(on, { 'activity:index': [{ sessionId: 'old', startedAt: 0, endedAt: 1, bytes: 1 }, indexRow('other', 'fine')] }, {
    old: { ...saved('old', 'x'), events: [{ at: 0, turnId: 'o1', agentId: null, kind: 'turn-start' }, { at: 0, turnId: 'o2', agentId: null, kind: 'turn-start', prompt: 'kept' }] },
  })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'old' })
  expect(await ui.find({ type: 'Button', text: /you\s+kept/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude --resume old/ })).toBeDefined()
  await ui.unmount()
})

test('an unreadable saved session says so and can be deleted', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('bad', 'x')] }, { bad: { version: 9 } })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'bad' })
  expect(await ui.find({ type: 'Text', text: 'unreadable' })).toBeDefined()
  await ui.press({ key: 'activity-delete' })
  expect(disk.removed).toEqual([sessionFile('bad')])
  expect(disk.has('bad')).toBe(false)
  expect(stored.get('activity:index')).toEqual([])
  await ui.unmount()
})

test('row labels are cut to the pane width', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'please look at every file in this repository and summarise it', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 40 } })
  await ui.press({ key: 'tab-activity' })
  const row = await ui.find({ key: 'node-turn:t1' })
  expect(row).toBeDefined()
  expect((row?.text ?? '').length).toBeLessThan(39)
  await ui.unmount()
})

test('permission, guard and error rows fit a 40-column pane', async ($, on) => {
  mock.clock(on)
  const long = 'kubectl get pods --namespace payments-production --selector app=checkout -o wide'
  const at = { at: 0, turnId: 'o1', agentId: null }
  saves(on, { 'activity:index': [indexRow('old', 'checks')] }, {
    old: {
      ...saved('old', 'checks'),
      events: [
        { ...at, kind: 'turn-start', prompt: 'checks' },
        { ...at, kind: 'perm', tool: 'Bash', summary: long, decision: 'ask', decider: 'user', outcome: 'denied-by-user' },
        { ...at, kind: 'guard', ruleId: 'k8s.all-namespaces', action: 'ask-deny', summary: long },
        { ...at, kind: 'error', tool: 'Bash', summary: long, message: `error: ${long} failed with a long message` },
      ],
    },
  })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 40 } })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'old' })
  for (const key of ['node-ev:1', 'node-ev:2', 'node-ev:3']) {
    const row = await ui.find({ key })
    expect(row).toBeDefined()
    expect((row?.text ?? '').length).toBeLessThanOrEqual(38)
  }
  await ui.unmount()
})

test('/binnacle activity clear asks, then deletes every saved session but this one', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('old', 'a'), indexRow('s1', 'b')] }, { old: saved('old', 'a'), s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let answer = 'Cancel'
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push((e as never as Asked).questions[0].question); return ANSWER(answer)(_$, e as never) })
  await $.turn.start({ text: 'b', turnId: 't1' })
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('nothing deleted.')
  expect(asked).toEqual(["This session is kept. Delete 1 saved session(s) from binnacle's activity history?"])
  expect(disk.has('old')).toBe(true)
  expect(disk.removed).toEqual([])
  answer = 'Delete'
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('deleted 1 saved session(s).')
  expect(disk.removed).toEqual([sessionFile('old')])
  expect(disk.has('old')).toBe(false)
  expect(disk.has('s1')).toBe(true)
  expect((stored.get('activity:index') as { sessionId: string }[]).map(x => x.sessionId)).toEqual(['s1'])
})

test('clear keeps the current session even before its record is loaded', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('old', 'a'), indexRow('s1', 'b')] }, { old: saved('old', 'a'), s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('Delete'))
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('deleted 1 saved session(s).')
  expect(disk.has('old')).toBe(false)
  expect(disk.has('s1')).toBe(true)
  expect((stored.get('activity:index') as { sessionId: string }[]).map(x => x.sessionId)).toEqual(['s1'])
})

test('clear without a known current session deletes nothing and does not ask', async ($, on) => {
  mock.clock(on)
  const { disk } = saves(on, { 'activity:index': [indexRow('old', 'a')] }, { old: saved('old', 'a') })
  on('session.id', () => ({ deny: 'not bound' }) as never)
  const asked: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Delete')(_$, e as never) })
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('nothing deleted.')
  expect(asked).toHaveLength(0)
  expect(disk.has('old')).toBe(true)
  expect(disk.removed).toEqual([])
})

test('clear with no one to ask (-p) deletes nothing', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('old', 'a'), indexRow('s1', 'b')] }, { old: saved('old', 'a'), s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'no one to ask' }))
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('nothing deleted.')
  expect(disk.has('old')).toBe(true)
  expect(disk.has('s1')).toBe(true)
  expect(disk.removed).toEqual([])
})

test('clear keeps a session saved while the question was open, and counts only deletes that worked', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(
    on,
    { 'activity:index': [indexRow('old', 'a'), indexRow('stuck', 'c'), indexRow('s1', 'b')] },
    { old: saved('old', 'a'), stuck: saved('stuck', 'c'), s1: saved('s1', 'b') },
    { keep: path => path === sessionFile('stuck') },
  )
  on('session.id', () => ({ value: 's1' }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    // Another terminal saves its session while the question is open.
    disk.seed('other', saved('other', 'd'))
    stored.set('activity:index', [...(stored.get('activity:index') as unknown[]), indexRow('other', 'd')])
    return ANSWER('Delete')(_$, e as never)
  })
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('deleted 1 saved session(s).')
  expect(disk.has('old')).toBe(false)
  expect(disk.has('stuck')).toBe(true)
  expect(disk.has('other')).toBe(true)
  expect((stored.get('activity:index') as { sessionId: string }[]).map(x => x.sessionId)).toEqual(['stuck', 's1', 'other'])
})

test('clear also deletes saved sessions the index lost, but not other keys', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('s1', 'b')], settings: { version: 1 } }, { s1: saved('s1', 'b'), orphan: saved('orphan', 'z') })
  disk.disk.set(`${sessionFile('s1')}.bak`, 'not a session file')
  on('session.id', () => ({ value: 's1' }))
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push((e as never as Asked).questions[0].question); return ANSWER('Delete')(_$, e as never) })
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('deleted 1 saved session(s).')
  expect(asked[0]).toContain('Delete 1 saved session(s)')
  expect(disk.removed).toEqual([sessionFile('orphan')])
  expect(disk.ids()).toEqual(['s1'])
  expect([...stored.keys()].sort()).toEqual(['activity:index', 'settings'])
})

test('clear also deletes records still in the store from before 0.4.0, the store key only', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('s1', 'b'), indexRow('legacy', 'l')], 'activity:legacy': saved('legacy', 'l'), settings: { version: 1 } }, { s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('Delete'))
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('deleted 1 saved session(s).')
  expect([...stored.keys()].sort()).toEqual(['activity:index', 'settings'])
  expect(disk.ids()).toEqual(['s1'])
})

test('an id with a slash or dots is never turned into a path, so no rm runs for it', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('s1', 'b'), indexRow('../../evil', 'x'), indexRow('ok', 'o')], 'activity:a/b': saved('a/b', 'y') }, { s1: saved('s1', 'b'), ok: saved('ok', 'o') })
  // Every process.run the plugin starts, whatever its argv: files() answers only rm -f under the data directory.
  const runs: (readonly string[])[] = []
  on('process.run', (_$, e) => { runs.push(e.argv); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.id', () => ({ value: 's1' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('Delete'))
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('deleted 3 saved session(s).')
  expect(disk.removed).toEqual([sessionFile('ok')])
  expect(runs).toEqual([])
  expect(stored.has('activity:a/b')).toBe(false)
  expect((stored.get('activity:index') as { sessionId: string }[]).map(x => x.sessionId)).toEqual(['s1'])
})

test('deleting an unreadable saved session whose id is not a file name runs no rm', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('../x', 'x')], 'activity:../x': { version: 9 } })
  const runs: (readonly string[])[] = []
  on('process.run', (_$, e) => { runs.push(e.argv); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: '../x' })
  expect(await ui.find({ type: 'Text', text: 'unreadable' })).toBeDefined()
  await ui.press({ key: 'activity-delete' })
  expect(disk.removed).toEqual([])
  expect(runs).toEqual([])
  expect(stored.has('activity:../x')).toBe(false)
  expect(stored.get('activity:index')).toEqual([])
  await ui.unmount()
})

test('after clear the panel shows this session and lists no deleted ones', async ($, on) => {
  mock.clock(on)
  saves(on, { 'activity:index': [indexRow('old', 'earlier work'), indexRow('s1', 'b')] }, { old: saved('old', 'earlier work'), s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('Delete'))
  await $.turn.start({ text: 'b', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'old' })
  expect(await ui.find({ type: 'Button', text: /#1\s+you\s+earlier work\s+unfinished/ })).toBeDefined()
  await $.command.run({ command: 'binnacle', args: 'activity clear' })
  const picker = await ui.find({ key: 'activity-session' })
  expect(picker?.props.value).toBe('current')
  expect((picker?.props.options as { value: string }[]).map(o => o.value)).toEqual(['current'])
  expect(await ui.find({ type: 'Text', text: 'unreadable' })).toBeUndefined()
  await ui.unmount()
})

test('after clear the session list drops deleted sessions even when this session was shown', async ($, on) => {
  mock.clock(on)
  saves(on, { 'activity:index': [indexRow('old', 'earlier work'), indexRow('s1', 'b')] }, { old: saved('old', 'earlier work'), s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('Delete'))
  await $.turn.start({ text: 'b', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  const options = async () => ((await ui.find({ key: 'activity-session' }))?.props.options as { value: string }[]).map(o => o.value)
  expect(await options()).toEqual(['current', 'old'])
  await $.command.run({ command: 'binnacle', args: 'activity clear' })
  expect(await options()).toEqual(['current'])
  await ui.unmount()
})

test('/binnacle activity opens the panel on the Activity tab', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  const r = await $.command.run({ command: 'binnacle', args: 'activity' })
  expect(r.text).toContain('opened')
  expect(writes.filter(w => w.key === 'tab').at(-1)?.value).toBe('activity')
})

test('the clear dialog lists Cancel first, so the cursor starts there and a stray Enter deletes nothing', async ($, on) => {
  mock.clock(on)
  const { stored, disk } = saves(on, { 'activity:index': [indexRow('old', 'a'), indexRow('s1', 'b')] }, { old: saved('old', 'a'), s1: saved('s1', 'b') })
  on('session.id', () => ({ value: 's1' }))
  let options: { label: string }[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    options = (e as never as { questions: { options: { label: string }[] }[] }).questions[0].options
    return ANSWER(options[0].label)(_$, e as never)
  })
  expect((await $.command.run({ command: 'binnacle', args: 'activity clear' })).text).toBe('nothing deleted.')
  expect(options.map(o => o.label)).toEqual(['Cancel', 'Delete'])
  expect(disk.has('old')).toBe(true)
  expect(disk.removed).toEqual([])
})
