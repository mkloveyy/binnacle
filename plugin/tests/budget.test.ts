import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { agentRows, MAX_DETAIL_LINES } from '../hooks/modules/activity/tree.ts'
import { timeline } from '../hooks/modules/activity/timeline.ts'
import { textWidth } from '../hooks/core/width.ts'
import { BUDGET, budget, charsOf, LINE_KEY, type Span } from '../hooks/modules/ui/cols.ts'
import { files, home } from './files.ts'

describe('one drawing budget per render', () => {
  test('counts characters as the host does: text length (a CJK character is one), plus a keyed line allowance', () => {
    expect(charsOf([{ text: '代码' }, { text: 'ab' }])).toBe(4)
    expect(charsOf('abc')).toBe(3)
    expect(LINE_KEY).toBe(12)
    expect(budget().left()).toBe(BUDGET)
  })
  test('spend and take: lines are kept in order while they fit, a reserve held back, the rest counted', () => {
    const b = budget(100)
    b.spend(10)
    expect(b.left()).toBe(90)
    const lines: (Span[] | string)[] = [[{ text: 'x'.repeat(20) }], 'y'.repeat(20), [{ text: 'z'.repeat(20) }]]
    // Each costs 20 + LINE_KEY = 32: two fit 90.
    expect(b.take(lines)).toEqual({ kept: lines.slice(0, 2), dropped: 1 })
    expect(b.left()).toBe(26)
    const r = budget(100)
    expect(r.take(lines, 40)).toEqual({ kept: lines.slice(0, 1), dropped: 2 })
    expect(r.left()).toBe(68)
    // A line that does not fit ends the list: later, shorter ones are not drawn out of order.
    expect(budget(50).take(['x'.repeat(60), 'y'], 0)).toEqual({ kept: [], dropped: 2 })
    // Spending past the end leaves nothing, never a negative room.
    const o = budget(10)
    o.spend(30)
    expect(o.left()).toBe(0)
  })
})

