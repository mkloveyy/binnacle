import { describe, expect, test } from 'claude-code/testing'
import { stackBar, stackLegend } from '../hooks/modules/ui/stack.ts'
import { widthOf, type Span } from '../hooks/modules/ui/cols.ts'

const text = (l: Span[]): string => l.map(s => s.text).join('')

/** One bar split by share, and its legend with counts and shares: the Context block's look, for counts. */
describe('stacked bar and legend', () => {
  const parts = [{ name: 'allowed by rules', n: 312, color: 'success' }, { name: 'asked', n: 4591, color: 'permission' }, { name: 'denied', n: 1, color: 'error' }]
  test('the bar fills the width exactly, each part by its share, a part that happened keeps one cell', () => {
    const bar = stackBar(parts, 50)
    expect(widthOf(bar)).toBe(50)
    expect(bar.map(s => [s.color, s.text.length])).toEqual([['success', 3], ['permission', 46], ['error', 1]])
    expect(stackBar([{ name: 'x', n: 0, color: 'red' }], 10)).toEqual([])
  })
  test('the legend: glyph, name, count and share aligned, in two columns when they fit; <1% for a small share', () => {
    expect(stackLegend(parts, 100).map(text)).toEqual([
      '█ allowed by rules   312    6%   █ denied  1   <1%',
      '█ asked             4591   94%',
    ])
    expect(stackLegend(parts, 40).map(text)).toEqual([
      '█ allowed by rules   312    6%',
      '█ asked             4591   94%',
      '█ denied               1   <1%',
    ])
    expect(stackLegend(parts, 100)[0]?.[0]).toEqual({ text: '█', color: 'success' })
  })
  test('parts that did not happen are left out', () => {
    expect(stackLegend([{ name: 'a', n: 2, color: 'red' }, { name: 'b', n: 0, color: 'blue' }], 80).map(text)).toEqual(['█ a  2  100%'])
  })
})
