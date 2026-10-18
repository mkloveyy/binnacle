import { describe, expect, test } from 'claude-code/testing'
import { widthOf, type Span } from '../hooks/modules/ui/cols.ts'
import { EMPTY_TALLY, type LiveCall } from '../hooks/modules/flow/live.ts'
import type { AgentCard, FlowView } from '../hooks/modules/flow/model.ts'
import { flowLines, tallyParts } from '../hooks/modules/flow/layout.ts'

const text = (l: Span[]) => l.map(s => s.text).join('')
const call = (id: string, agentId: string | null, outcome: LiveCall['outcome'], startedAt = 0): LiveCall =>
  ({ id, agentId, tool: 'Grep', summary: `"store.set" ${id}`, startedAt, endedAt: outcome === 'running' ? null : startedAt + 1_000, outcome })
const agent = (id: string, running: boolean, extra: Partial<AgentCard> = {}): AgentCard => ({
  agentId: id, type: 'Explore', task: `find store writes ${id}`, at: 0, endedAt: running ? null : 130_000, aborted: false, running,
  steps: 23, calls: [call(`${id}-1`, id, running ? 'running' : 'ok')], children: [], flags: [], ...extra,
})
const view = (agents: AgentCard[], extra: Partial<FlowView> = {}): FlowView => ({
  turn: { n: 12, prompt: '把 compactions 的时间加上日期', at: 0, endedAt: null },
  mainCalls: [call('m1', null, 'running')], mainFlags: [], agents, tally: EMPTY_TALLY, waiting: [], anomalies: [], log: [], ...extra,
})
const HEAD = { model: 'Opus 5.5', effort: 'high' }
const NOW = 252_000

