import type { BinnacleAttentionItem, BinnacleAttentionLevel, BinnacleButton, BinnacleExtTab, BinnacleGuardSource, BinnacleLine, BinnacleSegment, BinnacleSettingItem, BinnacleSpan, BinnacleTabRow } from '../../../types'
import { brief, clip, visible } from '../activity/mask.ts'
import { treeRow, type FlatRow, type TreeNode } from '../activity/tree.ts'
import type { Group, Span as StatusSpan } from '../status/segments.ts'
import { cutEnd, cutSpans, layoutRows, widthOf, type Span } from '../ui/cols.ts'

export const MAX_ATTENTION = 3
export const MAX_TEXT = 80
export const MAX_TABS = 2
export const MAX_NODES = 2000
export const MAX_ROW_TEXT = 500
export const MAX_ID = 200
/** The plugin interface's version (spec §4.1): raised only by a change a plugin written for the old one would break on. */
export const API = 1
export const MAX_BUTTONS = 2
export const BUTTON_COLS = 16
export const MAX_SEGMENTS = 3
export const SEGMENT_COLS = 30
export const MAX_LINES = 1
export const MAX_FORMS = 4
export const FORM_CHARS = 200
export const MAX_SETTINGS = 10
export const SETTING_COLS = 40
export const MAX_GUARD_SOURCES = 3
export const MAX_COLS = 6
export const COL_CHARS = 60
export const MAX_ROW_BUTTONS = 6
export const ROW_BUTTON_COLS = 20

export type ExtResult<T> = { ok: true; list: T[] } | { ok: false; reason: string }

const LEVELS: readonly BinnacleAttentionLevel[] = ['error', 'warn', 'info']

const oneLine = (t: unknown): string => String(t ?? '').replace(/\s+/g, ' ').trim()

/** Another plugin's text as binnacle draws it: one line, control characters made visible (the host refuses them), at most `max`. */
const drawn = (t: unknown, max: number): string => clip(visible(oneLine(t)), max)

const asId = (id: unknown): string => clip(String(id), MAX_ID)

/** A hex colour or a plain name: the terminal refuses an empty colour, control characters and some other shapes. */
const COLOR = /^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[A-Za-z][A-Za-z0-9]{0,31})$/

const isRow = (r: unknown): r is BinnacleTabRow => typeof r === 'object' && r !== null && !Array.isArray(r)

/**
 * A new item's place: after every item of a plugin whose name sorts at or before its own. Plugins load in an order
 * the person's setup decides (measured: the reverse of the --plugin-dir order), so binnacle orders what they add by
 * name, and a plugin's own items by when it added them; footer buttons, tabs and their hotkeys stay put.
 */
function placed<T extends { plugin: string }>(list: readonly T[], item: T): T[] {
  let at = list.length
  while (at > 0 && (list[at - 1] as T).plugin > item.plugin) at--
  return [...list.slice(0, at), item, ...list.slice(at)]
}

/** One plugin's attention item: the same id replaces, empty text clears, at most three per plugin. */
export function setAttention(list: BinnacleAttentionItem[], plugin: string, args: { id: string; level: string; text: string }): ExtResult<BinnacleAttentionItem> {
  const id = asId(args.id)
  const rest = list.filter(x => !(x.plugin === plugin && x.id === id))
  const text = drawn(args.text, MAX_TEXT)
  if (text === '') return { ok: true, list: rest }
  if (rest.filter(x => x.plugin === plugin).length >= MAX_ATTENTION) {
    return { ok: false, reason: `binnacle: ${plugin} already shows ${MAX_ATTENTION} attention items; clear one (empty text) first.` }
  }
  const level = LEVELS.find(l => l === args.level) ?? 'info'
  return { ok: true, list: placed(rest, { plugin, id, level, text }) }
}

const countNodes = (rows: readonly unknown[]): number => rows.reduce((n: number, r) => (isRow(r) ? n + 1 + countNodes(Array.isArray(r.children) ? r.children : []) : n), 0)

