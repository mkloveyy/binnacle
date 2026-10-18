import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { decisionLines, grepDecisions, parseDecisions } from '../hooks/modules/perm/decisions.ts'
import type { Span } from '../hooks/modules/ui/cols.ts'

const text = (l: Span[]): string => l.map(s => s.text).join('')
const D = (o: Record<string, string>) => `"permissionDecision":${JSON.stringify(o)}`

/**
 * Who decided each permission check that was not a plain allow, as Claude Code writes it on the tool result in the
 * transcript (`permissionDecision`, P2-6): the person in the dialog, the auto-mode classifier, the mode, a rule, a hook.
 */
describe('permission decisions from the transcript', () => {
  test('grep reads only the decision objects, read-only', () => {
    expect(grepDecisions('/t/s.jsonl')).toEqual(['grep', '-oE', '"permissionDecision":\\{[^}]*\\}', '/t/s.jsonl'])
  })
  test('each decision lands in one bucket; a line that is not JSON is skipped', () => {
    const out = [
      D({ decision: 'accept', source: 'user_temporary' }),
      D({ decision: 'accept', source: 'user_permanent' }),
      D({ decision: 'reject', source: 'user_reject' }),
      D({ decision: 'accept', source: 'config', reasonType: 'classifier' }),
      D({ decision: 'accept', source: 'config', reasonType: 'classifier' }),
      D({ decision: 'reject', source: 'config', reasonType: 'classifier' }),
      D({ decision: 'accept', source: 'config', reasonType: 'mode' }),
      D({ decision: 'accept', source: 'config', reasonType: 'rule' }),
      D({ decision: 'accept', source: 'config', reasonType: 'subcommandResults' }),
      D({ decision: 'accept', source: 'config' }),
      D({ decision: 'reject', source: 'hook', reasonType: 'hook' }),
      D({ decision: 'reject', source: 'config', reasonType: 'safetyCheck' }),
      '"permissionDecision":{broken',
    ].join('\n')
    expect(parseDecisions(out)).toMatchObject({ youAllowed: 2, youDenied: 1, autoAllowed: 2, autoDenied: 1, byMode: 1, byRules: 3, hookDenied: 1, otherDenied: 1 })
  })
  test('one bar by share, then a legend of what happened with counts and shares', () => {
    const d = { youAllowed: 0, youDenied: 1, autoAllowed: 992, autoDenied: 6, byMode: 32, byRules: 14, hookDenied: 1, otherDenied: 0 }
    const rows = decisionLines(d, 100)
    expect(rows[0]?.map(s => s.text).join('').length).toBe(99)
    expect(rows.slice(1).map(text)).toEqual([
      '█ you denied      1   <1%   █ mode allowed   32    3%',
      '█ auto allowed  992   95%   █ rules allowed  14    1%',
      '█ auto denied     6    1%   █ hooks denied    1   <1%',
    ])
    expect(decisionLines({ ...d, youDenied: 0, autoAllowed: 0, autoDenied: 0, byMode: 0, byRules: 0, hookDenied: 0 }, 100)).toEqual([])
  })
})

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const PROC = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

function world(on: On, { found = true, decisions = '' } = {}) {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 1, percent: 1 }, rateLimits: [] } }) as never)
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/repo' } }) as never)
  on('fs.exists', (_$, e) => ({ value: found && e.path === '/home/u/.claude/projects/-repo/s1.jsonl' }))
  on('fs.list', () => ({ value: [] }))
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    const argv = [...(e as unknown as { argv: string[] }).argv]
    runs.push(argv)
    if (argv[0] === 'grep' && String(argv[2]).includes('permissionDecision')) return decisions ? PROC(decisions + '\n') : PROC('', 1)
    return PROC('', 1)
  })
  return { runs, clock }
}

test('the Permissions tab says who decided, read from this session\'s transcript when the tab opens', async ($, on) => {
  const { runs, clock } = world(on, { decisions: [D({ decision: 'accept', source: 'user_temporary' }), D({ decision: 'accept', source: 'config', reasonType: 'classifier' })].join('\n') })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  await clock.settle()
  expect(runs).toContainEqual(['grep', '-oE', '"permissionDecision":\\{[^}]*\\}', '/home/u/.claude/projects/-repo/s1.jsonl'])
  expect(await ui.find({ type: 'Text', text: /^Who decided\s+this session · from the transcript$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /█ you allowed\s+1\s+50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /█ auto allowed\s+1\s+50%/ })).toBeDefined()
  await ui.unmount()
})

test('with no transcript found the section says so', async ($, on) => {
  const { clock } = world(on, { found: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-perm' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /^Who decided\s+transcript not found$/ })).toBeDefined()
  await ui.unmount()
})

describe('who settled the latest ask', () => {
  const line = (source: string, reasonType: string) => `"permissionDecision":{"decision":"accept","source":"${source}","reasonType":"${reasonType}"}`
  test('the classifier (auto mode) or the person, by the last such line; a rule or the mode does not say', () => {
    expect(parseDecisions([line('user_temporary', 'other'), line('config', 'classifier')].join('\n')).lastAsk).toBe('auto')
    expect(parseDecisions([line('config', 'classifier'), line('user_temporary', 'other')].join('\n')).lastAsk).toBe('you')
    expect(parseDecisions([line('config', 'classifier'), line('config', 'rule'), line('config', 'mode')].join('\n')).lastAsk).toBe('auto')
    expect(parseDecisions(line('config', 'rule')).lastAsk).toBeNull()
  })
})
