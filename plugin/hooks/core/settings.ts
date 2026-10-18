import type { BinnacleItem, BinnacleSettings } from '../../types'

export const ITEMS: readonly BinnacleItem[] = ['model', 'effort', 'context', 'limits', 'duration', 'cost', 'cwd']

export const DEFAULT_SETTINGS: BinnacleSettings = {
  version: 1,
  status: { model: true, effort: true, context: true, limits: true, duration: true, cost: true, cwd: true },
  rules: {},
  plugins: {},
  pluginSettings: {},
  history: { lineage: false },
}

export const STORE_KEY = 'settings'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function normalizeSettings(raw: unknown): BinnacleSettings {
  const src = isRecord(raw) ? raw : {}
  const status = { ...DEFAULT_SETTINGS.status }
  if (isRecord(src.status)) {
    for (const item of ITEMS) {
      const v = src.status[item]
      if (typeof v === 'boolean') status[item] = v
    }
  }
  const rules: Record<string, boolean> = {}
  if (isRecord(src.rules)) {
    for (const [id, v] of Object.entries(src.rules)) if (typeof v === 'boolean') rules[id] = v
  }
  const plugins: Record<string, boolean> = {}
  if (isRecord(src.plugins)) {
    for (const [name, v] of Object.entries(src.plugins)) if (typeof v === 'boolean') plugins[name] = v
  }
  const pluginSettings: Record<string, boolean> = {}
  if (isRecord(src.pluginSettings)) {
    for (const [key, v] of Object.entries(src.pluginSettings)) if (typeof v === 'boolean' && key.includes('/')) pluginSettings[key] = v
  }
  const lineage = isRecord(src.history) && typeof src.history.lineage === 'boolean' ? src.history.lineage : false
  return { version: 1, status, rules, plugins, pluginSettings, history: { lineage } }
}

export const setItem = (s: BinnacleSettings, item: BinnacleItem, on: boolean): BinnacleSettings => ({
  ...s,
  status: { ...s.status, [item]: on },
})

export const setRule = (s: BinnacleSettings, id: string, on: boolean): BinnacleSettings => ({
  ...s,
  rules: { ...s.rules, [id]: on },
})

export const ruleEnabled = (s: BinnacleSettings, id: string, def: boolean): boolean =>
  typeof s.rules[id] === 'boolean' ? s.rules[id] : def

export const setPlugin = (s: BinnacleSettings, name: string, value: boolean): BinnacleSettings => ({
  ...s,
  plugins: { ...s.plugins, [name]: value },
})

/** Count compactions across forks (reads the earlier sessions' transcripts, §5.3). */
export const setLineage = (s: BinnacleSettings, lineage: boolean): BinnacleSettings => ({ ...s, history: { lineage } })

export const pluginEnabled = (s: BinnacleSettings, name: string): boolean => s.plugins[name] !== false

/** binnacle's version, as `$.binnacle.version()` reports it; kept equal to plugin.json's. */
export const VERSION = '0.6.0'

const settingKey = (plugin: string, id: string): string => `${plugin}/${id}`

export const pluginSetting = (s: BinnacleSettings, plugin: string, id: string, def: boolean): boolean => {
  const v = s.pluginSettings[settingKey(plugin, id)]
  return typeof v === 'boolean' ? v : def
}

export const setPluginSetting = (s: BinnacleSettings, plugin: string, id: string, value: boolean): BinnacleSettings => ({
  ...s,
  pluginSettings: { ...s.pluginSettings, [settingKey(plugin, id)]: value },
})

export type Command =
  | { kind: 'open'; tab?: 'activity' | 'agents' | 'flow' | 'diff' | 'search'; query?: string }
  | { kind: 'list' }
  | { kind: 'status'; item: BinnacleItem; on: boolean }
  | { kind: 'rule'; id: string; on: boolean }
  | { kind: 'activity-clear' }
  | { kind: 'error'; message: string }

const USAGE = 'Usage: /binnacle [activity|agents|flow|diff]  |  /binnacle search [query]  |  /binnacle activity clear  |  /binnacle status show|hide <item>  |  /binnacle guard on|off <rule>  |  /binnacle guard list'

export function parseCommand(args: string): Command {
  const w = args.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return { kind: 'open' }
  if (w.length === 1 && w[0] === 'activity') return { kind: 'open', tab: 'activity' }
  if (w.length === 2 && w[0] === 'activity' && w[1] === 'clear') return { kind: 'activity-clear' }
  if (w.length === 1 && w[0] === 'diff') return { kind: 'open', tab: 'diff' }
  if (w.length === 1 && w[0] === 'agents') return { kind: 'open', tab: 'agents' }
  if (w.length === 1 && w[0] === 'flow') return { kind: 'open', tab: 'flow' }
  // At most 200 characters, as the Search field keeps (fuzzy.ts MAX_QUERY).
  if (w[0] === 'search') return { kind: 'open', tab: 'search', query: args.trim().slice('search'.length).trim().slice(0, 200) }
  if (w[0] === 'guard' && w[1] === 'list' && w.length === 2) return { kind: 'list' }
  if (w[0] === 'status' && (w[1] === 'show' || w[1] === 'hide') && w.length === 3) {
    const item = w[2] as BinnacleItem
    if (!ITEMS.includes(item)) return { kind: 'error', message: `Unknown item "${w[2]}". Items: ${ITEMS.join(', ')}.` }
    return { kind: 'status', item, on: w[1] === 'show' }
  }
  if (w[0] === 'guard' && (w[1] === 'on' || w[1] === 'off') && w.length === 3) return { kind: 'rule', id: w[2], on: w[1] === 'on' }
  return { kind: 'error', message: USAGE }
}
