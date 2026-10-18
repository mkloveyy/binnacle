import type { BinnacleBreakdown, BinnacleCategory } from '../../../types'
import { tokens } from '../../core/format.ts'
import type { Span } from './segments.ts'

export const PALETTE: readonly string[] = ['#7aa2f7', '#7dcfff', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64']
export const MESSAGES_COLOR = '#d97757'
export const FREE_COLOR = 'gray'

/** One colour per category, as the /binnacle overview draws them: messages orange, free and buffer gray, the rest in palette order. */
export function categoryColors(cats: BinnacleCategory[]): string[] {
  let i = 0
  return cats.map(c => (c.kind !== 'used' ? FREE_COLOR : c.name === 'messages' ? MESSAGES_COLOR : PALETTE[i++ % PALETTE.length] ?? FREE_COLOR))
}

/** The status line's ctx bar split by category: as many filled cells as v0.1's bar, shared out by largest remainder. */
export function ctxBar(percent: number, b: BinnacleBreakdown, width: number, empty: string): Span[] | null {
  const colors = categoryColors(b.categories)
  const used = b.categories.map((c, i) => ({ c, color: colors[i] ?? FREE_COLOR })).filter(x => x.c.kind === 'used')
  const total = used.reduce((n, x) => n + x.c.tokens, 0)
  if (used.length === 0 || total <= 0) return null
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  const exact = used.map(x => (x.c.tokens / total) * filled)
  const cells = exact.map(v => Math.floor(v))
  let left = filled - cells.reduce((a, n) => a + n, 0)
  for (const { i } of exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((x, y) => y.r - x.r)) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left--
  }
  const spans: Span[] = used.map((x, i) => ({ text: '█'.repeat(cells[i] ?? 0), color: x.color })).filter(sp => sp.text !== '')
  if (width > filled) spans.push({ text: '░'.repeat(width - filled), color: empty })
  return spans
}

/** The largest used category and its share of used tokens: `msgs 62%`. */
export function topCategory(b: BinnacleBreakdown): string | null {
  const used = b.categories.filter(c => c.kind === 'used')
  const total = used.reduce((n, c) => n + c.tokens, 0)
  const top = [...used].sort((x, y) => y.tokens - x.tokens)[0]
  if (!top || total <= 0) return null
  const name = top.name === 'messages' ? 'msgs' : (top.name.split(' ')[0] ?? top.name).slice(0, 10)
  return `${name} ${Math.round((top.tokens / total) * 100)}%`
}

export type OverviewCell = { name: string; tokens: number; kind: BinnacleCategory['kind']; color: string; glyph: string; n: number; share: string }

/** The /binnacle overview bar: every category's cells, summing to exactly `width` (a used one keeps at least one). */
export function overviewCells(b: BinnacleBreakdown, width: number): OverviewCell[] {
  const total = b.categories.reduce((a, c) => a + c.tokens, 0)
  if (total <= 0) return []
  const colors = categoryColors(b.categories)
  const exact = b.categories.map(c => (c.tokens / total) * width)
  const n = exact.map((v, i) => Math.max(b.categories[i]?.kind === 'used' && v > 0 ? 1 : 0, Math.floor(v)))
  let left = width - n.reduce((a, x) => a + x, 0)
  const byRemainder = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((x, y) => y.r - x.r)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    n[i] = (n[i] ?? 0) + 1
    left--
  }
  while (left < 0) {
    // The one-cell minimums overshot: take back from the widest.
    const widest = n.indexOf(Math.max(...n))
    n[widest] = (n[widest] ?? 0) - 1
    left++
  }
  return b.categories.map((c, i) => {
    const pct = Math.round((c.tokens / b.window) * 100)
    return {
      name: c.name, tokens: c.tokens, kind: c.kind, color: colors[i] ?? FREE_COLOR,
      glyph: c.kind === 'free' ? '─' : c.kind === 'buffer' ? '░' : '█',
      n: n[i] ?? 0,
      share: c.tokens > 0 && pct === 0 ? '<1%' : `${pct}%`,
    }
  })
}

export const LEGEND_GAP = '   '

/** The overview legend: aligned `name tokens share` entries, in two columns (filled column by column) when they fit `width`. */
export function legendRows(cells: OverviewCell[], width: number): { glyph: string; color: string; text: string }[][] {
  const nameW = Math.max(0, ...cells.map(c => c.name.length))
  const tokW = Math.max(0, ...cells.map(c => tokens(c.tokens).length))
  const shareW = Math.max(0, ...cells.map(c => c.share.length))
  const entries = cells.map(c => ({ glyph: c.glyph, color: c.color, text: `${c.name.padEnd(nameW)} ${tokens(c.tokens).padStart(tokW)}  ${c.share.padStart(shareW)}` }))
  const entryW = 2 + nameW + 1 + tokW + 2 + shareW
  if (entries.length < 2 || entryW * 2 + LEGEND_GAP.length > width) return entries.map(e => [e])
  const half = Math.ceil(entries.length / 2)
  return entries.slice(0, half).map((e, i) => {
    const right = entries[half + i]
    return right ? [e, right] : [e]
  })
}
