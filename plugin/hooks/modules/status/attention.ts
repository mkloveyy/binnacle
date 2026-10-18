import type { BinnacleBreakdown, BinnacleSnapshot } from '../../../types'
import { resetLabel, tokens } from '../../core/format.ts'
import { COLOR } from './segments.ts'

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h limit', seven_day: '7d limit', spend_limit: 'spend limit' }

/** One alert, toasted once when it starts (register.tsx); `key` names it so it is not toasted again while it lasts. */
export type Alert = { key: string; text: string; color: string }

/**
 * What needs attention now: a limit at 90% or more, the context at 80% or more (a new key at 90%, so passing it alerts
 * again). Refusals by the guard are not here: `⚑ guard N` at the right of the footer shows them.
 */
export function alerts(s: BinnacleSnapshot | null, b: BinnacleBreakdown | null, now: number): Alert[] {
  const items: Alert[] = []
  if (!s) return items
  for (const l of s.limits) {
    if (l.percent < 90) continue
    const reset = l.resetsAt !== null ? ` · resets ${resetLabel(l.resetsAt, now, l.kind === 'seven_day')}` : ''
    items.push({ key: `limit:${l.kind}`, text: `⚠ ${LIMIT_LABEL[l.kind] ?? l.kind} ${Math.round(l.percent)}%${reset}`, color: COLOR.alert })
  }
  if (s.contextPercent !== null && s.contextPercent >= 80) {
    let t = `⚠ context ${Math.round(s.contextPercent)}%`
    if (b && b.compactAt !== null && s.contextTokens !== null) t += ` · ${tokens(Math.max(0, b.compactAt - s.contextTokens))} to compaction`
    const used = b ? b.categories.filter(c => c.kind === 'used').sort((x, y) => y.tokens - x.tokens) : []
    if (b && used.length && b.total > 0) t += ` (${used[0].name} ${Math.round((used[0].tokens / b.total) * 100)}%)`
    const hot = s.contextPercent >= 90
    items.push({ key: `context:${hot ? 90 : 80}`, text: `${t} → /compact or hand off`, color: hot ? COLOR.alert : COLOR.warn })
  }
  return items
}
