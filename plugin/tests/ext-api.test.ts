import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS } from '../hooks/core/settings.ts'
import { buildGroups } from '../hooks/modules/status/segments.ts'
import { fit } from '../hooks/modules/status/layout.ts'
import type { BinnacleButton, BinnacleGuardSource, BinnacleLine, BinnacleSegment, BinnacleSettingItem } from '../types'
import { cleanSpans, guardSourceOf, layoutTab, pickForm, pluginsIn, emptyRegistry, segmentGroup, setButton, setGuardSource, setLine, setSegment, setSetting, toNodes } from '../hooks/modules/ext/ext.ts'
import { flatten } from '../hooks/modules/activity/tree.ts'

const ok = <T>(r: { ok: true; list: T[] } | { ok: false; reason: string }): T[] => {
  if (!r.ok) throw new Error(r.reason)
  return r.list
}

describe('buttons', () => {
  test('cleaned and cut to 16 columns, a bad colour dropped, empty label removes, two per plugin', () => {
    let list: BinnacleButton[] = ok(setButton([], 'p', { id: 'a', label: '✎ go\x1b[31m and a very long tail', color: 'red;' }))
    expect(list).toEqual([{ plugin: 'p', id: 'a', label: '✎ go^[[31m and …' }])
    list = ok(setButton(list, 'p', { id: 'b', label: 'B', color: 'green' }))
    const third = setButton(list, 'p', { id: 'c', label: 'C' })
    expect(third.ok).toBe(false)
    expect(!third.ok && third.reason.startsWith('binnacle: p already has 2 buttons')).toBe(true)
    expect(ok(setButton(list, 'q', { id: 'c', label: 'C' })).length).toBe(3)
    // Replacing keeps its place.
    expect(ok(setButton(list, 'p', { id: 'a', label: 'A2' })).map(b => b.label)).toEqual(['A2', 'B'])
    expect(ok(setButton(list, 'p', { id: 'a', label: '' })).map(b => b.id)).toEqual(['b'])
  })
})

describe('segments', () => {
  test('priority clamped to 0–9 (default 5), press only when true, three per plugin', () => {
    let list: BinnacleSegment[] = ok(setSegment([], 'p', { id: 'a', text: 'x'.repeat(40), priority: 42, press: 'yes' }))
    expect(list[0]).toEqual({ plugin: 'p', id: 'a', text: 'x'.repeat(29) + '…', priority: 9, press: false })
    list = ok(setSegment(list, 'p', { id: 'b', text: 'b', press: true }))
    expect(list[1]?.priority).toBe(5)
    expect(list[1]?.press).toBe(true)
    list = ok(setSegment(list, 'p', { id: 'c', text: 'c' }))
    expect(setSegment(list, 'p', { id: 'd', text: 'd' }).ok).toBe(false)
  })
  test('one group, priority 6, the lowest priority dropped first, then none', () => {
    const segs: BinnacleSegment[] = [
      { plugin: 'p', id: 'lo', text: 'low', priority: 1, press: false },
      { plugin: 'p', id: 'hi', text: 'high', priority: 8, press: true, color: 'green' },
    ]
    const g = segmentGroup(segs)
    expect(g?.id).toBe('plugins')
    expect(g?.priority).toBe(6)
    expect(g?.forms.map(f => f.map(s => s.text).join(''))).toEqual(['high · low', 'high', ''])
    expect(g?.forms[0]?.[0]).toEqual({ text: 'high', color: 'green', ext: { plugin: 'p', id: 'hi' } })
    expect(segmentGroup([])).toBeNull()
  })
})

describe('lines', () => {
  test('forms cleaned, at most 4, each at most 200 characters; empty forms remove the line; one per plugin', () => {
    const forms = [[{ text: 'a\nb', color: 'no pe', bold: true }, { text: 'y'.repeat(300) }], [], [{ text: 'short' }], [{ text: '3' }], [{ text: '4' }], [{ text: '5' }]]
    const list: BinnacleLine[] = ok(setLine([], 'p', { id: 'l', forms, press: true }))
    expect(list[0]?.forms.length).toBe(4)
    expect(list[0]?.forms[0]?.[0]).toEqual({ text: 'a b', bold: true })
    expect(list[0]?.forms[0]?.reduce((n, s) => n + s.text.length, 0)).toBe(200)
    expect(list[0]?.press).toBe(true)
    expect(setLine(list, 'p', { id: 'm', forms: [[{ text: 'x' }]] }).ok).toBe(false)
    expect(ok(setLine(list, 'p', { id: 'l', forms: [] }))).toEqual([])
  })
  test('pickForm: the first that fits, else the last cut', () => {
    const forms = [[{ text: 'a long form' }], [{ text: 'short' }], [{ text: 'tiny but still long' }]]
    expect(pickForm(forms, 20).map(s => s.text).join('')).toBe('a long form')
    expect(pickForm(forms, 6).map(s => s.text).join('')).toBe('short')
    expect(pickForm(forms, 4).map(s => s.text).join('')).toBe('tin…')
  })
  test('cleanSpans skips what is not a span', () => {
    expect(cleanSpans([null, 3, { text: '' }, { text: 'ok', dim: true }], 10)).toEqual([{ text: 'ok', dim: true }])
    expect(cleanSpans('nope', 10)).toEqual([])
  })
})

describe('settings', () => {
  test('title cut to 40 columns, default boolean, empty title removes, ten per plugin', () => {
    let list: BinnacleSettingItem[] = []
    for (let i = 0; i < 10; i++) list = ok(setSetting(list, 'p', { id: `s${i}`, title: `T${i}`, default: i === 0 }))
    expect(list[0]).toEqual({ plugin: 'p', id: 's0', title: 'T0', def: true })
    expect(list[1]?.def).toBe(false)
    expect(setSetting(list, 'p', { id: 'x', title: 'X', default: true }).ok).toBe(false)
    expect(ok(setSetting(list, 'p', { id: 's0', title: '', default: true })).length).toBe(9)
  })
})

