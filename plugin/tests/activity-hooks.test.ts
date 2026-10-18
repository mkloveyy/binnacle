import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { files, home, savedRecord } from './files.ts'

type Ev = { kind: string; [k: string]: unknown }
type Rec = { sessionId: string; endedAt: number | null; events: Ev[]; counts: { turnId: string; agentId: string | null; files: number; shell: number; other: number }[] }

const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'Find where the store is written', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}
const EDIT = {
  filePath: '/repo/a.ts', oldString: 'old', newString: 'new', originalFile: 'keep\nold\n', userModified: false, replaceAll: false,
  structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' keep', '-old', '+new'] }],
}

/** A session id, a cwd, the turn and spawn bottoms, and a reader for the last value written to a state key. */
/** The session files, read back by savedRecord. */
let disk: ReturnType<typeof files>

function world(on: On) {
  disk = files(on)
  home(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  return (key: string) => writes.filter(w => w.key === key).at(-1)?.value
}

test('a turn with a subagent is recorded as turn and agent events with counts', async ($, on) => {
  const last = world(on)
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.turn.start({ text: 'look around', turnId: 't1' })
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu1', agentId: 'a1' } as never)
  await $.turn.complete({
    answer: 'Found it.\nIn store.ts', durationMs: 4_000, isAborted: false, turnId: 't9', agentId: 'a1', reason: 'answer',
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' },
  })
  await $.turn.complete({ answer: 'done', durationMs: 9_000, isAborted: false, turnId: 't1', reason: 'answer' })
  const s = (await savedRecord($, disk)) as Rec
  expect(s.sessionId).toBe('s1')
  expect(s.events.map(ev => ev.kind)).toEqual(['turn-start', 'agent-start', 'agent-end', 'turn-end'])
  expect(s.events[1]).toMatchObject({ turnId: 't1', agentId: 'a1', agentType: 'Explore', task: 'find store writes', model: 'claude-haiku-5-5', background: false })
  expect(s.events[2]).toMatchObject({ turnId: 't1', agentId: 'a1', tokensIn: 10, tokensOut: 5, report: ['Found it.', 'In store.ts'] })
  expect(s.events[3]).toMatchObject({ turnId: 't1', agentId: null, durationMs: 9_000 })
  expect(s.counts).toEqual([{ turnId: 't1', agentId: 'a1', files: 0, shell: 1, other: 0 }])
})

test("a turn Claude Code starts itself, such as a background agent's hand-back, is marked auto; the person's are not", async ($, on) => {
  const last = world(on)
  let n = 0
  // The engine starts the turn inside prompt.submit (probe 2026-10-12: prompt.submit, then turn.start, then next resolves).
  on('prompt.submit', async (_$, e) => {
    await $.turn.start({ text: e.text, turnId: `t${++n}` })
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '<task-notification> done', origin: { kind: 'task-notification' }, wait: false })
  await $.prompt.submit({ text: '<agent-message from="a1"> [Subagent hand-back]', origin: { kind: 'peer' }, wait: false })
  await $.turn.start({ text: '', turnId: 't9' })
  const turns = ((await savedRecord($, disk)) as Rec).events.filter(ev => ev.kind === 'turn-start')
  expect(turns.map(ev => [ev.turnId, ev.auto ?? false])).toEqual([['t1', false], ['t2', true], ['t3', true], ['t9', false]])
})

test("a plugin's prompt is marked auto unless it was submitted as the person's own words (asUser)", async ($, on) => {
  const last = world(on)
  let n = 0
  on('prompt.submit', async (_$, e) => {
    await $.turn.start({ text: e.text, turnId: `t${++n}` })
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'from a plugin', origin: { kind: 'plugin', name: 'other' }, wait: false })
  await $.prompt.submit({ text: 'dictated', origin: { kind: 'plugin', name: 'voice', asUser: true }, wait: false })
  const turns = ((await savedRecord($, disk)) as Rec).events.filter(ev => ev.kind === 'turn-start')
  expect(turns.map(ev => [ev.turnId, ev.auto ?? false])).toEqual([['t1', true], ['t2', false]])
})

test('a turn whose text a hook beneath rewrote still takes the one submission under way', async ($, on) => {
  const last = world(on)
  on('prompt.submit', async (_$, e) => {
    await $.turn.start({ text: `${e.text} (with context)`, turnId: 't1' })
    return { text: e.text }
  })
  await $.prompt.submit({ text: '<task-notification> done', origin: { kind: 'task-notification' }, wait: false })
  const turns = ((await savedRecord($, disk)) as Rec).events.filter(ev => ev.kind === 'turn-start')
  expect(turns.map(ev => [ev.turnId, ev.auto ?? false])).toEqual([['t1', true]])
})

test('two submissions under way at once each mark their own turn', async ($, on) => {
  const last = world(on)
  let release: () => void = () => undefined
  const gate = new Promise<void>(r => { release = r })
  on('prompt.submit', async (_$, e) => {
    if (e.origin.kind === 'task-notification') await gate
    await $.turn.start({ text: e.text, turnId: e.origin.kind === 'task-notification' ? 't-hand-back' : 't-person' })
    return { text: e.text }
  })
  const handBack = $.prompt.submit({ text: '<task-notification> done', origin: { kind: 'task-notification' }, wait: false })
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false })
  release()
  await handBack
  const turns = ((await savedRecord($, disk)) as Rec).events.filter(ev => ev.kind === 'turn-start')
  expect(turns.map(ev => [ev.turnId, ev.auto ?? false])).toEqual([['t-person', false], ['t-hand-back', true]])
})

