import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const OK = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
const ANSWER = (value: string) => (_$: unknown, e: { questions: { question: string }[] }) => ({ result: { questions: e.questions, answers: { [e.questions[0].question]: value } }, text: '' })
const PROC = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const IN_REPO = (on: (event: string, handler: (...a: never[]) => unknown) => unknown) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/home/u' }))
}

test('a cluster-wide kubectl call is denied and logged', async ($, on) => {
  mock.clock(on)
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
  const r = await $.tool.call({ tool: 'Bash', command: 'kubectl get pods -A' })
  expect(r.deny).toContain('binnacle:')
  expect(r.deny).toContain('Do not work around this')
  expect(ran).toHaveLength(0)
  // Logged: the Permissions page lists it under this session's guard decisions.
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  expect(await ui.find({ type: 'Text', text: /deny +binnacle +k8s\.all-namespaces +kubectl get pods -A/ })).toBeDefined()
  await ui.unmount()
})

test('an ask that the user allows runs the call after a read-only preview', async ($, on) => {
  mock.clock(on)
  const ran: string[] = []
  const procs: string[][] = []
  IN_REPO(on)
  on('process.run', (_$, e) => { procs.push((e as unknown as { argv: string[] }).argv ?? []); return PROC('/tmp/build/a.js\n') })
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('Allow once'))
  on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/build' })
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual(['rm -rf /tmp/build'])
  expect(procs.length).toBeGreaterThan(0)
})

test('an answer typed under Other is a refusal that reaches the model', async ($, on) => {
  mock.clock(on)
  on('process.run', () => PROC('a1b2c3d fix: retry\n'))
  on('tool.call', { tool: 'AskUserQuestion' }, ANSWER('push to a new branch instead'))
  on('tool.call', { tool: 'Bash' }, () => OK)
  const r = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(r.deny).toContain('push to a new branch instead')
})

test('no one to ask (-p) means the call is refused', async ($, on) => {
  mock.clock(on)
  on('process.run', () => PROC(' M src/a.ts\n'))
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'no one to ask' }))
  on('tool.call', { tool: 'Bash' }, () => OK)
  const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(r.deny).toContain('The user declined')
})

test('an ask whose preview shows nothing lost runs without asking and is logged as auto-allow', async ($, on) => {
  mock.clock(on)
  IN_REPO(on)
  const ran: string[] = []
  const asked: unknown[] = []
  on('process.run', () => PROC(''))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Allow once')(_$, e as never) })
  on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
  const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual(['git reset --hard'])
  expect(asked).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  expect(await ui.find({ type: 'Text', text: /auto-allow +binnacle +git\.discard-chang… +git reset --hard/ })).toBeDefined()
  await ui.unmount()
})

test('a force push to a protected branch asks even when the preview is empty', async ($, on) => {
  mock.clock(on)
  IN_REPO(on)
  const asked: unknown[] = []
  on('process.run', () => PROC(''))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Allow once')(_$, e as never) })
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(asked).toHaveLength(1)
})

test('an ask without a preview (cd, xargs) is never auto-allowed', async ($, on) => {
  mock.clock(on)
  IN_REPO(on)
  const asked: unknown[] = []
  on('process.run', () => PROC(''))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Deny')(_$, e as never) })
  on('tool.call', { tool: 'Bash' }, () => OK)
  const r = await $.tool.call({ tool: 'Bash', command: 'cd ~ && rm -rf Documents' })
  expect(asked).toHaveLength(1)
  expect(r.deny).toContain('The user declined')
})

test('a cannot-preview result still asks', async ($, on) => {
  mock.clock(on)
  IN_REPO(on)
  const asked: unknown[] = []
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Allow once')(_$, e as never) })
  on('tool.call', { tool: 'Bash' }, () => OK)
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(asked).toHaveLength(1)
})

