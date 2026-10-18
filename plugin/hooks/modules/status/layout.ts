import { textWidth } from '../../core/width.ts'
import type { Group, Span } from './segments.ts'

export const SEP: Span = { text: ' │ ', dim: true }

export const spansWidth = (spans: Span[]): number => spans.reduce((w, s) => w + textWidth(s.text), 0)

/** Lays the forms out in order, starting a new row when the next one does not fit. */
function wrap(forms: Span[][], width: number): Span[][] {
  const rows: Span[][] = []
  let row: Span[] = []
  for (const form of forms) {
    if (form.length === 0) continue
    const add = row.length ? spansWidth([SEP]) + spansWidth(form) : spansWidth(form)
    if (row.length && spansWidth(row) + add > width) {
      rows.push(row)
      row = []
    }
    row = row.length ? [...row, SEP, ...form] : [...form]
  }
  if (row.length) rows.push(row)
  return rows
}

export const MAX_ROWS = 2

/** Full forms on as many rows as it takes, up to MAX_ROWS; past that, shorten the least important groups first. */
export function fit(groups: Group[], width: number): Span[][] {
  if (groups.length === 0) return []
  const levels = groups.map(() => 0)
  const leastFirst = groups.map((_, i) => i).sort((a, b) => groups[b].priority - groups[a].priority)
  const current = () => groups.map((g, i) => g.forms[levels[i]])
  while (wrap(current(), width).length > MAX_ROWS) {
    const i = leastFirst.find(j => levels[j] < groups[j].forms.length - 1)
    if (i === undefined) break
    levels[i] += 1
  }
  return wrap(current(), width)
}

export function withTail(rows: Span[][], tail: string, width: number): Span[][] {
  if (rows.length === 0 || tail.trim() === '') return rows
  const last = rows[rows.length - 1]
  const extra: Span = { text: '  ' + tail.trim(), dim: true }
  if (spansWidth(last) + spansWidth([extra]) > width) return rows
  return [...rows.slice(0, -1), [...last, extra]]
}
