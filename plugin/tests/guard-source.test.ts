import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import type { BinnacleGuardSource } from '../types'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { guardSourceOf } from '../hooks/modules/ext/ext.ts'
import { agentRows, buildTree } from '../hooks/modules/activity/tree.ts'
import { files, home, savedRecord } from './files.ts'

const REASON = 'sextant-guard: release-gate · sprint「p/early」当前在 4-executing，而 `deploy-tool confirm` 只应在 7-release 执行。确需现在执行就在系统终端里跑。'

const SRC: BinnacleGuardSource[] = [{ plugin: 'guardy', id: 'sextant-guard: ', prefix: 'sextant-guard: ', source: 'sextant-guard' }]
const sextantGuardOf = (t: string | undefined) => {
  const g = guardSourceOf(SRC, t)
  return g ? { ruleId: g.ruleId, reason: g.reason } : null
}

describe('guardSourceOf with sextant guard registered', () => {
  test('finds the rule after the prefix, wherever the prefix starts', () => {
    expect(sextantGuardOf(REASON)?.ruleId).toBe('release-gate')
    expect(sextantGuardOf(`PreToolUse:Bash hook error: ${REASON}`)).toEqual({ ruleId: 'release-gate', reason: expect.stringMatching(/^sextant-guard: release-gate · /) })
    expect(sextantGuardOf('sextant-guard: state-edit · token=abc123 是密钥')?.reason).toBe('sextant-guard: state-edit · token=*** 是密钥')
    expect(sextantGuardOf('Permission to use Bash has been denied.')).toBeNull()
    expect(sextantGuardOf(undefined)).toBeNull()
    expect(sextantGuardOf('Command failed: grep said sextant-guard: release-gate · boom')).toBeNull()
  })
  test('the saved reason is at most 120 characters', () => {
    expect(sextantGuardOf(`sextant-guard: guard-self · ${'x'.repeat(300)}`)?.reason).toHaveLength(120)
  })
})

describe('labels', () => {
  test('a sextant guard denial reads ⚑ sextant-guard · <rule> in Activity and in the agent details', () => {
    let s = append(newSession('s1', 0, '/r'), { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
    s = append(s, { at: 2, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'general', model: 'm', task: 'ship it', parentAgentId: null, background: false })
    s = append(s, { at: 3, turnId: 't1', agentId: 'a1', kind: 'perm', tool: 'Bash', summary: 'deploy-tool confirm --id 424242', decision: 'deny', decider: 'hook', outcome: null, reason: REASON, source: 'sextant-guard', ruleId: 'release-gate' })
    const agent = buildTree(s, 0, 0)[0]?.children?.[0]
    expect(agent?.children?.[0]).toMatchObject({ text: '⚑ sextant-guard · release-gate · deploy-tool confirm --id 424242', color: 'red' })
    expect(agentRows(s, 0, 10)[0]?.detail).toContain('  ⚑ sextant-guard · release-gate · deploy-tool confirm --id 424242')
  })
  test('control characters in a summary never reach the agent detail line', () => {
    let s = append(newSession('s1', 0, '/r'), { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
    s = append(s, { at: 2, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'general', model: 'm', task: 'ship it', parentAgentId: null, background: false })
    s = append(s, { at: 3, turnId: 't1', agentId: 'a1', kind: 'perm', tool: 'Bash', summary: 'x\u001b[31my', decision: 'deny', decider: 'hook', outcome: null, source: 'sextant-guard', ruleId: 'release-gate' })
    const line = agentRows(s, 0, 10)[0]?.detail?.find(l => l.includes('sextant-guard')) ?? ''
    // eslint-disable-next-line no-control-regex
    expect(line).not.toMatch(/\u001b/)
  })
})

type Ev = { kind: string; [k: string]: unknown }
type Rec = { events: Ev[] }

/** The session files, read back by savedRecord. */
let disk: ReturnType<typeof files>

/** An external guard: registers its prefixes as a plugin does, in session.start. */
const GUARDY: Plugin = {
  name: 'guardy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      await $.binnacle.guardSource({ prefix: 'sextant-guard: ', source: 'sextant-guard' })
      await $.binnacle.guardSource({ prefix: 'acme-gate: ', source: 'acme' })
      return r
    })
  },
}

function world(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 1_000, percent: 0.1 }, rateLimits: [] } }) as never)
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  disk = files(on)
  home(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  return (key: string) => writes.filter(w => w.key === key).at(-1)?.value
}

test('a settings hook denial with a sextant-guard reason is a perm event with its source and rule, not an error', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  // As the host gives it (P1 #1): its own prefix in front of the hook's reason.
  on('tool.check', () => ({ decision: 'deny', reason: `PreToolUse:Bash hook error: ${REASON}`, hook: 'PreToolUse' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: `PreToolUse:Bash hook error: ${REASON}` }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'deploy-tool confirm --id 424242' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'deploy-tool confirm --id 424242', tool_use_id: 'tu1' } as never)
  const events = ((await savedRecord($, disk)) as Rec).events.slice(1)
  expect(events).toEqual([expect.objectContaining({
    kind: 'perm', decision: 'deny', decider: 'hook', source: 'sextant-guard', ruleId: 'release-gate',
    reason: expect.stringMatching(/^sextant-guard: release-gate · /), summary: 'deploy-tool confirm --id 424242',
  })])
})