/** The first `max` nodes, depth first, with only the fields binnacle draws; anything that is not a row is skipped. */
export function capNodes(rows: readonly BinnacleTabRow[], max = MAX_NODES): { rows: BinnacleTabRow[]; dropped: number } {
  let left = max
  let dropped = 0
  const walk = (list: readonly BinnacleTabRow[]): BinnacleTabRow[] => {
    const out: BinnacleTabRow[] = []
    for (const r of list) {
      if (!isRow(r)) continue
      if (left <= 0) {
        dropped += countNodes([r])
        continue
      }
      left--
      const row: BinnacleTabRow = { text: drawn(r.text, MAX_ROW_TEXT) }
      if (r.id !== undefined) row.id = asId(r.id)
      if (typeof r.color === 'string' && COLOR.test(r.color)) row.color = r.color
      if (r.dim === true) row.dim = true
      if (r.bold === true) row.bold = true
      const cols = Array.isArray(r.cols) ? r.cols.slice(0, MAX_COLS).map(c => cleanSpans(c, COL_CHARS)) : []
      if (cols.some(c => c.length > 0)) row.cols = cols
      if (r.press === true && row.id !== undefined) row.press = true
      const buttons = Array.isArray(r.buttons)
        ? r.buttons.filter(isObject).slice(0, MAX_ROW_BUTTONS).map(b => ({ id: asId(b.id), label: fitted(b.label, ROW_BUTTON_COLS) })).filter(b => b.label !== '')
        : []
      if (buttons.length) row.buttons = buttons
      const kids = Array.isArray(r.children) && r.children.length ? walk(r.children) : []
      if (kids.length) row.children = kids
      out.push(row)
    }
    return out
  }
  return { rows: walk(rows), dropped }
}

/** One plugin's tab: empty rows remove it, at most two per plugin; an update keeps its place (and its hotkey). */
export function setTab(list: BinnacleExtTab[], plugin: string, args: { id: string; title: string; rows: readonly BinnacleTabRow[] }): ExtResult<BinnacleExtTab> {
  const id = asId(args.id)
  const rest = list.filter(x => !(x.plugin === plugin && x.id === id))
  const { rows, dropped } = capNodes(Array.isArray(args.rows) ? args.rows : [])
  if (rows.length === 0) return { ok: true, list: rest }
  if (rest.filter(x => x.plugin === plugin).length >= MAX_TABS) {
    return { ok: false, reason: `binnacle: ${plugin} already has ${MAX_TABS} tabs; remove one (empty rows) first.` }
  }
  const tab: BinnacleExtTab = {
    plugin, id,
    title: drawn(args.title, 20) || drawn(id, 20),
    rows: dropped ? [...rows, { text: `… ${dropped} more rows not shown`, dim: true }] : rows,
  }
  const at = list.findIndex(x => x.plugin === plugin && x.id === id)
  return { ok: true, list: at >= 0 ? list.map((x, i) => (i === at ? tab : x)) : placed(rest, tab) }
}

export const tabKey = (t: { plugin: string; id: string }): `ext:${string}` => `ext:${t.plugin}/${t.id}`

export const toNodes = (rows: readonly BinnacleTabRow[], prefix: string): TreeNode[] =>
  rows.map((r, i) => {
    const key = `${prefix}/${i}`
    const text = r.text ?? ''
    return {
      key, text, color: r.color, dim: r.dim, bold: r.bold,
      // With cols the text is the body, cut first; the cells are right-aligned across the level (layoutRows).
      ...(r.cols?.length ? { row: { lead: [], body: text, bodyColor: r.color, nums: r.cols } } : {}),
      ...(r.id !== undefined || r.buttons?.length ? { ext: { id: r.id, press: r.press === true, buttons: r.buttons ?? [] } } : {}),
      children: r.children?.length ? toNodes(r.children, key) : undefined,
    }
  })


/** Another plugin's text in at most `max` columns, one line, control characters visible, `…` where cut. */
const fitted = (t: unknown, max: number): string => cutEnd(visible(oneLine(t)), max)

