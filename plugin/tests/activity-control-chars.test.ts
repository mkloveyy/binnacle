import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { files, home } from './files.ts'

// The host refuses a whole tree over one control character in drawn text: each outside string reaching the Activity
// and Agents tabs, the session list, the Permissions page or Settings must be drawn with stand-ins.

const ESC = '\x1b'
const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const HOST = () => Fragment({})
const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'p', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}

function mapStore(on: On, seed: Record<string, unknown> = {}) {
  const stored = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  return stored
}

/** A record saved before control characters were made visible when recording: every outside field holds one raw. */
const RAW = `x${ESC}[31my`
const at = { at: 0, turnId: 'o1', agentId: null }
const rawSession = (sessionId: string) => ({
  version: 1, sessionId, startedAt: 0, endedAt: 1, cwd: `/w/${RAW}`, firstPrompt: RAW,
  events: [
    { ...at, kind: 'turn-start', prompt: RAW },
    { ...at, agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: `task ${RAW}`, parentAgentId: null, background: false },
    { ...at, agentId: 'a1', kind: 'agent-end', durationMs: 1, tokensIn: 1, tokensOut: 1, aborted: false, report: [`report ${RAW}`] },
    { ...at, kind: 'perm', tool: 'Bash', summary: `perm ${RAW}`, decision: 'ask', decider: 'user', outcome: 'denied-by-user' },
    { ...at, kind: 'guard', ruleId: `rule${ESC}`, action: 'deny', summary: `guard ${RAW}` },
    { ...at, kind: 'error', tool: 'Bash', summary: `err ${RAW}`, message: `msg ${RAW}` },
    { ...at, kind: 'edit', tool: 'Edit', file: `/w/f${ESC}.ts`, added: 1, removed: 0 },
  ],
  counts: [],
})
const rawIndex = (sessionId: string) => ({ sessionId, startedAt: 0, endedAt: 1, cwd: `/w/${RAW}`, firstPrompt: RAW, bytes: 100 })

test('a prompt with an escape sequence is saved and drawn with stand-ins', async ($, on) => {
  files(on)
  home(on)
  mock.clock(on)
  const stored = mapStore(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: `why is ${ESC}[31mred`, turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((stored.get('activity:index') as { firstPrompt: string }[])[0]?.firstPrompt).toBe('why is ^[[31mred')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /#1\s+you\s+why is \^\[\[31mred/ })).toBeDefined()
  await ui.unmount()
})

test('a tool error with colour codes draws in the Activity tab', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: `${ESC}[31mFAIL${ESC}[0m tests/a.test.ts` }) as never)
  await $.turn.start({ text: 'run tests', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'tu1' } as never)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /✗ Bash\s+\^\[\[31mFAIL\^\[\[0m/ })).toBeDefined()
  await ui.press({ key: 'node-ev:1' })
  expect(await ui.find({ type: 'Text', text: /^message: \^\[\[31mFAIL/ })).toBeDefined()
  await ui.unmount()
})

test("an agent's description with an escape sequence draws in the Agents and Activity tabs", async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.render', HOST)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, description: `find ${ESC}[1mstore` })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /● Explore\s+find \^\[\[1mstore/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Explore\s+find \^\[\[1mstore/ })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /Explore\s+find \^\[\[1mstore/ })).toBeDefined()
  await ui.unmount()
})

test("a subagent's waiting ask with an escape sequence in its command draws in the Agents tab", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('ui.render', HOST)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.check', () => ({ decision: 'ask', reason: 'r' }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  await $.tool.check({ tool: 'Bash', input: { command: `printf '${ESC}[2J'` }, tool_use_id: 'tu1', agentId: 'a1' } as never)
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /⏸ Explore\s+approval\? printf '\^\[\[2J'/ })).toBeDefined()
  await ui.unmount()
})

test('a guard summary with an escape sequence draws on the Permissions page', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }))
  const r = await $.tool.call({ tool: 'Bash', command: `kubectl get pods -A -l app=${ESC}x` })
  expect(r.deny).toContain('binnacle:')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  expect(await ui.find({ type: 'Text', text: /deny .*k8s\.all-namespaces .*app=\^\[x/ })).toBeDefined()
  await ui.unmount()
})