test('a delete inside the project (cwd from the session) is not asked about', async ($, on) => {
  mock.clock(on)
  IN_REPO(on)
  const asked: unknown[] = []
  const ran: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Allow once')(_$, e as never) })
  on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
  expect(ran).toEqual(['rm -rf dist'])
  expect(asked).toHaveLength(0)
})

test('ordinary calls pass untouched', async ($, on) => {
  mock.clock(on)
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['git status'])
})

test('permission checks are tallied', async ($, on) => {
  mock.clock(on)
  const writes: { key: string; value: unknown }[] = []
  on('state.set', ($, e, next) => { writes.push(e as never); return next(e) })
  on('tool.check', () => ({ decision: 'allow' }))
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 't1' })
  const perm = writes.filter(w => w.key === 'perm').at(-1)?.value as { allow: number; shell: number } | undefined
  expect(perm?.allow).toBe(1)
  expect(perm?.shell).toBe(1)
})

describe('final review: a multi-command line never auto-allows', () => {
  const probe = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], command: string) => {
    mock.clock(on)
    IN_REPO(on)
    const asked: unknown[] = []
    const ran: string[] = []
    on('process.run', () => PROC(''))
    on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => { asked.push(e); return ANSWER('Deny')(_$, e as never) })
    on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
    const r = await $.tool.call({ tool: 'Bash', command })
    return { asked, ran, r }
  }
  for (const command of [
    'rm -rf /tmp/binnacle-nonexist && rm -rf ~/important',
    'rm -rf /tmp/binnacle-nonexist; git reset --hard',
    'git restore README.md && git reset --hard',
    'find /tmp/binnacle-nonexist -name x -delete; find ~ -name x -delete',
  ]) {
    test(`asks: ${command}`, async ($, on) => {
      const { asked, ran, r } = await probe($, on, command)
      expect(asked).toHaveLength(1)
      expect(ran).toHaveLength(0)
      expect(r.deny).toContain('The user declined')
    })
  }
  test('kubectl delete is refused without asking, even beside a harmless one', async ($, on) => {
    const { asked, ran, r } = await probe($, on, 'kubectl delete pods -l app=none -n a; kubectl delete ns prod')
    expect(asked).toHaveLength(0)
    expect(ran).toHaveLength(0)
    expect(r.deny).toContain('kubectl delete')
  })
  test('a single command whose preview shows nothing lost still auto-allows', async ($, on) => {
    const { asked, ran } = await probe($, on, 'rm -rf /tmp/binnacle-nonexist')
    expect(asked).toHaveLength(0)
    expect(ran).toEqual(['rm -rf /tmp/binnacle-nonexist'])
  })
})

test('a guard that throws before the call runs blocks it (fail closed)', async ($, on) => {
  on('clock.now', () => { throw new Error('boom') })
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return OK })
  const r = await $.tool.call({ tool: 'Bash', command: 'kubectl get pods -A' })
  expect(r.deny).toContain('binnacle: the guard failed while checking this call')
  expect(ran).toHaveLength(0)
})

describe('session.start keeps going when a host call fails', () => {
  const USAGE = { value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }
  test('a rejected command registration does not skip the status timer', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    let invalidated = 0
    on('command.register', () => { throw new Error('no commands here') })
    on('session.usage', () => USAGE as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.invalidate', () => { invalidated++; return { value: undefined } })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(15_000)
    expect(invalidated).toBeGreaterThan(0)
  })
  test('a rejected notice flag write does not fail the session start', async ($, on) => {
    mock.clock(on)
    on('store.get', () => ({ value: undefined }))
    const tried: string[] = []
    on('command.register', () => ({ value: { command: 'binnacle' } }))
    on('store.set', (_$, e) => { tried.push(e.key); if (e.key === 'statusLineNoticeShown') throw new Error('read-only store'); return { value: undefined } })
    on('settings.read', () => ({ value: { statusLine: { type: 'command', command: 'x' } } }) as never)
    on('session.usage', () => USAGE as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    const r = await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(tried).toContain('statusLineNoticeShown')
    expect(r).toEqual({ cwd: '/repo' })
  })
})
