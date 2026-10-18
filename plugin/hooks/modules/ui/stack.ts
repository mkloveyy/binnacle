import type { Span } from './cols.ts'

/** One part of a whole: a name, its count, its colour. */
export type Part = { name: string; n: number; color: string }

const share = (n: number, total: number): string => {
  const p = Math.round((n / total) * 100)
  return n > 0 && p === 0 ? '<1%' : `${p}%`
}

/**
 * One bar `width` cells wide split by share, as the Overview's Context bar is: parts that did not happen are left out,
 * one that did keeps at least a cell, the rest go by largest remainder. Empty when nothing happened.
 */
export function stackBar(parts: readonly Part[], width: number): Span[] {
  const live = parts.filter(p => p.n > 0)
  const total = live.reduce((a, p) => a + p.n, 0)
  if (total <= 0 || width <= 0) return []
  const exact = live.map(p => (p.n / total) * width)
  const cells = exact.map(v => Math.max(1, Math.floor(v)))
  let left = width - cells.reduce((a, n) => a + n, 0)
  for (const { i } of exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((x, y) => y.r - x.r)) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left--
  }
  while (left < 0) {
    // The one-cell minimums overshot: take back from the widest.
    const widest = cells.indexOf(Math.max(...cells))
    cells[widest] = (cells[widest] ?? 0) - 1
    left++
  }
  return live.map((p, i) => ({ text: '█'.repeat(cells[i] ?? 0), color: p.color })).filter(s => s.text !== '')
}

const GAP = '   '

/** The legend under a stacked bar: `█ name  count  share`, aligned per column, in two columns when they fit `width`. */
export function stackLegend(parts: readonly Part[], width: number): Span[][] {
  const live = parts.filter(p => p.n > 0)
  const total = live.reduce((a, p) => a + p.n, 0)
  if (total <= 0) return []
  const column = (list: readonly Part[]): Span[][] => {
    const nameW = Math.max(...list.map(p => p.name.length))
    const countW = Math.max(...list.map(p => String(p.n).length))
    return list.map(p => [{ text: '█', color: p.color }, { text: ` ${p.name.padEnd(nameW)}  ${String(p.n).padStart(countW)}  ${share(p.n, total).padStart(4)}`, dim: true }])
  }
  const one = column(live)
  const half = Math.ceil(live.length / 2)
  if (live.length < 2) return one
  const left = column(live.slice(0, half))
  const right = column(live.slice(half))
  const leftW = Math.max(...left.map(l => l.reduce((a, s) => a + s.text.length, 0)))
  const rightW = Math.max(...right.map(l => l.reduce((a, s) => a + s.text.length, 0)))
  if (leftW + GAP.length + rightW > width) return one
  return left.map((l, i) => {
    const r = right[i]
    return r ? [...l, { text: GAP }, ...r] : l
  })
}
