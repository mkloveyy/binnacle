import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} } }
const SPAWN = (id: string) => ({ tool_use_id: `tu-${id}`, prompt: 'p', description: `task ${id}`, subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false })
const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }

test('the Flow tab draws main, the agents main spawned and their calls', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++k}` }))
  on('tool.call', { tool: 'Grep' }, () => OK as never)
  await $.turn.start({ text: 'look around', turnId: 't1' })
  await $.agent.spawn(SPAWN('1'))
  await $.agent.spawn(SPAWN('2'))
  await $.tool.call({ tool: 'Grep', pattern: 'store.set', tool_use_id: 'g1', agentId: 'a1' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /^Flow\s+turn #1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /╭ main/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /╭ Explore.*╭ Explore/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ Grep/ })).toBeDefined()
  await ui.unmount()
})

test('an ask waiting past three seconds shows as waiting for approval', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'ask', reason: 'needs approval' }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin main' }, tool_use_id: 'q1' }).catch(() => undefined)
  await clock.advance(3_500)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /⏳ waiting for approval\s+Bash\s+git push --force origin main/ })).toBeDefined()
  await ui.unmount()
})

test('/binnacle flow opens on the Flow tab', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  await $.command.run({ command: 'binnacle', args: 'flow' })
  expect(writes.filter(w => w.key === 'tab').at(-1)?.value).toBe('flow')
})

test('while agents run the footer reads ☰ binnacle ●N and opens the Flow tab', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++k}` }))
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  const MODE = { component: 'SessionMode' as const, props: { modes: [] as string[] } }
  const idle = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect((await idle.find({ key: 'mode-panel' }))?.text).toBe('☰ binnacle')
  await idle.unmount()
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN('1'))
  await $.agent.spawn(SPAWN('2'))
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MODE })
  expect((await mode.find({ key: 'mode-panel' }))?.text).toBe('☰ binnacle ●2')
  await mode.press({ key: 'mode-panel' })
  expect(writes.filter(w => w.key === 'tab').at(-1)?.value).toBe('flow')
  expect(opened).toEqual(['binnacle'])
  await mode.unmount()
})

test("a subagent's own turn.start (2.1.300 fires one with the agent's prompt) is not a turn of main", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.turn.start({ text: 'look around', turnId: 't1' })
  await clock.advance(1_000)
  await $.agent.spawn({ ...SPAWN('1'), prompt: 'list the files under flow' })
  await clock.advance(5)
  await $.turn.start({ text: 'list the files under flow', turnId: 'sub' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /^Flow\s+turn #1 ·/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /"look around"/ })).toBeDefined()
  await ui.unmount()
})

test('agents spawned at once each have their own turn.start set aside', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++k}` }))
  await $.turn.start({ text: 'look around', turnId: 't1' })
  await clock.advance(1_000)
  await Promise.all(['one', 'two', 'three'].map(p => $.agent.spawn({ ...SPAWN(p), prompt: `task ${p}` })))
  await clock.advance(5)
  for (const p of ['one', 'two', 'three']) await $.turn.start({ text: `task ${p}`, turnId: `sub-${p}` })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /^Flow\s+turn #1 ·/ })).toBeDefined()
  await ui.unmount()
})

test('/clear empties what the Flow tab shows', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let id = 's1'
  on('session.id', () => ({ value: id }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.call', { tool: 'Bash' }, () => OK as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls old', tool_use_id: 'b1' } as never)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  id = 's2'
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /ls old/ })).toBeUndefined()
  await ui.unmount()
})

test("a call still running when main's turn ends is no longer drawn as running", async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  let release = () => {}
  const gate = new Promise<void>(r => { release = r })
  on('tool.call', { tool: 'Bash' }, async () => { await gate; return OK as never })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const pending = $.tool.call({ tool: 'Bash', command: 'sleep 100', tool_use_id: 'b1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'answer' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /● Bash/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /✗ Bash +sleep 100/ })).toBeDefined()
  await ui.unmount()
  release()
  await pending
})

test("the person's own prompt is a turn even when an agent was just given the same words", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  let n = 0
  on('prompt.submit', async (_$, e) => {
    await $.turn.start({ text: e.text, turnId: `p${++n}` })
    return { text: e.text }
  })
  await $.turn.start({ text: 'look around', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN('1'), prompt: 'same words' })
  await clock.advance(1_000)
  await $.prompt.submit({ text: 'same words', origin: { kind: 'composer' }, wait: false })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-flow' })
  expect(await ui.find({ type: 'Text', text: /^Flow\s+turn #2 ·/ })).toBeDefined()
  await ui.unmount()
})

test('the footer button closes the panel when it already shows Flow', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('ui.panes', () => ({ value: [{ id: 'binnacle' }] }) as never)
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN('1'))
  await $.command.run({ command: 'binnacle', args: 'flow' }).catch(() => undefined)
  const mode = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'SessionMode' as const, props: { modes: [] as string[] } })
  await mode.press({ key: 'mode-panel' })
  expect(closed).toEqual(['binnacle'])
  await mode.unmount()
})

test('one tool call with its check asks for two redraws, not three', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'allow', rule: 'Bash(ls:*)' }))
  on('tool.call', { tool: 'Bash' }, () => OK as never)
  const writes: string[] = []
  on('state.set', (_$, e, next) => { writes.push(e.key); return next(e) })
  await $.turn.start({ text: 'go', turnId: 't1' })
  writes.length = 0
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'b1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'b1' } as never)
  expect(writes.filter(k => k === 'flow')).toHaveLength(2)
})

for (const [lastBy, waits] of [['classifier', false], ['user_temporary', true]] as const) {
  test(`an ask 20 s old ${waits ? 'still waits when the person settled the last ask' : 'was settled when the classifier settles asks here (auto mode): its call runs'}`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
    on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/repo' } }) as never)
    on('fs.exists', (_$, e) => ({ value: e.path === '/home/u/.claude/projects/-repo/s1.jsonl' }))
    on('fs.list', () => ({ value: [] }))
    // The transcript says who settled the session's last ask: no API gives the permission mode.
    on('process.run', (_$, e) => {
      const argv = [...(e as unknown as { argv: string[] }).argv]
      const out = argv[1] === '-oE' && argv[2]?.includes('permissionDecision') ? `"permissionDecision":{"decision":"accept","source":"${lastBy === 'classifier' ? 'config' : lastBy}","reasonType":"${lastBy === 'classifier' ? 'classifier' : 'other'}"}\n` : ''
      return { value: { exitCode: out ? 0 : 1, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    })
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.check', () => ({ decision: 'ask', reason: 'needs approval' }))
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.settle()
    await $.tool.check({ tool: 'Bash', input: { command: 'ping -c 90 127.0.0.1' }, tool_use_id: 'q1' }).catch(() => undefined)
    await clock.advance(20_000)
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-flow' })
    const row = await ui.find({ type: 'Text', text: /⏳ waiting for approval/ })
    if (waits) expect(row).toBeDefined()
    else expect(row).toBeUndefined()
    await ui.unmount()
  })
}
