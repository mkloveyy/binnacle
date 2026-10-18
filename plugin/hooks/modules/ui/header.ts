import type { BinnacleSnapshot } from '../../../types'
import { effortLabel, modelLabel, money } from '../../core/format.ts'
import { textWidth } from '../../core/width.ts'
import { cutEnd, flat, NARROW, type Span } from './cols.ts'
import { ROLE, SYM } from './theme.ts'

/**
 * The panel's first line (§4.3): `binnacle` in the brand colour, then model · effort · ctx · cost in `inactive`,
 * and this session's sprint right-aligned (`◆ project/sprint`) when one is matched. Cost, then ctx, then effort go
 * first when the line does not fit; below 60 columns only `binnacle` and the sprint stay.
 */
export function titleLine(s: BinnacleSnapshot | null, sprint: string | null, width: number): Span[] {
  const brand: Span = { text: 'binnacle', color: ROLE.brand, bold: true }
  const name = sprint === null ? null : flat(sprint)
  const marker: Span[] = name ? [{ text: `${SYM.current} `, color: ROLE.brand }, { text: name, color: ROLE.text }] : []
  const items: string[] = []
  if (s && width >= NARROW) {
    items.push(flat(modelLabel(s.model)), ...(s.effort ? [flat(effortLabel(s.effort))] : []))
    if (s.contextPercent !== null) items.push(`ctx ${Math.round(s.contextPercent)}%`)
    if (s.costUsd !== null) items.push(`${money(s.costUsd)}${s.turnCostUsd !== null && s.turnCostUsd > 0 ? ` (+${s.turnCostUsd.toFixed(2)})` : ''}`)
  }
  const markerW = marker.reduce((w, x) => w + textWidth(x.text), 0)
  for (let n = items.length; n >= 0; n--) {
    const mid = n > 0 ? `  ${items.slice(0, n).join(' · ')}` : ''
    const used = 8 + textWidth(mid)
    if (used + (markerW ? markerW + 2 : 0) <= width || n === 0) {
      const room = width - used - markerW
      if (markerW === 0) return [brand, ...(mid ? [{ text: mid, color: ROLE.dim }] : [])]
      if (room < 2) return [brand, { text: '  ' }, { text: `${SYM.current} `, color: ROLE.brand }, { text: cutEnd(name ?? '', Math.max(1, width - 12)), color: ROLE.text }]
      return [brand, ...(mid ? [{ text: mid, color: ROLE.dim }] : []), { text: ' '.repeat(room) }, ...marker]
    }
  }
  return [brand]
}
