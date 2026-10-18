import { describe, expect, test } from 'claude-code/testing'
import type { BinnacleSnapshot } from '../types'
import { DEFAULT_SETTINGS, setItem } from '../hooks/core/settings.ts'
import { buildGroups } from '../hooks/modules/status/segments.ts'
import { fit, spansWidth, withTail } from '../hooks/modules/status/layout.ts'
import { alerts } from '../hooks/modules/status/attention.ts'

const NOW = 1_800_000_000_000
// Local-time constructors keep the expected clock text independent of the host timezone.
const FIVE_RESET = new Date(2027, 0, 6, 14, 30).getTime()
const SEVEN_RESET = new Date(2027, 0, 7, 9, 0).getTime()
// The status line shows time left, so its fixtures are offsets from NOW.
const FIVE_LEFT = NOW + (2 * 60 + 10) * 60_000
const SEVEN_LEFT = NOW + (2 * 24 + 4) * 3_600_000
const SNAP: BinnacleSnapshot = {
  model: 'claude-opus-5-5', effort: 'high',
  contextTokens: 412_000, contextWindow: 1_000_000, contextPercent: 41,
  startedAt: NOW - (20 * 60 + 2) * 60_000, costUsd: 52.46, turnCostUsd: 0.08,
  limits: [
    { kind: 'five_hour', percent: 45, resetsAt: FIVE_LEFT },
    { kind: 'seven_day', percent: 13, resetsAt: SEVEN_LEFT },
  ],
  cwd: '/Users/me/workspace/binnacle', home: '/Users/me',
}
const text = (row: { text: string }[]) => row.map(s => s.text).join('')

describe('fit', () => {
  test('wide terminal: one row with full forms', () => {
    const rows = fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW), 200)
    expect(rows).toHaveLength(1)
    expect(text(rows[0])).toBe('Opus 5.5 · high │ ctx ███░░░░ 412k/1M 41% │ 5h █░░ 45% ↻2h10m · 7d ░░░ 13% ↻2d4h │ 20h02m · $52.46 (+0.08) │ ~/workspace/binnacle')
  })
  test('medium terminal: wraps to two rows of full forms before shortening anything', () => {
    const rows = fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW), 100)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(spansWidth(r)).toBeLessThan(101)
    expect(rows.map(text)).toEqual([
      'Opus 5.5 · high │ ctx ███░░░░ 412k/1M 41% │ 5h █░░ 45% ↻2h10m · 7d ░░░ 13% ↻2d4h',
      '20h02m · $52.46 (+0.08) │ ~/workspace/binnacle',
    ])
  })
  test('shortens, least important first, only when two rows are not enough', () => {
    const rows = fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW), 60)
    expect(rows.length).toBeLessThan(3)
    for (const r of rows) expect(spansWidth(r)).toBeLessThan(61)
    expect(rows.map(text).join(' │ ')).toContain('ctx ███░░░░ 412k/1M 41%')
  })
  test('narrow terminal: every row fits', () => {
    for (const width of [40, 50, 60, 70]) {
      const rows = fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW), width)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) expect(spansWidth(r)).toBeLessThan(width + 1)
    }
  })
  test('no subscription limits and no cost ledger: groups are omitted, not zeroed', () => {
    const rows = fit(buildGroups({ ...SNAP, limits: [], costUsd: null, turnCostUsd: null }, DEFAULT_SETTINGS, NOW), 200)
    const t = text(rows[0])
    expect(t).not.toContain('5h')
    expect(t).not.toContain('$')
    expect(t).toContain('20h02m')
  })
  test('hidden items disappear', () => {
    const s = setItem(setItem(DEFAULT_SETTINGS, 'cwd', false), 'effort', false)
    const t = text(fit(buildGroups(SNAP, s, NOW), 200)[0])
    expect(t).not.toContain('binnacle')
    expect(t).not.toContain('high')
    expect(t.startsWith('Opus 5.5 │')).toBe(true)
  })
  test('time left is shown at any percent, colour by threshold', () => {
    const hot = { ...SNAP, limits: [{ kind: 'five_hour', percent: 92, resetsAt: FIVE_LEFT }] }
    const row = fit(buildGroups(hot, DEFAULT_SETTINGS, NOW), 200)[0]
    const at = row.findIndex(sp => sp.text.startsWith('5h'))
    expect(text(row.slice(at, at + 2))).toBe('5h ███ 92% ↻2h10m')
    expect(row[at]?.color).toBe('error')
    expect(row[at + 1]?.color).toBe('error')
  })
  test('limits forms: bar+reset, then reset without bar, then minimal', () => {
    const limits = buildGroups(SNAP, DEFAULT_SETTINGS, NOW).find(g => g.id === 'limits')!
    expect(limits.forms.map(text)).toEqual([
      '5h █░░ 45% ↻2h10m · 7d ░░░ 13% ↻2d4h',
      '5h 45% ↻2h10m · 7d 13% ↻2d4h',
      '45%/13%',
    ])
    // Empty cells `subtle`, the rest in the limit's band.
    expect(limits.forms[0]?.slice(0, 3)).toEqual([{ text: '5h █', color: 'success' }, { text: '░░', color: 'subtle' }, { text: ' 45% ↻2h10m', color: 'success' }])
  })
  test('a reset that has already passed reads now', () => {
    const s = { ...SNAP, limits: [{ kind: 'five_hour', percent: 45, resetsAt: NOW - 60_000 }] }
    expect(text(fit(buildGroups(s, DEFAULT_SETTINGS, NOW), 200)[0])).toContain('5h █░░ 45% ↻now')
  })
  test('a 7d reset over a day away reads NdNh, under an hour reads Nm', () => {
    const s = { ...SNAP, limits: [{ kind: 'seven_day', percent: 13, resetsAt: SEVEN_LEFT }, { kind: 'five_hour', percent: 45, resetsAt: NOW + 45 * 60_000 }] }
    const t = text(fit(buildGroups(s, DEFAULT_SETTINGS, NOW), 200)[0])
    expect(t).toContain('7d ░░░ 13% ↻2d4h')
    expect(t).toContain('5h █░░ 45% ↻45m')
  })
  test('a limit without a reset time shows no reset text', () => {
    const s = { ...SNAP, limits: [{ kind: 'five_hour', percent: 45, resetsAt: null }] }
    expect(text(fit(buildGroups(s, DEFAULT_SETTINGS, NOW), 200)[0])).toContain('5h █░░ 45% │')
  })
  test('tail hint is added only when it fits', () => {
    const rows = fit(buildGroups(SNAP, DEFAULT_SETTINGS, NOW), 200)
    expect(text(withTail(rows, '(shift+tab to cycle)', 200).at(-1) ?? [])).toContain('(shift+tab to cycle)')
    expect(text(withTail(rows, '(shift+tab to cycle)', spansWidth(rows[0]) + 5).at(-1) ?? [])).not.toContain('shift+tab')
  })
})

