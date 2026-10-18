import { describe, expect, mock, test } from 'claude-code/testing'
import type { BinnacleDiffFile } from '../types'
import { append, bump, newSession } from '../hooks/modules/activity/events.ts'
import { buildTree, flatten, sessionLabel, toggledOpen, treeRow } from '../hooks/modules/activity/tree.ts'
import { textWidth } from '../hooks/core/width.ts'
import { layoutRows, type Span } from '../hooks/modules/ui/cols.ts'
import { diffFileRow } from '../hooks/modules/ui/pages.ts'

const text = (l: Span[]): string => l.map(s => s.text).join('')

describe('Activity rows (§4.7)', () => {
  let s = newSession('s1', 0, '/repo')
  s = append(s, { at: 1_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'first' })
  s = append(s, { at: 2_000, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'find store writes', parentAgentId: null, background: false })
  s = append(s, { at: 3_500, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: 'rm -rf /tmp/x', decision: 'ask', decider: 'user', outcome: 'denied-by-user' })
  s = append(s, { at: 3_600, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: 'deploy-tool confirm --id 4', decision: 'deny', decider: 'hook', outcome: null, source: 'sextant-guard', ruleId: 'release-gate' })
  s = append(s, { at: 3_700, turnId: 't1', agentId: null, kind: 'edit', tool: 'Edit', file: '/repo/hooks/register.tsx', added: 12, removed: 3 })
  s = append(s, { at: 64_000, turnId: 't1', agentId: 'a1', kind: 'agent-end', durationMs: 62_000, tokensIn: 12_000, tokensOut: 3_000, aborted: false, report: ['ok'] })
  s = append(s, { at: 135_000, turnId: 't1', agentId: null, kind: 'turn-end', durationMs: 134_000, costUsd: 0.41, aborted: false })
  s = append(s, { at: 140_000, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'check the deploy', auto: true, via: 'loop' })
  s = bump(s, 't1', null, 'Bash')
  const { rows } = flatten(buildTree(s, 5_000, 0), toggledOpen(['turn:t1'], []))
  const lines = layoutRows(rows.map(treeRow), 100).map(text)
  test('turns flush left with their number, who and state; the numbers right-aligned', () => {
    expect(lines[0]).toMatch(/^ {2}#2  ⟳ \/loop · check the deploy\s+running$/)
    expect(lines[1]).toMatch(/^▾ #1  you   first\s+2m14s\s+\$0\.41$/)
  })
  test('everything under a turn is indented five columns, in its own colours', () => {
    expect(lines[2]).toMatch(/^ {5}✓ Explore   find store writes\s+1m02s\s+12k\/3k$/)
    expect(lines[3]).toBe('     ✗ asked → you denied   rm -rf /tmp/x')
    expect(lines[4]).toMatch(/^ {5}⚑ sextant-guard · release-gate   deploy-tool confirm --id 4$/)
    expect(lines[5]).toMatch(/^ {5}✎ hooks\/register\.tsx\s+\+12\s+−3$/)
    expect(lines[6]).toBe('     files 0 · shell 1 · other 0')
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(100)
  })
})

describe('one-line texts', () => {
  test('outside text is made one visible line before it is cut', () => {
    const raw = `a\tb\nc${'x'.repeat(30)}\x1b`
    let s = newSession('s1', 0, '/repo')
    s = append(s, { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: raw })
    s = append(s, { at: 2, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: raw, parentAgentId: null, background: false })
    s = append(s, { at: 3, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: raw, decision: 'ask', decider: 'user', outcome: 'denied-by-user' })
    s = append(s, { at: 4, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: raw, decision: 'deny', decider: 'hook', outcome: null, source: 'sextant-guard', ruleId: 'release-gate' })
    s = append(s, { at: 5, turnId: 't1', agentId: null, kind: 'error', tool: 'Bash', summary: raw, message: raw })
    const { rows } = flatten(buildTree(s, 0, 0), () => true)
    expect(rows.length).toBe(5)
    for (const r of rows) expect(r.text).not.toMatch(/[\x00-\x1f]/)
    expect(rows[0]?.text).toContain('"a b c')
    const label = sessionLabel({ sessionId: 'old', startedAt: 0, endedAt: 1, cwd: '/w/\x1bp', firstPrompt: raw, bytes: 1 }, '/home')
    expect(label).not.toMatch(/[\x00-\x1f]/)
    expect(label).toContain('"a b c')
  })
})

describe('Diff rows (§4.9)', () => {
  const f = (path: string, status: BinnacleDiffFile['status'], added: number, removed: number): BinnacleDiffFile => ({ path, status, added, removed, hunks: [], binary: false })
  test('mark, status letter, the path cut in the middle, +N −N right-aligned; untracked says so', () => {
    const lines = layoutRows([diffFileRow(f('hooks/register.tsx', 'M', 120, 34), true), diffFileRow(f('hooks/modules/search/index.ts', 'A', 210, 0), false), diffFileRow(f('scratch.txt', '?', 0, 0), false)], 70).map(text)
    expect(lines[0]).toMatch(/^▸ M {2}hooks\/register\.tsx\s+\+120 {2}−34$/)
    expect(lines[1]).toMatch(/^ {2}A {2}hooks\/modules\/search\/index\.ts\s+\+210$/)
    expect(lines[2]).toMatch(/^ {2}\? {2}scratch\.txt\s+untracked$/)
    expect(text(layoutRows([diffFileRow(f('a/very/long/path/to/some/deeply/nested/file/name.ts', 'M', 1, 1), false)], 40)[0] as Span[])).toMatch(/…\/name\.ts\s+\+1 {2}−1$/)
  })
})

const PANE = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

for (const cols of [50, 80, 120]) {
  test(`Activity and Diff fit ${cols} columns`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    await $.turn.start({ text: `a long prompt ${'that keeps going '.repeat(10)}`, turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(cols) })
    const w = Math.max(20, cols - 2)
    for (const t of ['activity', 'diff']) {
      await ui.press({ key: `tab-${t}` })
      for (const el of [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))]) {
        if (el.key?.startsWith('tab-')) continue
        expect(textWidth(el.text)).toBeLessThanOrEqual(w)
      }
    }
    await ui.unmount()
  })
}

