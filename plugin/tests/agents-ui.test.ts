import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { files, home } from './files.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'p', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false,
}

/** A session with a clock, a store, the turn and spawn bottoms, and a count of redraw requests. */
function world(on: On, seed: Record<string, unknown> = {}, records: Record<string, unknown> = {}) {
  const disk = files(on)
  for (const [id, r] of Object.entries(records)) disk.seed(id, r)
  home(on)
  const clock = mock.clock(on)
  mock.store(on, seed)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  const redraws = { n: 0 }
  on('ui.invalidate', () => { redraws.n++; return { value: undefined } })
  return { clock, redraws }
}

test('the Agents tab lists live rows on top and every agent of the session below, with details', async ($, on) => {
  const { clock } = world(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'mkdir needs approval' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /^ ● Explore\s+find store writes\s+0s\s+0 steps$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Explore\s+find store writes\s+0s\s+0 steps\s+running/ })).toBeDefined()
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1', agentId: 'a1' })
  await clock.advance(4_000)
  await ui.redraw(PANE.props)
  expect(await ui.find({ type: 'Text', text: /^ ⏸ Explore\s+approval\? mkdir x\s+4s$/ })).toBeDefined()
  await ui.press({ key: 'agent-agent:a1' })
  expect(await ui.find({ type: 'Text', text: 'task: find store writes' })).toBeDefined()
  await ui.unmount()
})

test('with nothing live the Agents tab says no agents are running', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: 'no agents running' })).toBeDefined()
  await ui.unmount()
})

test('the Agents tab redraws itself about every second, only while it is the tab drawn', async ($, on) => {
  const { clock, redraws } = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  const over10s = async (): Promise<number> => {
    redraws.n = 0
    for (let i = 0; i < 10; i++) {
      await clock.advance(1_000)
      await ui.redraw(PANE.props)
    }
    return redraws.n
  }
  await ui.press({ key: 'tab-overview' })
  const idle = await over10s()
  await ui.press({ key: 'tab-agents' })
  expect(await over10s()).toBeGreaterThanOrEqual(idle + 8)
  await ui.press({ key: 'tab-activity' })
  await clock.advance(2_000)
  expect(await over10s()).toBeLessThanOrEqual(idle + 1)
  await ui.unmount()
})

test('/binnacle agents opens the panel on the Agents tab', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  const r = await $.command.run({ command: 'binnacle', args: 'agents' })
  expect(r.text).toContain('opened')
  expect(writes.filter(w => w.key === 'tab').at(-1)?.value).toBe('agents')
})