const colorOf = (c: unknown): string | undefined => (typeof c === 'string' && COLOR.test(c) ? c : undefined)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Replaces the plugin's item with this id (in its place), adds it, or, `item` null, removes it; at most `max` per plugin. */
function upsert<T extends { plugin: string; id: string }>(list: readonly T[], plugin: string, id: string, item: T | null, max: number, what: string): ExtResult<T> {
  const rest = list.filter(x => !(x.plugin === plugin && x.id === id))
  if (item === null) return { ok: true, list: rest }
  const at = list.findIndex(x => x.plugin === plugin && x.id === id)
  if (at < 0 && rest.filter(x => x.plugin === plugin).length >= max) {
    return { ok: false, reason: `binnacle: ${plugin} already has ${max} ${what}; remove one first.` }
  }
  return { ok: true, list: at >= 0 ? list.map((x, i) => (i === at ? item : x)) : placed(rest, item) }
}

/** Spans as binnacle draws them: whitespace runs as one space, control characters visible, at most `max` characters in all. */
export function cleanSpans(raw: unknown, max: number): BinnacleSpan[] {
  if (!Array.isArray(raw)) return []
  const out: BinnacleSpan[] = []
  let left = max
  for (const s of raw) {
    if (left <= 0 || !isObject(s)) continue
    const text = clip(visible(String(s.text ?? '').replace(/\s+/g, ' ')), left)
    if (text === '') continue
    left -= text.length
    const color = colorOf(s.color)
    out.push({ text, ...(color ? { color } : {}), ...(s.dim === true ? { dim: true } : {}), ...(s.bold === true ? { bold: true } : {}) })
  }
  return out
}

export function setButton(list: readonly BinnacleButton[], plugin: string, args: { id: unknown; label: unknown; color?: unknown }): ExtResult<BinnacleButton> {
  const id = asId(args.id)
  const label = fitted(args.label, BUTTON_COLS)
  const color = colorOf(args.color)
  return upsert(list, plugin, id, label === '' ? null : { plugin, id, label, ...(color ? { color } : {}) }, MAX_BUTTONS, 'buttons')
}

const priorityOf = (p: unknown): number => (typeof p === 'number' && Number.isFinite(p) ? Math.min(9, Math.max(0, Math.round(p))) : 5)

export function setSegment(list: readonly BinnacleSegment[], plugin: string, args: { id: unknown; text: unknown; color?: unknown; priority?: unknown; press?: unknown }): ExtResult<BinnacleSegment> {
  const id = asId(args.id)
  const text = fitted(args.text, SEGMENT_COLS)
  const color = colorOf(args.color)
  const item = text === '' ? null : { plugin, id, text, ...(color ? { color } : {}), priority: priorityOf(args.priority), press: args.press === true }
  return upsert(list, plugin, id, item, MAX_SEGMENTS, 'status segments')
}

export function setLine(list: readonly BinnacleLine[], plugin: string, args: { id: unknown; forms: unknown; press?: unknown }): ExtResult<BinnacleLine> {
  const id = asId(args.id)
  const forms = (Array.isArray(args.forms) ? args.forms : []).map(f => cleanSpans(f, FORM_CHARS)).filter(f => f.length > 0).slice(0, MAX_FORMS)
  return upsert(list, plugin, id, forms.length === 0 ? null : { plugin, id, forms, press: args.press === true }, MAX_LINES, 'lines')
}

export function setSetting(list: readonly BinnacleSettingItem[], plugin: string, args: { id: unknown; title: unknown; default: unknown }): ExtResult<BinnacleSettingItem> {
  const id = asId(args.id)
  const title = fitted(args.title, SETTING_COLS)
  return upsert(list, plugin, id, title === '' ? null : { plugin, id, title, def: args.default === true }, MAX_SETTINGS, 'settings')
}