/** Another plugin that registers a rule and records a guard event with escape sequences when the session starts. */
const PACK: Plugin = {
  name: 'packy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      // The plugin runs on its own: no closure over this file's constants.
      await $.binnacle.register({ id: 'pack.rule', pack: 'pack\x1b', title: 'title \x1b[1m', action: 'ask' })
      await $.binnacle.record({ ruleId: 'pack.rule\x1b', action: 'deny', summary: 'drop \x1b[1mtable' })
      return r
    })
  },
}

test("another plugin's guard record, rule pack and title with escape sequences draw on the Permissions and Settings pages", { plugins: [PACK] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  expect(await ui.find({ type: 'Text', text: /deny .*pack\.rule\^\[ +drop \^\[\[1mtable/ })).toBeDefined()
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'rule-pack.rule', text: /pack\^\[ · title \^\[\[1m/ })).toBeDefined()
  await ui.unmount()
})

test('a saved session stored with raw control characters draws in the session list, its rows and details', async ($, on) => {
  files(on).seed('old', rawSession('old'))
  home(on)
  mock.clock(on)
  mapStore(on, { 'activity:index': [rawIndex('old')] })
  on('session.id', () => ({ value: 's1' }))
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  await ui.select({ key: 'activity-session', value: 'old' })
  expect(await ui.find({ type: 'Button', text: /#1\s+you\s+x\^\[\[31my\s+unfinished/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /f\^\[\.ts/ })).toBeDefined()
  // Each press draws that node's details; the turn goes last, as pressing it folds its rows away.
  for (const [key, detail] of [['node-agent:a1', /^ {2}report x\^\[/], ['node-ev:3', /^summary: perm x\^\[/], ['node-ev:4', /^ruleId: rule\^\[/], ['node-ev:5', /^message: msg x\^\[/], ['node-ev:6', /^file: \/w\/f\^\[/], ['node-turn:o1', /^prompt: x\^\[/]] as const) {
    await ui.press({ key })
    expect(await ui.find({ type: 'Text', text: detail })).toBeDefined()
  }
  await ui.unmount()
})

test('a resumed session stored with raw control characters draws in the Agents tab and on the Permissions page', async ($, on) => {
  mock.clock(on)
  // The agent never ended: the Agents tab lists it, unfinished.
  const s = rawSession('old')
  files(on).seed('old', { ...s, events: s.events.filter(ev => ev.kind !== 'agent-end') })
  home(on)
  mapStore(on, { 'activity:index': [rawIndex('old')] })
  on('ui.render', HOST)
  on('session.id', () => ({ value: 'old' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'go on', turnId: 't2' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /Explore\s+task x\^\[\[31my/ })).toBeDefined()
  await ui.press({ key: 'tab-perm' })
  expect(await ui.find({ type: 'Text', text: /rule\^\[ +guard x\^\[\[31my/ })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Button', text: /you\s+x\^\[\[31my/ })).toBeDefined()
  await ui.unmount()
})

/** Another plugin that registers rules whose action is not one binnacle knows, one with a control character. */
const BAD_ACTION: Plugin = {
  name: 'packz',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.register({ id: 'packz.ok', pack: 'packz', title: 'fine rule', action: 'ask' })
      await $.binnacle.register({ id: 'packz.esc', pack: 'packz', title: 'escape action', action: 'ask\x1b[1m' as never })
      await $.binnacle.register({ id: 'packz.long', pack: 'packz', title: 'long action', action: 'refuse-'.repeat(30) as never })
      return r
    })
  },
}

test("another plugin's rule with an action binnacle does not know is dropped; Settings still draws (final review)", { plugins: [BAD_ACTION] }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'rule-packz.ok', text: /packz · fine rule\s+ask$/ })).toBeDefined()
  expect(await ui.find({ key: 'rule-packz.esc' })).toBeUndefined()
  expect(await ui.find({ key: 'rule-packz.long' })).toBeUndefined()
  await ui.unmount()
})
