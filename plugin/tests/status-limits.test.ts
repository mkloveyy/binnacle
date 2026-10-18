import { describe, expect, test } from 'claude-code/testing'
import type { BinnacleSnapshot } from '../types'
import { DEFAULT_SETTINGS } from '../hooks/core/settings.ts'
import { buildGroups, limitColor } from '../hooks/modules/status/segments.ts'

const NOW = 1_800_000_000_000
const snap = (five: number, seven: number, ctx = 41): BinnacleSnapshot => ({
  model: 'claude-opus-5-5', effort: 'high', contextTokens: 412_000, contextWindow: 1_000_000, contextPercent: ctx,
  startedAt: NOW - 60_000, costUsd: 1, turnCostUsd: null, cwd: '/r', home: '/h',
  limits: [{ kind: 'five_hour', percent: five, resetsAt: null }, { kind: 'seven_day', percent: seven, resetsAt: null }],
})

describe('limit colour bands (user, 2026-10-12)', () => {
  test('under 50 success, 50–79 suggestion, 80–89 warning, 90 and up error', () => {
    expect([0, 49, 50, 79, 80, 89, 90, 100].map(limitColor)).toEqual(['success', 'success', 'suggestion', 'suggestion', 'warning', 'warning', 'error', 'error'])
  })
  test('every form of the limits group takes the bands; the minimal one takes the worse of the two', () => {
    const g = buildGroups(snap(45, 85), DEFAULT_SETTINGS, NOW).find(x => x.id === 'limits')!
    const colors = g.forms.map(f => f.filter(s => !s.dim).map(s => s.color))
    expect(colors).toEqual([['success', 'subtle', 'success', 'warning', 'warning'], ['success', 'warning'], ['warning']])
    expect(g.forms[2]?.[0]?.text).toBe('45%/85%')
  })
  test('the context group keeps its 80/90 rule', () => {
    const ctx = (p: number) => buildGroups(snap(10, 10, p), DEFAULT_SETTINGS, NOW).find(x => x.id === 'context')!.forms.at(-1)?.[0]?.color
    expect([ctx(41), ctx(85), ctx(95)]).toEqual(['blue', 'yellow', 'red'])
  })
})
