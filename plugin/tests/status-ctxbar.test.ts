import { describe, expect, test } from 'claude-code/testing'
import type { BinnacleBreakdown, BinnacleSnapshot } from '../types'
import { bar } from '../hooks/core/format.ts'
import { DEFAULT_SETTINGS } from '../hooks/core/settings.ts'
import { buildGroups } from '../hooks/modules/status/segments.ts'
import { fit, spansWidth } from '../hooks/modules/status/layout.ts'
import { FREE_COLOR, MESSAGES_COLOR, PALETTE, categoryColors, ctxBar, topCategory } from '../hooks/modules/status/palette.ts'

const NOW = 1_800_000_000_000
const SNAP: BinnacleSnapshot = {
  model: 'claude-opus-5-5', effort: 'high',
  contextTokens: 412_000, contextWindow: 1_000_000, contextPercent: 41,
  startedAt: NOW - 60_000, costUsd: 1, turnCostUsd: null, limits: [],
  cwd: '/Users/me/workspace/binnacle', home: '/Users/me',
}
const B: BinnacleBreakdown = {
  categories: [
    { name: 'messages', tokens: 300_000, kind: 'used' },
    { name: 'system tools', tokens: 100_000, kind: 'used' },
    { name: 'free space', tokens: 600_000, kind: 'free' },
  ],
  total: 400_000, window: 1_000_000, compactAt: null,
}
const text = (row: { text: string }[]) => row.map(s => s.text).join('')

describe('palette', () => {
  test('messages orange, free and buffer gray, the rest from the palette in order', () => {
    expect(categoryColors([...B.categories, { name: 'memory', tokens: 1, kind: 'used' }, { name: 'buffer', tokens: 1, kind: 'buffer' }]))
      .toEqual([MESSAGES_COLOR, PALETTE[0], FREE_COLOR, PALETTE[1], FREE_COLOR])
  })
  test('filled cells are split among used categories by largest remainder; empty cells keep the tone colour', () => {
    expect(ctxBar(41, B, 7, 'blue')).toEqual([
      { text: '██', color: MESSAGES_COLOR },
      { text: '█', color: PALETTE[0] },
      { text: '░░░░', color: 'blue' },
    ])
    expect(ctxBar(41, { ...B, categories: [B.categories[2]!] }, 7, 'blue')).toBeNull()
  })
  test('at edge percents and widths the bar has exactly its width and as many filled cells as v0.1', () => {
    const filled = (t: string) => [...t].filter(c => c === '█').length
    for (const p of [-5, 0, 1, 99, 100, 101, 250]) {
      for (const w of [1, 3, 7]) {
        const t = text(ctxBar(p, B, w, 'blue')!)
        expect([...t].length).toBe(w)
        expect(filled(t)).toBe(filled(bar(p, w)))
      }
    }
  })
  test('top category share of used tokens', () => {
    expect(topCategory(B)).toBe('msgs 75%')
    expect(topCategory({ ...B, categories: [{ name: 'system tools', tokens: 5, kind: 'used' }] })).toBe('system 100%')
    expect(topCategory({ ...B, categories: [] })).toBeNull()
  })
})

describe('ctx group', () => {
  test('with a breakdown: a coloured bar, and the top category in the widest form only', () => {
    const ctx = buildGroups(SNAP, DEFAULT_SETTINGS, NOW, B).find(g => g.id === 'context')!
    expect(ctx.forms.map(text)).toEqual(['ctx ███░░░░ 412k/1M 41% · msgs 75%', 'ctx ███░░░░ 412k/1M 41%', 'ctx 412k 41%', 'ctx 41%'])
    expect(ctx.forms[1]?.map(s => s.color)).toEqual(['blue', MESSAGES_COLOR, PALETTE[0], 'subtle', 'blue'])
  })
  test('without a breakdown: exactly v0.1', () => {
    const ctx = buildGroups(SNAP, DEFAULT_SETTINGS, NOW).find(g => g.id === 'context')!
    expect(ctx.forms.map(text)).toEqual(['ctx ███░░░░ 412k/1M 41%', 'ctx 412k 41%', 'ctx 41%'])
    expect(ctx.forms[0]).toEqual([{ text: 'ctx ███', color: 'blue' }, { text: '░░░░', color: 'subtle' }, { text: ' 412k/1M 41%', color: 'blue' }])
  })
  test('every row still fits its width', () => {
    for (const width of [40, 60, 100, 200]) {
      for (const r of fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW, B), width)) expect(spansWidth(r)).toBeLessThan(width + 1)
    }
    expect(text(fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW, B), 200)[0]!)).toContain('· msgs 75%')
  })
})