test('a prompt with a secret is recorded masked', async ($, on) => {
  const last = world(on)
  await $.turn.start({ text: 'deploy with API_KEY=sk12345678 please', turnId: 't1' })
  expect(((await savedRecord($, disk)) as Rec).events[0]).toMatchObject({ kind: 'turn-start', prompt: 'deploy with API_KEY=*** please' })
})

test('an ask the person refuses is a perm event, not an error', async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'mkdir needs approval' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: "The user doesn't want to proceed with this tool use. The tool use was rejected." }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' })
  expect(last('pending')).toEqual([expect.objectContaining({ toolUseId: 'tu1', decision: 'ask', summary: 'mkdir x' })])
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([expect.objectContaining({ kind: 'perm', decision: 'ask', outcome: 'denied-by-user', decider: 'user', summary: 'mkdir x' })])
  expect(s.counts).toEqual([])
  expect(last('pending')).toEqual([])
})

test("a subagent's ask the person refuses is one denial, not an error", async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'mkdir needs approval' }))
  // What 2.1.296 answers a background subagent's call after "4. No" in its dialog (probe 2026-10-12).
  const refused = 'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.'
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: `Error: ${refused}`, text: refused }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, background: true })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir newdir' }, tool_use_id: 'tu1', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir newdir', tool_use_id: 'tu1', agentId: 'a1' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(2)).toEqual([expect.objectContaining({ kind: 'perm', agentId: 'a1', decision: 'ask', outcome: 'denied-by-user', decider: 'user', summary: 'mkdir newdir' })])
  const pane = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'Pane', requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  await pane.press({ key: 'tab-agents' })
  expect(await pane.find({ type: 'Text', text: /^ ✗ 1 denied this turn$/ })).toBeDefined()
  await pane.unmount()
})

