import { describe, expect, test } from 'claude-code/testing'
import { toBreakdown, toLimits, toSnapshot } from '../hooks/modules/status/snapshot.ts'

describe('toLimits', () => {
  test('maps kinds and parses reset times', () => {
    expect(toLimits([
      { kind: 'five_hour', percentUsed: 45.2, resetsAt: '2027-01-01T00:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 13 },
      { kind: 'spend_limit', percentUsed: 5, resetsAt: 'not a date' },
    ])).toEqual([
      { kind: 'five_hour', percent: 45.2, resetsAt: Date.parse('2027-01-01T00:00:00.000Z') },
      { kind: 'seven_day', percent: 13, resetsAt: null },
      { kind: 'spend_limit', percent: 5, resetsAt: null },
    ])
  })
})

describe('toSnapshot', () => {
  test('missing cost and context stay null, not zero', () => {
    const s = toSnapshot({ startedAt: 1, context: { window: 1_000_000 }, rateLimits: [] }, 'claude-opus-5-5', 'high', '/w', '/h', null)
    expect(s.costUsd).toBeNull()
    expect(s.contextTokens).toBeNull()
    expect(s.contextPercent).toBeNull()
    expect(s.limits).toEqual([])
    expect(s.contextWindow).toBe(1_000_000)
  })
  test('copies the figures', () => {
    const s = toSnapshot({ startedAt: 5, context: { tokens: 412_000, window: 1_000_000, percent: 41 }, rateLimits: [], cost: { usd: 3.5 } }, 'm', null, '/w', '/h', 0.2)
    expect([s.contextTokens, s.contextPercent, s.costUsd, s.turnCostUsd, s.startedAt]).toEqual([412_000, 41, 3.5, 0.2, 5])
  })
})

describe('toBreakdown', () => {
  test('keeps used, free and buffer rows; drops deferred and empty ones', () => {
    const b = toBreakdown({
      categories: [
        { name: 'System prompt', tokens: 3700, kind: 'used' },
        { name: 'MCP tools', tokens: 0, kind: 'used' },
        { name: 'Deferred tools', tokens: 900, kind: 'deferred' },
        { name: 'Free space', tokens: 500_000, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      ],
      totalTokens: 412_000, rawMaxTokens: 1_000_000, autoCompactThreshold: 967_000, isAutoCompactEnabled: true,
    })
    expect(b?.categories.map(c => [c.name, c.kind])).toEqual([['system prompt', 'used'], ['free space', 'free'], ['autocompact buffer', 'buffer']])
    expect([b?.total, b?.window, b?.compactAt]).toEqual([412_000, 1_000_000, 967_000])
  })
  test('compaction off or bad input', () => {
    expect(toBreakdown({ categories: [], totalTokens: 1, rawMaxTokens: 2, isAutoCompactEnabled: false })?.compactAt).toBeNull()
    expect(toBreakdown(undefined)).toBeNull()
    expect(toBreakdown({ categories: 'x' })).toBeNull()
  })
})