test('without a reason on tool.check, the prefix in the tool error still labels the denial', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'PreToolUse:Bash hook error: sextant-guard: guard-self · 守卫开关只能由人切换' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'sextant guard off release-gate', tool_use_id: 'tu1' } as never)
  const events = ((await savedRecord($, disk)) as Rec).events.slice(1)
  expect(events).toEqual([expect.objectContaining({ kind: 'perm', decision: 'deny', source: 'sextant-guard', ruleId: 'guard-self', summary: 'sextant guard off release-gate' })])
  expect(events.some(ev => ev.kind === 'error')).toBe(false)
})

test('another hook denial keeps its reason but no source', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'PreToolUse:Bash hook error: policy says no', hook: 'PreToolUse' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'PreToolUse:Bash hook error: policy says no' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const ev = ((await savedRecord($, disk)) as Rec).events[1]
  expect(ev).toMatchObject({ kind: 'perm', reason: 'PreToolUse:Bash hook error: policy says no' })
  expect(ev?.source).toBeUndefined()
})

test('guard text in the middle of a tool error is an error, not a guard denial', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'Command failed: grep said sextant-guard: release-gate · boom' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'grep x y', tool_use_id: 'tu1' } as never)
  const events = ((await savedRecord($, disk)) as Rec).events.slice(1)
  expect(events).toEqual([expect.objectContaining({ kind: 'error' })])
  expect(events[0]?.source).toBeUndefined()
})

test('guard text in the middle of a tool.check reason has no source', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'other hook: saw sextant-guard: release-gate · boom', hook: 'PreToolUse' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'other hook: saw sextant-guard: release-gate · boom' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const ev = ((await savedRecord($, disk)) as Rec).events[1]
  expect(ev).toMatchObject({ kind: 'perm', decision: 'deny' })
  expect(ev?.source).toBeUndefined()
})

test('a deny check without a reason takes the guard from the tool error text', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'deny', hook: 'PreToolUse' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'PreToolUse:Bash hook error: sextant-guard: guard-self · x' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const events = ((await savedRecord($, disk)) as Rec).events.slice(1)
  expect(events).toEqual([expect.objectContaining({ kind: 'perm', source: 'sextant-guard', ruleId: 'guard-self', reason: 'sextant-guard: guard-self · x' })])
})

test('an ask check whose reason carries the guard prefix is not a guard denial', { plugins: [GUARDY] }, async ($, on) => {
  const last = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'denied by the user' }) as never)
  // noteCheck keeps a reason for denials only; a stored ask that has one anyway must still not be labelled.
  const ask = { toolUseId: 'tu1', agentId: null, tool: 'Bash', summary: 'mkdir x', decision: 'ask', decider: 'hook', reason: REASON, at: 1_000 }
  on('state.get', async (_$, e, next) => {
    const r = (await next(e)) as unknown as { value: { version: number } }
    // Until binnacle writes `pending` itself, it reads as holding that one ask.
    return (e.key === 'pending' && last('pending') === undefined ? { value: { value: [ask], version: r.value.version } } : r) as never
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const ev = ((await savedRecord($, disk)) as Rec).events.find(e => e.kind === 'perm')
  expect(ev).toMatchObject({ kind: 'perm', decision: 'ask' })
  expect(ev?.source).toBeUndefined()
  expect(ev?.ruleId).toBeUndefined()
})

test('another registered guard: its denial is labelled with its own source', { plugins: [GUARDY] }, async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'PreToolUse:Bash hook error: acme-gate: prod-freeze · frozen until monday', hook: 'PreToolUse' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'PreToolUse:Bash hook error: acme-gate: prod-freeze · frozen until monday' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'deploy' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'deploy', tool_use_id: 'tu1' } as never)
  const ev = ((await savedRecord($, disk)) as Rec).events[1]
  expect(ev).toMatchObject({ kind: 'perm', source: 'acme', ruleId: 'prod-freeze', reason: 'acme-gate: prod-freeze · frozen until monday' })
})

test('with no guard registered, a sextant-guard reason is an ordinary hook denial', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'deny', reason: `PreToolUse:Bash hook error: ${REASON}`, hook: 'PreToolUse' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: `PreToolUse:Bash hook error: ${REASON}` }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'deploy-tool confirm --id 424242' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'deploy-tool confirm --id 424242', tool_use_id: 'tu1' } as never)
  const ev = ((await savedRecord($, disk)) as Rec).events[1]
  expect(ev).toMatchObject({ kind: 'perm', decision: 'deny', decider: 'hook' })
  expect(ev?.source).toBeUndefined()
})