describe("an agent's details", () => {
  test(`list at most ${20} denials and ${20} errors, the rest counted`, () => {
    let s = append(newSession('s', 0, '/r'), { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
    s = append(s, { at: 2, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'x', parentAgentId: null, background: true })
    for (let i = 0; i < 30; i++) {
      s = append(s, { at: 3 + i, turnId: 't1', agentId: 'a1', kind: 'perm', tool: 'Bash', summary: `rm ${i}`, decision: 'deny', decider: 'rule', outcome: null })
      s = append(s, { at: 3 + i, turnId: 't1', agentId: 'a1', kind: 'error', tool: 'Read', summary: 'x', message: `boom ${i}` })
    }
    s = append(s, { at: 50, turnId: 't1', agentId: 'a1', kind: 'agent-end', durationMs: 48, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
    expect(MAX_DETAIL_LINES).toBe(20)
    const d = agentRows(s, 0, 100)[0]?.detail ?? []
    const at = (head: string) => d.indexOf(head)
    expect(d.slice(at('denials:') + 1, at('errors:'))).toHaveLength(21)
    expect(d[at('errors:') - 1]).toBe('  … and 10 more')
    expect(d[at('denials:') + 1]).toMatch(/· rm 0$/)
    expect(d.at(-1)).toBe('  … and 10 more')
    // The row's own count is still the whole number.
    expect(agentRows(s, 0, 100)[0]?.text).toMatch(/✗ 30 denied · 30 errors$/)
  })
})

describe('timeline turn marks', () => {
  test('a mark is not drawn against the one before it (looks on both sides)', () => {
    const T = 1_800_000_000_000
    let s = newSession('s', T, '/r')
    s = append(s, { at: T, turnId: 't0', agentId: null, kind: 'turn-start', prompt: 'p' })
    s = append(s, { at: T + 1, turnId: 't0', agentId: 'a', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'x', parentAgentId: null, background: true })
    // A turn about every column: '#2' would start right after '#1'.
    for (let i = 1; i < 40; i++) s = append(s, { at: T + i * 1_000, turnId: `t${i}`, agentId: null, kind: 'turn-start', prompt: 'p' })
    s = append(s, { at: T + 60_000, turnId: 't39', agentId: 'a', kind: 'agent-end', durationMs: 60_000, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
    const marks = (timeline(s, T, T + 60_000, 80)?.marks ?? []).map(m => m.text).join('')
    expect(marks).toMatch(/#1 /)
    expect(marks).not.toMatch(/\d#/)
  })
})

// ── every tab at 300 columns with the largest data: nothing reaches the host's cut ──

const COLS = 300
const W = COLS - 2
const PANE = {
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns: COLS, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const PROC = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const P120 = (i: number) => `turn ${i} ` + 'please refactor the store writer and make it handle every case we talked about earlier today '.repeat(3).slice(0, 110)
const path = (f: number) => `src/modules/very/deep/package/name/component-${f}/implementation-of-the-feature-${f}.ts`

/** `files` files, the one at `big` with ~150k of hunks. */
function bigDiff(files: number, big: number): string {
  const out: string[] = []
  for (let f = 0; f < files; f++) {
    out.push(`diff --git a/${path(f)} b/${path(f)}`, `--- a/${path(f)}`, `+++ b/${path(f)}`)
    for (let h = 0; h < (f === big ? 60 : 1); h++) {
      const lines = Array.from({ length: 20 }, (_, i) => `+  const value${h}_${i} = computeSomethingRatherLong(argumentNumberOne, argumentNumberTwo, ${i})`)
      out.push(`@@ -${h * 100 + 1},0 +${h * 100 + 1},20 @@`, ...lines)
    }
  }
  return out.join('\n') + '\n'
}

const PACK: Plugin = {
  name: 'packy',
  register(on) {
    on('session.start', async ($, e, next) => {
      const r = await next(e)
      for (let i = 0; i < 300; i++) await $.binnacle.register({ id: `pack.rule${i}`, pack: 'packy', title: `rule number ${i} that refuses something`, action: 'ask' })
      await $.binnacle.tab({ id: 't', title: 'Packy', rows: Array.from({ length: 450 }, (_, i) => ({ text: `leaf ${i} ` + 'z'.repeat(490) })) })
      return r
    })
  },
}

test('every tab at 300 columns with the largest data stays under the host cut, its "more" lines and details drawn', { plugins: [PACK], timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: 10_000_000 })
  const events: unknown[] = []
  for (let i = 0; i < 410; i++) {
    events.push({ at: 10 + i * 10, turnId: `t${i}`, agentId: null, kind: 'turn-start', prompt: P120(i) })
    events.push({ at: 11 + i * 10, turnId: `t${i}`, agentId: `a${i}`, kind: 'agent-start', agentType: 'general-purpose', model: 'm', task: P120(i), parentAgentId: null, background: true })
    events.push({ at: 14 + i * 10, turnId: `t${i}`, agentId: `a${i}`, kind: 'agent-end', durationMs: 61_000, tokensIn: 1, tokensOut: 1, aborted: false, report: ['x'.repeat(160), 'y'.repeat(160)] })
    events.push({ at: 15 + i * 10, turnId: `t${i}`, agentId: null, kind: 'turn-end', durationMs: 62_000, costUsd: 1.23, aborted: false })
  }
  for (let i = 0; i < 300; i++) events.push({ at: 4_200, turnId: 't409', agentId: 'a409', kind: 'perm', tool: 'Bash', summary: P120(i), decision: 'deny', decider: 'rule', outcome: null })
  files(on).seed('s1', { version: 1, sessionId: 's1', startedAt: 0, endedAt: null, cwd: '/repo', firstPrompt: 'go', events, counts: [] })
  home(on)
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `live${n++}` }))
  const diff = bigDiff(400, 300)
  on('process.run', (_$, e) => ((e as unknown as { argv: string[] }).argv.includes('status') ? PROC('') : PROC(diff)))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 'tl' })
  for (let i = 0; i < 25; i++) {
    await $.agent.spawn({ tool_use_id: `tu${i}`, prompt: 'p', description: P120(i), subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false })
  }
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  const has = async (q: { type: 'Text' | 'Button'; text: string | RegExp }): Promise<void> => {
    expect({ q: String(q.text), found: (await ui.find(q)) !== undefined }).toEqual({ q: String(q.text), found: true })
  }
  const uncut = async (tab: string): Promise<void> => {
    expect({ tab, cut: (await ui.find({ text: /more characters, not drawn/ }))?.text.slice(-60) }).toEqual({ tab, cut: undefined })
  }

  for (const tab of ['tab-overview', 'tab-perm']) {
    await ui.press({ key: tab })
    await uncut(tab)
  }

  await ui.press({ key: 'tab-settings' })
  await uncut('settings')
  await has({ type: 'Text', text: /^… \d+ more rules$/ })

  await ui.press({ key: 'tab-activity' })
  await ui.press({ key: 'node-turn:t409' })
  await uncut('activity')
  await has({ type: 'Text', text: /^… \d+ more rows \(collapse a turn to see them\)$/ })
  await has({ type: 'Text', text: 'session s1 · claude --resume s1' })
  await has({ type: 'Text', text: `prompt: ${P120(409)}` })

  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agent-agent:a409' })
  await uncut('agents')
  await has({ type: 'Text', text: /^Now\s+25 running · 0 waiting$/ })
  // 410 stored agents and 25 live ones: the history lists what fits and counts the rest.
  const hist = (await ui.findAll({ type: 'Button', text: /^ general-purpose/ })).length
  expect(hist).toBeGreaterThan(50)
  await has({ type: 'Text', text: `… and ${435 - hist} more` })
  await has({ type: 'Text', text: `  ${'y'.repeat(160)}` })
  await has({ type: 'Text', text: '  … and 280 more' })

  // File 300 is picked where it is drawn (120 columns); at 300 columns the list is cut before it, and it is still drawn.
  await ui.redraw({ ...PANE.props, bodyColumns: 120 })
  await ui.press({ key: 'tab-diff' })
  await ui.press({ key: 'file-300' })
  await ui.redraw(PANE.props)
  await uncut('diff')
  await has({ type: 'Button', text: /^▸ M\s+.*implementation-of-the-feature-300\.ts/ })
  await has({ type: 'Text', text: /^… \d+ more files$/ })
  const code = String((await ui.find({ type: 'Code' }))?.props.source ?? '')
  // Cut at a hunk boundary: the source ends with a whole hunk's last line, and the rest are counted.
  expect(code.length).toBeGreaterThan(1_000)
  expect(code.endsWith('argumentNumberTwo, 19)')).toBe(true)
  await has({ type: 'Text', text: /^… \d+ more hunks$/ })

  await ui.press({ key: 'tab-ext:packy/t' })
  await uncut('plugin tab')
  await has({ type: 'Text', text: /^… \d+ more rows$/ })
  const leaves = await ui.findAll({ type: 'Text', text: /^ {2}leaf \d+/ })
  expect(leaves.length).toBeGreaterThan(100)
  for (const el of leaves) expect(textWidth(el.text)).toBeLessThanOrEqual(W)
  await ui.unmount()
})