test("Claude Code's background-agent summary refusing a tool is not an error; other failures of unnamed loops are", async ($, on) => {
  const last = world(on)
  // 2.1.296 summarises a running background agent in a loop of its own (new agentId, no agent.spawn) that refuses every tool (probe 2026-10-12).
  on('tool.call', { tool: 'Bash' }, (_$, e) => (e.command === 'false'
    ? { isError: true, result: 'exit 1', text: 'Exit code 1' }
    : { isError: true, result: 'Error: No tools needed for summary', text: 'No tools needed for summary' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, background: true })
  await $.tool.call({ tool: 'Bash', command: 'mkdir newdir', tool_use_id: 'tu9', agentId: 'ad930bdc9f52b9f1e' } as never)
  expect(((await savedRecord($, disk)) as Rec).events.slice(2)).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'tu1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'tu2', agentId: 'a1' } as never)
  // An agent whose agent-start this record lacks (started before /clear, or its write failed) still has its errors kept.
  await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'tu3', agentId: 'before-clear' } as never)
  expect(((await savedRecord($, disk)) as Rec).events.slice(2)).toEqual([
    expect.objectContaining({ kind: 'error', agentId: null, message: 'Exit code 1' }),
    expect.objectContaining({ kind: 'error', agentId: 'a1', message: 'Exit code 1' }),
    expect.objectContaining({ kind: 'error', agentId: null, message: 'Exit code 1' }),
  ])
})

test("a call from an unnamed loop keeps its permission row even when its refusal is the summary loop's", async ($, on) => {
  const last = world(on)
  on('tool.check', (_$, e) => ({ decision: (e.input as { command: string }).command === 'rm x' ? 'deny' : 'ask', rule: 'Bash(rm:*)' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'Error: No tools needed for summary', text: 'No tools needed for summary' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1', agentId: 'unnamed' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1', agentId: 'unnamed' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'tu2', agentId: 'unnamed' })
  await $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'tu2', agentId: 'unnamed' } as never)
  expect(((await savedRecord($, disk)) as Rec).events.slice(1)).toEqual([
    expect.objectContaining({ kind: 'perm', agentId: null, decision: 'ask', summary: 'mkdir x' }),
    expect.objectContaining({ kind: 'perm', agentId: null, decision: 'deny', summary: 'rm x' }),
  ])
})

test("the summary loop's refusal text from a known agent or the main loop is still an error", async ($, on) => {
  const last = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'Error: No tools needed for summary', text: 'No tools needed for summary' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, background: true })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu1', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu2' } as never)
  expect(((await savedRecord($, disk)) as Rec).events.slice(2)).toEqual([
    expect.objectContaining({ kind: 'error', agentId: 'a1', message: 'No tools needed for summary' }),
    expect.objectContaining({ kind: 'error', agentId: null, message: 'No tools needed for summary' }),
  ])
})

test('an ask that is approved is a perm event and the call is counted', async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'mkdir needs approval' }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([expect.objectContaining({ kind: 'perm', decision: 'ask', outcome: 'approved', decider: 'unknown', summary: 'mkdir x' })])
  expect(s.counts).toEqual([{ turnId: 't1', agentId: null, files: 0, shell: 1, other: 0 }])
})

test('a call a rule denies at tool.check is a perm event with no outcome, not an error', async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'deny', rule: 'Bash(rm:*)' }))
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'Permission to use Bash with command rm x has been denied.' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'tu1' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([expect.objectContaining({ kind: 'perm', decision: 'deny', outcome: null, decider: 'rule', summary: 'rm x' })])
  expect(s.counts).toEqual([])
})

test('a call the guard refuses after a host ask counts once, as the guard row', async ($, on) => {
  const last = world(on)
  on('ui.render', () => Fragment({}))
  on('tool.check', () => ({ decision: 'ask', reason: 'needs approval' }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'kubectl get pods -A' }, tool_use_id: 'tu1' })
  const r = await $.tool.call({ tool: 'Bash', command: 'kubectl get pods -A', tool_use_id: 'tu1' } as never)
  expect(r.deny).toContain('binnacle:')
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([expect.objectContaining({ kind: 'guard', action: 'deny', ruleId: 'k8s.all-namespaces' })])
  expect(last('pending')).toEqual([])
  const pane = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'Pane', requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  await pane.press({ key: 'tab-agents' })
  expect(await pane.find({ type: 'Text', text: /^ ✗ 1 denied this turn$/ })).toBeDefined()
  await pane.unmount()
})

