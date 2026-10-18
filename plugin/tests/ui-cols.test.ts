import { describe, expect, test } from 'claude-code/testing'
import { textWidth } from '../hooks/core/width.ts'
import { BUDGET, card, cutEnd, cutMiddle, cutSpans, dated, heading, hhmm, layoutRows, MAX_LIST, MAX_OPTIONS, NARROW, pct, rule, stamp, when, widthOf, type Span } from '../hooks/modules/ui/cols.ts'
import { ROLE, SYM } from '../hooks/modules/ui/theme.ts'

const text = (l: Span[]): string => l.map(s => s.text).join('')

describe('roles and symbols', () => {
  test('every role is a host ThemeKey; no terminal colour names', () => {
    expect(Object.values(ROLE)).toEqual(['text', 'inactive', 'subtle', 'claude', 'suggestion', 'success', 'warning', 'error', 'permission', 'diffAdded', 'diffRemoved'])
    expect(SYM.guard).toBe('⚑')
    expect(SYM.compact).toBe('⇣')
    expect(Object.entries(SYM).filter(([, g]) => textWidth(g) !== 1).map(([k, g]) => [k, textWidth(g)])).toEqual([['stale', 2]])
  })
  test('the host limits are constants', () => {
    expect([NARROW, BUDGET, MAX_LIST, MAX_OPTIONS]).toEqual([60, 90_000, 400, 64])
  })
})

describe('cutting', () => {
  test('free text is cut at the end by display width (CJK is two columns)', () => {
    expect(cutEnd('find store writes', 8)).toBe('find st…')
    expect(cutEnd('研发任务上线清单', 7)).toBe('研发任…')
    expect(cutEnd('short', 10)).toBe('short')
  })
  test('paths are cut in the middle, the last segment kept whole', () => {
    expect(cutMiddle('~/workspace/binnacle', 13)).toBe('~/w…/binnacle')
    expect(cutMiddle('abcdefghij', 5)).toBe('ab…ij')
  })
})