export function setGuardSource(list: readonly BinnacleGuardSource[], plugin: string, args: { prefix: unknown; source: unknown }): ExtResult<BinnacleGuardSource> {
  const prefix = visible(String(args.prefix ?? '').replace(/[\t\n\r]/g, ' '))
  const source = fitted(args.source, 40)
  if (prefix.length < 3 || prefix.length > 40) return { ok: false, reason: 'binnacle: a guard source prefix is 3 to 40 characters.' }
  if (/^binnacle/i.test(prefix)) return { ok: false, reason: 'binnacle: a guard source prefix may not start with "binnacle".' }
  if (source === '') return { ok: false, reason: 'binnacle: a guard source needs a source name.' }
  const owner = list.find(g => g.prefix === prefix)
  if (owner && owner.plugin !== plugin) return { ok: false, reason: `binnacle: the prefix "${prefix}" is ${owner.plugin}'s.` }
  return upsert(list, plugin, prefix, { plugin, id: prefix, prefix, source }, MAX_GUARD_SOURCES, 'guard sources')
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A denial an external guard gave (`<prefix><rule> · …`; only the host's `<Event>:<Tool> hook error: ` may stand
 * before it, so guard text quoted mid-output is not one): its source, its rule, and the reason from the prefix on,
 * masked, at most 120 characters. Null for anything else.
 */
export function guardSourceOf(sources: readonly BinnacleGuardSource[], text: string | undefined): { source: string; ruleId: string; reason: string } | null {
  if (text === undefined) return null
  for (const g of sources) {
    const m = new RegExp(`^(?:[A-Za-z][\\w-]*:[\\w-]+ hook error: )?(${escapeRe(g.prefix)}([a-z][a-z-]*) · .*)$`, 's').exec(text)
    if (m) return { source: g.source, ruleId: m[2] as string, reason: brief(m[1] as string) }
  }
  return null
}

/** A plugin line in `width` columns: the first form that fits, else the last one cut. */
export function pickForm(forms: readonly BinnacleSpan[][], width: number): BinnacleSpan[] {
  for (const f of forms) if (widthOf(f) <= width) return [...f]
  return cutSpans(forms[forms.length - 1] ?? [], width)
}

/** The plugins' status segments as one group, shortened before binnacle's own (priority 6): the lowest `priority` goes first, then the rest. */
export function segmentGroup(segments: readonly BinnacleSegment[]): Group | null {
  if (segments.length === 0) return null
  const kept = [...segments].sort((a, b) => b.priority - a.priority)
  const form = (n: number): StatusSpan[] => kept.slice(0, n).flatMap((s, i): StatusSpan[] => [
    ...(i > 0 ? [{ text: ' · ', dim: true }] : []),
    { text: s.text, ...(s.color ? { color: s.color } : {}), ...(s.press ? { ext: { plugin: s.plugin, id: s.id } } : {}) },
  ])
  const forms: StatusSpan[][] = []
  for (let n = kept.length; n >= 1; n--) forms.push(form(n))
  forms.push([])
  return { id: 'plugins', priority: 6, forms }
}

/** What other plugins registered with binnacle, held for the process (spec §4.1). */
export type Registry = {
  attention: BinnacleAttentionItem[]
  tabs: BinnacleExtTab[]
  buttons: BinnacleButton[]
  segments: BinnacleSegment[]
  lines: BinnacleLine[]
  settings: BinnacleSettingItem[]
  guards: BinnacleGuardSource[]
}

export const emptyRegistry = (): Registry => ({ attention: [], tabs: [], buttons: [], segments: [], lines: [], settings: [], guards: [] })

/** Every plugin that registered something the person can turn off, by name (as everything they add is ordered). */
export const pluginsIn = (r: Registry): string[] =>
  [...new Set([...r.attention, ...r.tabs, ...r.buttons, ...r.segments, ...r.lines, ...r.settings].map(x => x.plugin))].sort()

/**
 * A plugin tab's rows laid out in `width` columns: the rows of one level with the same number of cells line up
 * (spec §4.4), so a long cell in one section does not push every other section's cells out of the line.
 */
export function layoutTab(rows: readonly FlatRow[], width: number): Span[][] {
  const out: Span[][] = rows.map(() => [])
  const groups = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const group = `${r.key.slice(0, r.key.lastIndexOf('/'))}|${r.row?.nums?.length ?? 0}`
    groups.set(group, [...(groups.get(group) ?? []), i])
  })
  for (const at of groups.values()) {
    const laid = layoutRows(at.map(i => treeRow(rows[i] as FlatRow)), width)
    at.forEach((i, k) => { out[i] = laid[k] ?? [] })
  }
  return out
}