describe('flowLines', () => {
  for (const width of [50, 60, 79, 80, 100, 140]) {
    test(`every line fits ${width} columns, CJK included`, () => {
      const v = view([agent('a1', true, { task: '研发任务上线清单'.repeat(6), flags: ['same error ×2 · ENOENT'] }), agent('a2', true), agent('a3', false), agent('a4', true)], {
        tally: { ...EMPTY_TALLY, allowRules: 12, allowAuto: 6, askApproved: 1, askDeniedYou: 1, denyHook: 1 },
        waiting: [{ tool: 'Bash', summary: 'git push --force origin main', reason: 'git.force-push', at: 0 }],
        anomalies: [{ agentId: 'a1', text: 'same error ×2 · ENOENT' }, { agentId: null, text: 'context 82% · compaction near' }],
        log: [{ at: 1_000, who: 'main', mark: 'running', text: 'Bash claude plugin test .' }],
      })
      for (const l of flowLines(v, HEAD, width, NOW)) expect(widthOf(l)).toBeLessThanOrEqual(width)
    })
  }
  test('wide: the main card, a fork to the running cards, finished agents on one line, the join', () => {
    const lines = flowLines(view([agent('a1', true), agent('a2', true), agent('a3', false)]), HEAD, 100, NOW).map(text)
    expect(lines[0]).toMatch(/^Flow\s+turn #12 · ● 4m12s · 2 running · 1 done$/)
    expect(lines.some(l => /╭ main · Opus 5\.5 · high/.test(l))).toBe(true)
    expect(lines.some(l => /┌─+[┼┴]?─*┐/.test(l))).toBe(true)
    expect(lines.filter(l => /╭ Explore/.test(l))).toHaveLength(1)
    expect(lines.some(l => /^ ?✓ Explore · find store writes a3 · 2m10s · 23 steps/.test(l.trimStart()))).toBe(true)
    expect(lines.some(l => /back to main · 1 of 3 done/.test(l))).toBe(true)
  })
  test('seven running agents wrap three to a row', () => {
    const lines = flowLines(view(Array.from({ length: 7 }, (_, i) => agent(`a${i}`, true))), HEAD, 100, NOW).map(text)
    const tops = lines.filter(l => l.includes('╭ Explore'))
    expect(tops.map(l => (l.match(/╭ Explore/g) ?? []).length)).toEqual([3, 3, 1])
  })
  test('a short last row joins back with a corner where main sits', () => {
    const lines = flowLines(view(Array.from({ length: 4 }, (_, i) => agent(`a${i}`, true))), HEAD, 100, NOW).map(text)
    const join = lines.find(l => l.includes('└')) as string
    expect(join).toMatch(/^ *└─+┐$/)
  })
  test('no agents: no fork, no join', () => {
    const lines = flowLines(view([]), HEAD, 100, NOW).map(text)
    expect(lines.some(l => /back to main/.test(l))).toBe(false)
    expect(lines.some(l => /[┌└]/.test(l))).toBe(false)
  })
  test('decisions: the bar and the line; nothing at all when nothing was checked', () => {
    expect(tallyParts({ ...EMPTY_TALLY, allowRules: 12, allowAuto: 6, askApproved: 1, askDeniedYou: 1, denyHook: 1 }))
      .toEqual({ allowed: 18, asked: 2, denied: 1, line: 'rules 12 → allow   auto 6 → allow   asked 2 → 1 approved · 1 you denied   hook 1 → deny' })
    const quiet = flowLines(view([]), HEAD, 100, NOW).map(text)
    expect(quiet.some(l => l.startsWith('Decisions'))).toBe(false)
    const busy = flowLines(view([], { tally: { ...EMPTY_TALLY, allowRules: 1 }, waiting: [{ tool: 'Bash', summary: 'git push', at: 0 }] }), HEAD, 100, NOW).map(text)
    expect(busy.some(l => /^Decisions this turn\s+1 allowed · 0 asked · 0 denied$/.test(l))).toBe(true)
    expect(busy.some(l => /⏳ waiting for approval\s+Bash\s+git push/.test(l))).toBe(true)
  })
  test('narrow: a tree, one call per agent, three log lines', () => {
    const log = Array.from({ length: 5 }, (_, i) => ({ at: i * 1_000, who: 'main', mark: 'done' as const, text: `Bash ${i}` }))
    const lines = flowLines(view([agent('a1', true), agent('a2', false)], { log }), HEAD, 60, NOW).map(text)
    expect(lines.some(l => /^├─ ● Explore/.test(l))).toBe(true)
    expect(lines.some(l => /^└─ ✓ Explore/.test(l))).toBe(true)
    expect(lines.some(l => l.includes('╭'))).toBe(false)
    expect(lines.filter(l => /Bash \d$/.test(l))).toHaveLength(3)
  })
  test('one step is a step', () => {
    const lines = flowLines(view([agent('a1', true, { steps: 1 }), agent('a2', false, { steps: 1 })]), HEAD, 100, NOW).map(text)
    expect(lines.some(l => /│ 1 step +│/.test(l))).toBe(true)
    expect(lines.some(l => /· 1 step$/.test(l))).toBe(true)
  })
  test('who refused an ask, and an automatic deny, are told apart', () => {
    expect(tallyParts({ ...EMPTY_TALLY, askApproved: 1, askDeniedYou: 1, askDeniedAuto: 1, askDeniedHook: 1, denyAuto: 2 }).line)
      .toBe('asked 4 → 1 approved · 1 you denied · 1 auto denied · 1 hook denied   auto 2 → deny')
  })
  test('cards of one row are as tall as the tallest', () => {
    const tall = agent('a1', true, { calls: [call('x1', 'a1', 'ok'), call('x2', 'a1', 'ok'), call('x3', 'a1', 'running')] })
    const lines = flowLines(view([tall, agent('a2', true)]), HEAD, 100, NOW).map(text)
    expect(lines.filter(l => (l.match(/╰/g) ?? []).length === 2)).toHaveLength(1)
  })
  test('an effort not known yet leaves main titled by its model alone', () => {
    const lines = flowLines(view([]), { model: 'Opus 5.5', effort: '' }, 100, NOW).map(text)
    expect(lines.some(l => /╭ main · Opus 5\.5 ─/.test(l))).toBe(true)
    expect(lines.some(l => /Opus 5\.5 · +─|Opus 5\.5 · ─/.test(l))).toBe(false)
  })
  test('idle: no turn yet', () => {
    expect(text(flowLines({ ...view([]), turn: null, mainCalls: [] }, HEAD, 100, NOW)[0] as Span[])).toMatch(/^Flow\s+idle$/)
  })
})
