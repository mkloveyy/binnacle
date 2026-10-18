import { describe, expect, test } from 'claude-code/testing'
import { bar, countdown, elapsed, resetClock, resetLabel, duration, effortLabel, modelEffort, modelLabel, money, shortenPath, tokens } from '../hooks/core/format.ts'
import { textWidth } from '../hooks/core/width.ts'

describe('modelLabel', () => {
  test('known families', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
    expect(modelLabel('claude-fable-5')).toBe('Fable 5')
    expect(modelLabel('us.anthropic.claude-opus-4-7-v1:0')).toBe('Opus 4.7')
  })
  test('unknown passes through', () => {
    expect(modelLabel('opus')).toBe('opus')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
  })
})

describe('effortLabel', () => {
  test('long and short', () => {
    expect(effortLabel('high')).toBe('high')
    expect(effortLabel('high', true)).toBe('hi')
    expect(effortLabel('xhigh', true)).toBe('xhi')
    expect(effortLabel('medium', true)).toBe('med')
    expect(effortLabel(null)).toBe('—')
    expect(effortLabel('42')).toBe('42')
  })
})

describe('numbers and time', () => {
  test('tokens', () => {
    expect(tokens(850)).toBe('850')
    expect(tokens(412_345)).toBe('412k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(1_250_000)).toBe('1.3M')
  })
  test('duration', () => {
    expect(duration(30_000)).toBe('<1m')
    expect(duration(35 * 60_000)).toBe('35m')
    expect(duration((20 * 60 + 2) * 60_000)).toBe('20h02m')
  })
  test('countdown', () => {
    expect(countdown(-5)).toBe('now')
    expect(countdown(25 * 60_000)).toBe('25m')
    expect(countdown(105 * 60_000)).toBe('1h45m')
    expect(countdown((5 * 24 * 60 + 2 * 60 + 55) * 60_000)).toBe('5d2h')
  })
  test('resetClock', () => {
    expect(resetClock(new Date(2027, 0, 6, 14, 30).getTime(), false)).toBe('14:30')
    expect(resetClock(new Date(2027, 0, 7, 9, 0).getTime(), true)).toBe('Thu 09:00')
    expect(resetClock(new Date(2027, 0, 10, 0, 5).getTime(), true)).toBe('Sun 00:05')
    expect(resetClock(new Date(2027, 0, 9, 23, 59).getTime(), false)).toBe('23:59')
  })
  test('resetLabel', () => {
    const at = new Date(2027, 0, 6, 14, 30).getTime()
    expect(resetLabel(at, at - 65 * 60_000, false)).toBe('14:30 (in 1h5m)')
    expect(resetLabel(at, at + 1000, false)).toBe('14:30 (now)')
    const w = new Date(2027, 0, 7, 9, 0).getTime()
    expect(resetLabel(w, w - (2 * 24 + 4) * 3_600_000, true)).toBe('Thu 09:00 (in 2d4h)')
  })
  test('bar and money', () => {
    expect(bar(0, 5)).toBe('░░░░░')
    expect(bar(41, 7)).toBe('███░░░░')
    expect(bar(150, 3)).toBe('███')
    expect(money(52.456)).toBe('$52.46')
  })
})

describe('shortenPath', () => {
  test('home and length', () => {
    expect(shortenPath('/Users/me', '/Users/me', 40)).toBe('~')
    expect(shortenPath('/Users/me/workspace/binnacle', '/Users/me', 40)).toBe('~/workspace/binnacle')
    expect(shortenPath('/Users/me/a/very/deep/tree/of/folders/here', '/Users/me', 20)).toBe('…/of/folders/here')
    expect(shortenPath('/opt/x', '/Users/me', 40)).toBe('/opt/x')
  })
})

describe('textWidth', () => {
  test('ascii, blocks and CJK', () => {
    expect(textWidth('abc')).toBe(3)
    expect(textWidth('██░')).toBe(3)
    expect(textWidth('上下文')).toBe(6)
    expect(textWidth('⏰')).toBe(2)
  })
})

test('elapsed keeps seconds under an hour', () => {
  expect(elapsed(42_400)).toBe('42s')
  expect(elapsed(62_000)).toBe('1m02s')
  expect(elapsed(3_900_000)).toBe('1h05m')
  expect(elapsed(-5)).toBe('0s')
})

describe('modelEffort', () => {
  test('model · effort, or the model alone while no turn has reported the effort', () => {
    expect(modelEffort('claude-opus-5-5', 'high')).toBe('Opus 5.5 · high')
    expect(modelEffort('claude-opus-5-5', null)).toBe('Opus 5.5')
    expect(modelEffort('claude-opus-5-5', '')).toBe('Opus 5.5')
  })
})