describe('layoutRows', () => {
  const rows = layoutRows([
    { lead: [{ text: '▾ #12  ' }, { text: 'you   ' }], body: 'fix the sextant row width', nums: [[{ text: '2m14s' }], [{ text: '$0.41' }]] },
    { lead: [{ text: '     ● Explore   ' }], body: 'find store writes', nums: [[{ text: '1m02s' }], [{ text: '12k/3k' }]] },
    { lead: [{ text: '     ✗ asked → you denied   ' }], body: 'rm -rf /tmp/x' },
  ], 80)
  test('number columns are right-aligned across the whole set and the line fills the width', () => {
    expect(text(rows[0] as Span[])).toMatch(/^▾ #12  you   fix the sextant row width\s+2m14s   \$0\.41$/)
    expect(text(rows[1] as Span[])).toMatch(/^     ● Explore   find store writes\s+1m02s  12k\/3k$/)
    expect(widthOf(rows[0] as Span[])).toBe(80)
    expect(widthOf(rows[1] as Span[])).toBe(80)
    expect(text(rows[2] as Span[])).toBe('     ✗ asked → you denied   rm -rf /tmp/x')
  })
  test('narrow: the body is cut first, numbers never; trailing number columns go before the body gets too short', () => {
    const [one] = layoutRows([{ lead: [{ text: '▾ #12  you   ' }], body: 'x'.repeat(60), nums: [[{ text: '2m14s' }], [{ text: '$0.41' }]] }], 30)
    expect(widthOf(one as Span[])).toBeLessThanOrEqual(30)
    expect(text(one as Span[])).toMatch(/^▾ #12  you   x+…\s+2m14s$/)
  })
  test('control characters become visible before anything is measured', () => {
    const [one] = layoutRows([{ lead: [{ text: 'a\x1b' }], body: 'b\x07' }], 20)
    expect(text(one as Span[])).toBe('a^[b^G')
  })
  test('tabs and newlines become one space each, so the width arithmetic holds', () => {
    const out = layoutRows([
      { lead: [{ text: 'x\t' }], body: 'one\ntwo', nums: [[{ text: '9' }]] },
      { lead: [{ text: 'y ' }], body: 'a\tb', nums: [[{ text: '10' }]] },
    ], 30)
    expect(text(out[0] as Span[])).toMatch(/^x one two\s+9$/)
    expect(text(out[1] as Span[])).toMatch(/^y a b\s+10$/)
    for (const l of out) expect(widthOf(l)).toBe(30)
  })
  test('cutSpans gives nothing for no room', () => {
    expect(cutSpans([{ text: 'abc' }], 0)).toEqual([])
    expect(cutSpans([{ text: 'abc' }], -1)).toEqual([])
  })
})

describe('heading, card, rule', () => {
  test('a heading puts the summary at the right edge in inactive', () => {
    const h = heading('Context', '412k / 1M', 40)
    expect(text(h)).toHaveLength(40)
    expect(h[0]).toEqual({ text: 'Context', bold: true })
    expect(h.at(-1)).toEqual({ text: '412k / 1M', color: 'inactive' })
  })
  test('a card has its title in the top border and every line exactly the width', () => {
    const c = card('Opus 5.5 · high', '1h12m session', [[{ text: 'cost    $12.40' }]], 78)
    expect(text(c[0] as Span[])).toMatch(/^╭ Opus 5\.5 · high ─+ 1h12m session ╮$/)
    expect(text(c[1] as Span[])).toMatch(/^│ cost    \$12\.40\s+│$/)
    expect(text(c[2] as Span[])).toMatch(/^╰─+╯$/)
    for (const l of c) expect(widthOf(l)).toBe(78)
    expect(c[0]?.[0]).toEqual({ text: '╭ ', color: 'subtle' })
  })
  test('a newline in a card line is a space; every line keeps the width', () => {
    const c = card('t', 'r', [[{ text: 'goal\nline2' }]], 60)
    expect(text(c[1] as Span[])).toMatch(/^│ goal line2\s+│$/)
    for (const l of c) expect(widthOf(l)).toBe(60)
  })
  test('a heading keeps its title whole and cuts the summary', () => {
    const h = heading('Compactions', `1 in this file ${'x'.repeat(60)} · last 10-12 14:00`, 50)
    expect(h[0]?.text).toBe('Compactions')
    expect(widthOf(h)).toBe(50)
    expect(h[2]?.text.endsWith('…')).toBe(true)
  })
  test('a long right-hand summary is cut, the top line keeps the width', () => {
    const c = card('t', 'x'.repeat(80), [[{ text: 'a' }]], 60)
    for (const l of c) expect(widthOf(l)).toBe(60)
  })
  test('below 60 columns a card is a heading and its lines, no border', () => {
    const c = card('t', 'r', [[{ text: 'a' }]], 50)
    expect(c).toHaveLength(2)
    expect(text(c[0] as Span[])).toMatch(/^t\s+r$/)
  })
  test('the rule is one subtle line of the width', () => {
    expect(rule(10)).toEqual([{ text: '─'.repeat(10), color: 'subtle' }])
  })
})

describe('numbers', () => {
  test('percent right-aligned in four columns, <1% for a share that rounds to 0', () => {
    expect([pct(7, 100), pct(41, 100), pct(100, 100), pct(1, 1000), pct(0, 0)]).toEqual(['  7%', ' 41%', '100%', ' <1%', '  0%'])
  })
  test('HH:MM in local time', () => {
    const d = new Date(2026, 9, 12, 9, 5)
    expect(hhmm(d.getTime())).toBe('09:05')
  })
  test('a time from another day carries its date; a column is dated as a whole', () => {
    const now = new Date(2026, 9, 13, 20, 0).getTime()
    const today = new Date(2026, 9, 13, 9, 5).getTime()
    const before = new Date(2026, 9, 12, 23, 59, 7).getTime()
    expect(when(today, now)).toBe('09:05')
    expect(when(before, now)).toBe('10-12 23:59')
    expect(dated([today], now)).toBe(false)
    expect(dated([today, before], now)).toBe(true)
    expect(stamp(today, true)).toBe('10-13 09:05')
    expect(stamp(before, false, true)).toBe('23:59:07')
  })
})