describe('guard sources', () => {
  test('a prefix is 3–40 characters, never binnacle…, one owner; three per plugin', () => {
    let list: BinnacleGuardSource[] = ok(setGuardSource([], 'sextant', { prefix: 'sextant-guard: ', source: 'sextant-guard' }))
    expect(list).toEqual([{ plugin: 'sextant', id: 'sextant-guard: ', prefix: 'sextant-guard: ', source: 'sextant-guard' }])
    expect(setGuardSource(list, 'other', { prefix: 'sextant-guard: ', source: 'x' }).ok).toBe(false)
    expect(setGuardSource(list, 'p', { prefix: 'ab', source: 'x' }).ok).toBe(false)
    expect(setGuardSource(list, 'p', { prefix: 'Binnacle-x: ', source: 'x' }).ok).toBe(false)
    expect(setGuardSource(list, 'p', { prefix: 'abc: ', source: '' }).ok).toBe(false)
    list = ok(setGuardSource(list, 'p', { prefix: 'p1: ', source: 'p' }))
    list = ok(setGuardSource(list, 'p', { prefix: 'p2: ', source: 'p' }))
    list = ok(setGuardSource(list, 'p', { prefix: 'p3: ', source: 'p' }))
    expect(setGuardSource(list, 'p', { prefix: 'p4: ', source: 'p' }).ok).toBe(false)
  })
  test('guardSourceOf: only the host prefix may stand before it; the rule and the reason from the prefix on', () => {
    const src: BinnacleGuardSource[] = [{ plugin: 'sextant', id: 'sextant-guard: ', prefix: 'sextant-guard: ', source: 'sextant-guard' }]
    expect(guardSourceOf(src, 'PreToolUse:Bash hook error: sextant-guard: release-gate · no deploy today')).toEqual({
      source: 'sextant-guard', ruleId: 'release-gate', reason: 'sextant-guard: release-gate · no deploy today',
    })
    expect(guardSourceOf(src, 'sextant-guard: x-y · z')?.ruleId).toBe('x-y')
    expect(guardSourceOf(src, 'he said sextant-guard: x · z')).toBeNull()
    expect(guardSourceOf(src, 'sextant-guard: Bad · z')).toBeNull()
    expect(guardSourceOf(src, undefined)).toBeNull()
    expect(guardSourceOf([{ plugin: 'p', id: 'a.b(: ', prefix: 'a.b(: ', source: 'p' }], 'a.b(: r · t')?.source).toBe('p')
  })
})

test('pluginsIn lists every plugin once, first seen first', () => {
  const r = { ...emptyRegistry(), buttons: [{ plugin: 'b', id: '1', label: 'x' }], settings: [{ plugin: 'a', id: '1', title: 't', def: true }, { plugin: 'b', id: '2', title: 't', def: true }] }
  expect(pluginsIn(r)).toEqual(['b', 'a'])
})

test('fit drops the plugin group before it shortens any of binnacle\'s own', () => {
  const snap = { model: 'claude-opus-5-5', effort: 'high', contextTokens: 400_000, contextWindow: 1_000_000, contextPercent: 40, startedAt: 0, costUsd: 3.2, turnCostUsd: null, limits: [{ kind: 'five_hour', percent: 30, resetsAt: null }], cwd: '/Users/me/workspace/project', home: '/Users/me' }
  const own = buildGroups(snap, DEFAULT_SETTINGS, 1_000_000)
  const plugins = segmentGroup([{ plugin: 'p', id: 'a', text: '⛵ deploying to production now', priority: 5, press: false }])
  const text = (rows: { text: string }[][]) => rows.map(r => r.map(s => s.text).join('')).join('\n')
  // The narrowest width where binnacle's own groups take both rows with nothing shortened: no room for a plugin.
  const full = (t: string) => t.includes('Opus 5.5 · high') && t.includes('$3.20') && t.includes('~/workspace/project')
  let w = 200
  while (w > 20 && !(fit(own, w).length === 2 && full(text(fit(own, w))) && !full(text(fit(own, w - 1))))) w--
  expect(w).toBeGreaterThan(20)
  const fullOwn = fit(own, w)
  const withPlugin = fit([...own, ...(plugins ? [plugins] : [])], w)
  expect(text(withPlugin)).not.toContain('deploying')
  expect(text(withPlugin)).toBe(text(fullOwn))
})

test('a tab lines up the rows of one level that have the same number of cells; a long single cell elsewhere leaves them alone', () => {
  const rows = flatten(toNodes([
    { text: 'voyager/release', cols: [[{ text: 'not this session · newest touched' }]] },
    { text: '  alpha', cols: [[{ text: 'millennium' }], [{ text: '6-review' }], [{ text: 'manual' }], [{ text: '2d' }]] },
    { text: '  beta two', cols: [[{ text: 'eternal' }], [{ text: '4-release' }], [{ text: 'auto' }], [{ text: '13d' }]] },
    { text: '[✓] rule', cols: [[{ text: 'x'.repeat(70) }]] },
  ], 't'), () => false).rows
  const lines = layoutTab(rows, 80).map(l => l.map(s => s.text).join(''))
  expect(lines[1]).toMatch(/alpha\s+millennium\s+6-review\s+manual\s+2d$/)
  expect(lines[2]).toMatch(/beta two\s+eternal\s+4-release\s+auto\s+13d$/)
  expect(lines[1]?.length).toBe(lines[2]?.length)
})