const ID = '9c325cfb-1d2e-4f5a-8b6c-7d8e9f0a1b2c'

test('the session line shows the first 8 characters of the id and the whole resume command, within 80 columns', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: ID }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(80) })
  await ui.press({ key: 'tab-activity' })
  const line = await ui.find({ type: 'Text', text: /claude --resume/ })
  expect(ID.length).toBe(36)
  expect(line?.text).toBe(`session 9c325cfb · claude --resume ${ID}`)
  expect(textWidth(line?.text ?? '')).toBeLessThanOrEqual(78)
  await ui.unmount()
})

const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'p', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}

for (const n of [1, 2]) {
  test(`the count beside the session reads ${n === 1 ? '1 turn · 1 agent' : '2 turns · 2 agents'}`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    let k = 0
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++k}` }))
    for (let i = 1; i <= n; i++) {
      await $.turn.start({ text: `turn ${i}`, turnId: `t${i}` })
      await $.agent.spawn({ ...SPAWN, tool_use_id: `tu-${i}` })
    }
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(100) })
    await ui.press({ key: 'tab-activity' })
    expect(await ui.find({ type: 'Text', text: n === 1 ? '1 turn · 1 agent' : '2 turns · 2 agents' })).toBeDefined()
    await ui.unmount()
  })
}

const CJK_CWD = '/用户/工作区/一个名字很长的中文项目目录'
const CJK_FILE = `${CJK_CWD}/源代码/模块/界面/一个名字也很长的组件文件.ts`

for (const cols of [50, 80, 120]) {
  test(`Activity and Diff with CJK prompt, cwd and paths fit ${cols} columns`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    on('session.cwd', () => ({ value: CJK_CWD }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('tool.call', { tool: 'Edit' }, () => ({
      result: {
        filePath: CJK_FILE, oldString: '旧', newString: '新', originalFile: '旧\n', userModified: false, replaceAll: false,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-旧', '+新'] }],
      },
      text: 'ok',
    }) as never)
    on('process.run', (_$, e) => {
      const argv = (e as unknown as { argv: string[] }).argv
      const stdout = argv.includes('status') ? `?? 文档/一份很长很长的中文说明文档.md\n?? 草稿/另一个名字很长的未跟踪文件.txt\n` : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    await $.turn.start({ text: `请帮我把这个很长的中文提示${'一直写下去'.repeat(10)}`, turnId: 't1' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'tu1', file_path: CJK_FILE, old_string: '旧', new_string: '新' } as never)
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(cols) })
    const w = Math.max(20, cols - 2)
    const check = async (): Promise<void> => {
      for (const el of [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))]) {
        if (el.key?.startsWith('tab-')) continue
        expect(textWidth(el.text)).toBeLessThanOrEqual(w)
      }
    }
    await ui.press({ key: 'tab-activity' })
    expect(await ui.find({ type: 'Button', text: /请帮我/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /✎ / })).toBeDefined()
    await check()
    await ui.press({ key: 'tab-diff' })
    await ui.press({ key: 'diff-refresh' })
    expect(await ui.find({ type: 'Button', text: /untracked/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button', text: /\?\s+.*untracked/ })).length).toBe(2)
    await check()
    await ui.unmount()
  })
}