test('the Agents history lists at most 400 agents, newest first, and counts the rest', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const events: unknown[] = [{ at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' }]
  for (let i = 0; i < 410; i++) {
    events.push({ at: 10 + i, turnId: 't1', agentId: `a${i}`, kind: 'agent-start', agentType: 'Explore', model: 'm', task: `task ${i}`, parentAgentId: null, background: true })
    events.push({ at: 500 + i, turnId: 't1', agentId: `a${i}`, kind: 'agent-end', durationMs: 1, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
  }
  files(on).seed('s1', { version: 1, sessionId: 's1', startedAt: 0, endedAt: null, cwd: '/repo', firstPrompt: 'go', events, counts: [] })
  home(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  const rows = await ui.findAll({ type: 'Button', text: /^ Explore\s+task \d+/ })
  expect(rows).toHaveLength(400)
  expect(rows[0]?.text).toMatch(/^ Explore\s+task 409\s/)
  expect(await ui.find({ type: 'Text', text: '… and 10 more' })).toBeDefined()
  await ui.unmount()
})

test('the Agents tab does not redraw itself while nothing on it moves (only history and a denial)', async ($, on) => {
  const { clock, redraws } = world(on)
  on('tool.check', () => ({ decision: 'deny', rule: 'Bash(rm:*)' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'denied' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, background: false })
  await $.turn.complete({ answer: 'done', durationMs: 1_000, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'tu1' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /^ ✗ 1 denied this turn$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /✓ done/ })).toBeDefined()
  await clock.advance(1_000)
  redraws.n = 0
  for (let i = 0; i < 10; i++) {
    await clock.advance(1_000)
    await ui.redraw(PANE.props)
  }
  expect(redraws.n).toBeLessThanOrEqual(1)
  await ui.unmount()
})

test('a refused redraw timer is asked for again at a later draw, so the tab does not stay still', async ($, on) => {
  // A clock of the test's own, so one wait can be refused: mock.clock answers every wait.
  let now = 0
  let refuse = true
  const waits: { due: number; done: () => void }[] = []
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ deny: 'not in this test' }) as never)
  on('clock.after', (_$, e) => (refuse ? ({ deny: 'busy' } as never) : new Promise(r => waits.push({ due: now + e.ms, done: () => r({ value: undefined } as never) }))))
  const advance = async (ms: number): Promise<void> => {
    now += ms
    for (const w of waits.splice(0).filter(x => (x.due <= now ? (x.done(), false) : true))) waits.push(w)
    await new Promise(r => setTimeout(r, 5))
  }
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  const redraws = { n: 0 }
  on('ui.invalidate', () => { redraws.n++; return { value: undefined } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  refuse = false
  await advance(3_000)
  await ui.redraw(PANE.props)
  redraws.n = 0
  for (let i = 0; i < 5; i++) {
    await advance(1_000)
    await ui.redraw(PANE.props)
  }
  expect(redraws.n).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})

test("a saved session in the Agents tab shows no live rows and does not redraw, even while this session's agent runs", async ($, on) => {
  const { clock, redraws } = world(on, {
    'activity:index': [{ sessionId: 'old', startedAt: 0, endedAt: 1, cwd: '/repo', firstPrompt: 'before', bytes: 100 }],
  }, {
    old: {
      version: 1, sessionId: 'old', startedAt: 0, endedAt: 1, cwd: '/repo', firstPrompt: 'before', counts: [],
      events: [{ at: 0, turnId: 'o1', agentId: null, kind: 'turn-start', prompt: 'before' }],
    },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.select({ key: 'agents-session', value: 'old' })
  expect(await ui.find({ type: 'Text', text: /^ ●/ })).toBeUndefined()
  await clock.advance(2_000)
  redraws.n = 0
  for (let i = 0; i < 10; i++) {
    await clock.advance(1_000)
    await ui.redraw(PANE.props)
  }
  expect(redraws.n).toBeLessThanOrEqual(1)
  await ui.unmount()
})

test('400 history rows on a very wide pane stay within the drawing budget; the rest are counted', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const events: unknown[] = [{ at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' }]
  for (let i = 0; i < 410; i++) {
    events.push({ at: 10 + i, turnId: 't1', agentId: `a${i}`, kind: 'agent-start', agentType: 'Explore', model: 'm', task: `task ${i}`, parentAgentId: null, background: true })
    events.push({ at: 500 + i, turnId: 't1', agentId: `a${i}`, kind: 'agent-end', durationMs: 1, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
  }
  files(on).seed('s1', { version: 1, sessionId: 's1', startedAt: 0, endedAt: null, cwd: '/repo', firstPrompt: 'go', events, counts: [] })
  home(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const wide = { ...PANE, props: { ...PANE.props, bodyColumns: 300 } }
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...wide })
  await ui.press({ key: 'tab-agents' })
  const rows = await ui.findAll({ type: 'Button', text: /^ Explore\s+task \d+/ })
  expect(rows.length).toBeLessThan(400)
  // The host's own cut marker: past ~100k characters it cuts the tree and says so.
  expect(await ui.find({ text: /more characters, not drawn/ })).toBeUndefined()
  expect(rows[0]?.text).toMatch(/^ Explore\s+task 409\s/)
  expect(await ui.find({ type: 'Text', text: `… and ${410 - rows.length} more` })).toBeDefined()
  await ui.unmount()
})
