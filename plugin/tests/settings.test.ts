import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS, ITEMS, normalizeSettings, parseCommand, pluginEnabled, pluginSetting, ruleEnabled, setItem, setPlugin, setPluginSetting, setRule } from '../hooks/core/settings.ts'

describe('normalizeSettings', () => {
  test('garbage falls back to defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ status: 3, rules: [] })).toEqual(DEFAULT_SETTINGS)
  })
  test('keeps known booleans and drops the rest', () => {
    const s = normalizeSettings({ status: { cwd: false, bogus: false, model: 'no' }, rules: { 'git.force-push': false, x: 1 } })
    expect(s.status.cwd).toBe(false)
    expect(s.status.model).toBe(true)
    expect(s.rules).toEqual({ 'git.force-push': false })
    expect(s.version).toBe(1)
  })
  test('new items get their default', () => {
    expect(normalizeSettings({ version: 1, status: { cwd: false }, rules: {} }).status.limits).toBe(true)
  })
})

describe('setters', () => {
  test('setItem and setRule return new objects', () => {
    const a = setItem(DEFAULT_SETTINGS, 'cwd', false)
    expect(a.status.cwd).toBe(false)
    expect(DEFAULT_SETTINGS.status.cwd).toBe(true)
    const b = setRule(a, 'sql.unbounded', false)
    expect(ruleEnabled(b, 'sql.unbounded', true)).toBe(false)
    expect(ruleEnabled(b, 'k8s.all-namespaces', true)).toBe(true)
    expect(ruleEnabled(b, 'pack.off-by-default', false)).toBe(false)
  })
})

describe('parseCommand', () => {
  test('search keeps its query, at most 200 characters', () => {
    expect(parseCommand('search  sextant row ')).toEqual({ kind: 'open', tab: 'search', query: 'sextant row' })
    expect(parseCommand(`search ${'x'.repeat(500)}`)).toEqual({ kind: 'open', tab: 'search', query: 'x'.repeat(200) })
  })
  test('forms', () => {
    expect(parseCommand('')).toEqual({ kind: 'open' })
    expect(parseCommand('  status hide cwd ')).toEqual({ kind: 'status', item: 'cwd', on: false })
    expect(parseCommand('status show limits')).toEqual({ kind: 'status', item: 'limits', on: true })
    expect(parseCommand('guard off git.force-push')).toEqual({ kind: 'rule', id: 'git.force-push', on: false })
    expect(parseCommand('guard on git.force-push')).toEqual({ kind: 'rule', id: 'git.force-push', on: true })
    expect(parseCommand('guard list')).toEqual({ kind: 'list' })
    expect(parseCommand('activity')).toEqual({ kind: 'open', tab: 'activity' })
    expect(parseCommand('flow')).toEqual({ kind: 'open', tab: 'flow' })
    expect(parseCommand(' activity clear ')).toEqual({ kind: 'activity-clear' })
    expect(parseCommand('activity dance').kind).toBe('error')
    expect(parseCommand('diff')).toEqual({ kind: 'open', tab: 'diff' })
    expect(parseCommand(' agents ')).toEqual({ kind: 'open', tab: 'agents' })
    expect(parseCommand('agents now').kind).toBe('error')
  })
  test('the usage names every tab the command opens', () => {
    const bad = parseCommand('dance')
    expect(bad.kind === 'error' && bad.message).toContain('/binnacle [activity|agents|flow|diff]')
  })
  test('errors name the valid choices', () => {
    const bad = parseCommand('status hide weather')
    expect(bad.kind).toBe('error')
    expect(bad.kind === 'error' && bad.message).toContain('model, effort, context, limits, duration, cost, cwd')
    expect(parseCommand('dance').kind).toBe('error')
  })
})

describe('per-plugin switch', () => {
  test('plugins are on unless turned off, and the switch survives normalizing', () => {
    expect(pluginEnabled(DEFAULT_SETTINGS, 'packy')).toBe(true)
    const off = setPlugin(DEFAULT_SETTINGS, 'packy', false)
    expect(pluginEnabled(off, 'packy')).toBe(false)
    expect(normalizeSettings(off).plugins).toEqual({ packy: false })
    expect(normalizeSettings({ plugins: { a: 'no', b: true } }).plugins).toEqual({ b: true })
  })
})
describe('plugin settings', () => {
  test('stored under plugin/id, read with the plugin default, kept by normalize', () => {
    expect(pluginSetting(DEFAULT_SETTINGS, 'p', 'line', true)).toBe(true)
    const off = setPluginSetting(DEFAULT_SETTINGS, 'p', 'line', false)
    expect(pluginSetting(off, 'p', 'line', true)).toBe(false)
    expect(normalizeSettings({ ...off, pluginSettings: { ...off.pluginSettings, bad: 'x' } }).pluginSettings).toEqual({ 'p/line': false })
  })
})

test('the status items are these seven, and a bare word that is no command is an error', () => {
  expect(ITEMS).toEqual(['model', 'effort', 'context', 'limits', 'duration', 'cost', 'cwd'])
  expect(parseCommand('sprints').kind).toBe('error')
})
