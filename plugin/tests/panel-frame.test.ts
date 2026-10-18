import { describe, expect, mock, test } from 'claude-code/testing'
import type { BinnacleSnapshot } from '../types'
import { titleLine } from '../hooks/modules/ui/header.ts'
import { widthOf, type Span } from '../hooks/modules/ui/cols.ts'

const S: BinnacleSnapshot = {
  model: 'claude-opus-5-5', effort: 'high', contextTokens: 412_000, contextWindow: 1_000_000, contextPercent: 41.2,
  startedAt: 0, costUsd: 12.4, turnCostUsd: 0.41, limits: [], cwd: '/r', home: '/h',
}
const text = (l: Span[]): string => l.map(s => s.text).join('')

describe('titleLine', () => {
  test('binnacle, then model · effort · ctx · cost, the sprint right-aligned', () => {
    const l = titleLine(S, 'voyager/研发任务上线清单', 80)
    expect(text(l)).toMatch(/^binnacle  Opus 5\.5 · high · ctx 41% · \$12\.40 \(\+0\.41\)\s+◆ voyager\/研发任务上线清单$/)
    expect(widthOf(l)).toBe(80)
    expect(l[0]).toEqual({ text: 'binnacle', color: 'claude', bold: true })
  })
  test('cost, then ctx, then effort go first; below 60 columns only binnacle and the sprint', () => {
    expect(text(titleLine(S, 'voyager/研发任务上线清单', 62))).toMatch(/^binnacle  Opus 5\.5 · high\s+◆ voyager\/研发任务上线清单$/)
    expect(text(titleLine(S, null, 50))).toBe('binnacle')
    expect(text(titleLine(S, 'p/s', 50))).toMatch(/^binnacle\s+◆ p\/s$/)
    expect(text(titleLine(null, null, 80))).toBe('binnacle')
    expect(text(titleLine(S, null, 80))).toBe('binnacle  Opus 5.5 · high · ctx 41% · $12.40 (+0.41)')
    // Before the first request reports the effort, it is left out rather than drawn as a dash.
    expect(text(titleLine({ ...S, effort: null }, null, 80))).toBe('binnacle  Opus 5.5 · ctx 41% · $12.40 (+0.41)')
  })
  test('control characters in the model or the sprint are drawn as stand-ins', () => {
    const l = text(titleLine({ ...S, model: 'x\x1b[2Jy' }, 'p/\x07s\tt', 80))
    expect(l).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f]/)
    expect(l).toContain('x^[[2Jy')
    expect(l).toMatch(/◆ p\/\^Gs t$/)
  })
})

const PANE = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

for (const cols of [50, 80, 120]) {
  test(`the title line, the tab bar and one rule at ${cols} columns`, async ($, on) => {
    mock.store(on)
    mock.clock(on)
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(cols) })
    const w = Math.max(20, cols - 2)
    expect((await ui.find({ key: 'title' }))?.text).toMatch(/^binnacle/)
    expect((await ui.find({ key: 'rule' }))?.text).toBe('─'.repeat(w))
    expect((await ui.find({ key: 'tab-perm' }))?.text).toBe('Permissions')
    for (const t of ['overview', 'perm', 'settings', 'activity', 'agents', 'diff']) expect(await ui.find({ key: `tab-${t}` })).toBeDefined()
    await ui.unmount()
  })
}