describe('alerts', () => {
  test('quiet when nothing needs attention', () => {
    expect(alerts(SNAP, null, NOW)).toEqual([])
  })
  test('a limit and the context, each under its own key; no guard item (⚑ guard N shows refusals)', () => {
    const hot = { ...SNAP, contextTokens: 860_000, contextPercent: 86, limits: [{ kind: 'five_hour', percent: 92, resetsAt: FIVE_RESET }] }
    const b = {
      categories: [
        { name: 'messages', tokens: 700_000, kind: 'used' as const },
        { name: 'system tools', tokens: 11_000, kind: 'used' as const },
        { name: 'free space', tokens: 107_000, kind: 'free' as const },
      ],
      total: 860_000, window: 1_000_000, compactAt: 967_000,
    }
    expect(alerts(hot, b, FIVE_RESET - 14 * 60_000).map(x => [x.key, x.text])).toEqual([
      ['limit:five_hour', '⚠ 5h limit 92% · resets 14:30 (in 14m)'],
      ['context:80', '⚠ context 86% · 107k to compaction (messages 81%) → /compact or hand off'],
    ])
  })
  test('context at 90% is a new key, so crossing it alerts again', () => {
    expect(alerts({ ...SNAP, contextTokens: 910_000, contextPercent: 91 }, null, NOW).map(x => x.key)).toEqual(['context:90'])
  })
  test('limit reset shows clock and countdown; 7d with weekday', () => {
    const at = SEVEN_RESET - (2 * 24 + 4) * 3_600_000
    const hot = { ...SNAP, limits: [{ kind: 'seven_day', percent: 95, resetsAt: SEVEN_RESET }] }
    expect(alerts(hot, null, at).map(x => x.text)).toEqual(['⚠ 7d limit 95% · resets Thu 09:00 (in 2d4h)'])
  })
})

describe('before the first request', () => {
  test("the context shows the breakdown's total (what /context counts) until the first request reports its own", () => {
    const fresh = { ...SNAP, contextTokens: null, contextPercent: null }
    const b = { categories: [{ name: 'system tools', tokens: 31_000, kind: 'used' as const }], total: 31_000, window: 1_000_000, compactAt: null }
    const forms = buildGroups(fresh, DEFAULT_SETTINGS, NOW, b).find(g => g.id === 'context')!.forms.map(text)
    expect(forms.at(-2)).toBe('ctx 31k 3%')
    expect(forms.at(-1)).toBe('ctx 3%')
    // With neither, still the dash.
    expect(buildGroups(fresh, DEFAULT_SETTINGS, NOW, null).find(g => g.id === 'context')!.forms.map(text).at(-1)).toBe('ctx —')
  })
})

describe('effort before the first request', () => {
  test('an effort not known yet is left out (Claude Code shows its own above the prompt), not drawn as a dash', () => {
    const fresh = { ...SNAP, effort: null }
    const g = buildGroups(fresh, DEFAULT_SETTINGS, NOW).find(x => x.id === 'model')!
    expect(g.forms.map(text)).toEqual(['Opus 5.5', 'Opus'])
    const effortOnly = setItem(DEFAULT_SETTINGS, 'model', false)
    expect(buildGroups(fresh, effortOnly, NOW).find(x => x.id === 'model')).toBeUndefined()
    expect(buildGroups(SNAP, effortOnly, NOW).find(x => x.id === 'model')?.forms.map(text)).toEqual(['high', expect.any(String)])
  })
})