test('a call another hook refuses after a host ask is a perm event', async ($, on) => {
  const last = world(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'needs approval' }))
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'policy says no' }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([expect.objectContaining({ kind: 'perm', decision: 'ask', outcome: 'denied-by-hook', decider: 'hook' })])
})

test('a permission tally that fails to save does not drop the perm event', async ($, on) => {
  const disk = files(on)
  home(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => {
    if (e.key === 'perm') return { deny: 'state full' } as never
    writes.push(e as never)
    return next(e)
  })
  on('tool.check', () => ({ decision: 'ask', reason: 'mkdir needs approval' }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'mkdir x' }, tool_use_id: 'tu1' }).catch(() => undefined)
  await $.tool.call({ tool: 'Bash', command: 'mkdir x', tool_use_id: 'tu1' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([expect.objectContaining({ kind: 'perm', decision: 'ask', outcome: 'approved' })])
})

test('a failed call is an error event; an edit is recorded with its line counts and patch', async ($, on) => {
  const last = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: 'exit 1', text: 'Exit code 1\nls: nope: No such file' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: EDIT, text: 'ok' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls nope', tool_use_id: 'tu1' } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'tu2', file_path: '/repo/a.ts', old_string: 'old', new_string: 'new' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.slice(1)).toEqual([
    expect.objectContaining({ kind: 'error', tool: 'Bash', message: 'Exit code 1', summary: 'ls nope' }),
    expect.objectContaining({ kind: 'edit', tool: 'Edit', file: '/repo/a.ts', added: 1, removed: 1 }),
  ])
  expect(s.counts).toEqual([{ turnId: 't1', agentId: null, files: 1, shell: 0, other: 0 }])
  expect(last('patches')).toEqual([{ turnId: 't1', file: '/repo/a.ts', source: '@@ -1,2 +1,2 @@\n keep\n-old\n+new' }])
})

test('an oversized patch keeps whole hunks up to the drawing limit and never exceeds the patch budget', async ($, on) => {
  const last = world(on)
  const big = (start: number) => ({ oldStart: start, oldLines: 0, newStart: start, newLines: 1, lines: ['+' + 'x'.repeat(40_000)] })
  const MANY = { ...EDIT, structuredPatch: [big(1), big(2), big(3)] }
  const HUGE = { type: 'create', filePath: '/repo/huge.txt', content: `${'z'.repeat(99)}\n`.repeat(30_000), structuredPatch: [] }
  on('tool.call', { tool: 'Edit' }, () => ({ result: MANY, text: 'ok' }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: HUGE, text: 'ok' }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  const kept = last('patches') as { source: string }[]
  expect(kept).toHaveLength(1)
  expect(kept[0]?.source.split('\n').filter(l => l.startsWith('@@'))).toEqual(['@@ -1,0 +1,1 @@', '@@ -2,0 +2,1 @@'])
  await $.tool.call({ tool: 'Write', tool_use_id: 'tu2', file_path: '/repo/huge.txt', content: '…' } as never)
  const s = (await savedRecord($, disk)) as Rec
  expect(s.events.at(-1)).toMatchObject({ kind: 'edit', tool: 'Write', file: '/repo/huge.txt', added: 30_000, removed: 0 })
  const all = (last('patches') ?? []) as { source: string }[]
  expect(all.every(p => p.source.length <= 90_000)).toBe(true)
  expect(all.reduce((n, p) => n + p.source.length, 0)).toBeLessThanOrEqual(2 * 1024 * 1024)
})

test('a failing activity write never blocks or repeats the call', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  on('state.set', (_$, e, next) => (e.key === 'activity' ? { deny: 'state full' } as never : next(e)))
  const logs: string[] = []
  on('ui.log', (_$, e) => { logs.push(e.text); return { value: undefined } })
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => { ran++; return OK })
  const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(r.deny).toBeUndefined()
  expect(ran).toBe(2)
  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('binnacle: activity recording failed (')
})
