import { describe, expect, test } from 'claude-code/testing'
import type { BinnacleBreakdown } from '../types'
import { FREE_COLOR, LEGEND_GAP, MESSAGES_COLOR, PALETTE, legendRows, overviewCells } from '../hooks/modules/status/palette.ts'

// The breakdown from the screenshot that prompted the legend: a 1M window, 251k used.
const B: BinnacleBreakdown = {
  categories: [
    { name: 'system prompt', tokens: 4_000, kind: 'used' },
    { name: 'system tools', tokens: 14_000, kind: 'used' },
    { name: 'mcp server instructions', tokens: 641, kind: 'used' },
    { name: 'custom agents', tokens: 338, kind: 'used' },
    { name: 'memory files', tokens: 3_000, kind: 'used' },
    { name: 'skills', tokens: 10_000, kind: 'used' },
    { name: 'messages', tokens: 221_000, kind: 'used' },
    { name: 'autocompact buffer', tokens: 33_000, kind: 'buffer' },
    { name: 'free space', tokens: 716_000, kind: 'free' },
  ],
  total: 251_000, window: 1_000_000, compactAt: 967_000,
}
const sum = (cells: { n: number }[]) => cells.reduce((a, c) => a + c.n, 0)

describe('overviewCells', () => {
  test('fills exactly the width at any width, so the bar never wraps', () => {
    for (const width of [20, 37, 64, 87, 98, 150]) expect(sum(overviewCells(B, width))).toBe(width)
  })
  test('every used category gets at least one cell; free and buffer may get none', () => {
    const cells = overviewCells(B, 20)
    for (const c of cells.filter(c => c.kind === 'used')) expect(c.n).toBeGreaterThanOrEqual(1)
  })
  test('glyphs and colours match the legend: used █ in palette order, messages orange, buffer ░ and free ─ gray', () => {
    const cells = overviewCells(B, 98)
    expect(cells.map(c => c.glyph)).toEqual(['█', '█', '█', '█', '█', '█', '█', '░', '─'])
    expect(cells.map(c => c.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3], PALETTE[4], PALETTE[5], MESSAGES_COLOR, FREE_COLOR, FREE_COLOR])
  })
  test('share of the window, with <1% for small non-zero categories', () => {
    const cells = overviewCells(B, 98)
    expect(cells.map(c => c.share)).toEqual(['<1%', '1%', '<1%', '<1%', '<1%', '1%', '22%', '3%', '72%'])
  })
  test('an empty breakdown draws nothing', () => {
    expect(overviewCells({ categories: [], total: 0, window: 1_000_000, compactAt: null }, 98)).toEqual([])
  })
})

describe('legendRows', () => {
  const text = (row: { glyph: string; text: string }[]) => row.map(e => `${e.glyph} ${e.text}`).join(LEGEND_GAP)
  test('two aligned columns when they fit, filled column by column', () => {
    const rows = legendRows(overviewCells(B, 98), 98)
    expect(rows).toHaveLength(5)
    expect(text(rows[0] ?? [])).toBe('█ system prompt             4k  <1%   █ skills                   10k   1%')
    expect(text(rows[3] ?? [])).toBe('█ custom agents            338  <1%   ─ free space              716k  72%')
    expect(text(rows[4] ?? [])).toBe('█ memory files              3k  <1%')
  })
  test('one column when two do not fit', () => {
    const rows = legendRows(overviewCells(B, 50), 50)
    expect(rows).toHaveLength(9)
    expect(rows.every(r => r.length === 1)).toBe(true)
    expect(text(rows[6] ?? [])).toBe('█ messages                221k  22%')
  })
})
