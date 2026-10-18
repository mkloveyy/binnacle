import type { BinnacleBreakdown, BinnacleLimit, BinnacleSettings, BinnacleSnapshot } from '../../../types'
import { barParts, countdown, duration, effortLabel, modelLabel, money, shortenPath, tokens } from '../../core/format.ts'
import { ctxBar, topCategory } from './palette.ts'
import { SYM } from '../ui/theme.ts'

/** `press`: the part is drawn as a plain button that opens that picker (switcher.ts). */
export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean; press?: 'model' | 'effort'; ext?: { plugin: string; id: string } }
export type Group = { id: 'model' | 'context' | 'limits' | 'time' | 'cwd' | 'plugins'; priority: number; forms: Span[][] }

export const COLOR = { model: 'green', effort: 'magenta', info: 'blue', time: 'yellow', cost: 'green', warn: 'yellow', alert: 'red' } as const

const MID: Span = { text: ' · ', dim: true }
/** A bar's empty cells (§4.2: structure is `subtle`). */
const EMPTY = 'subtle'

export const toneColor = (percent: number | null, base: string): string =>
  percent === null ? base : percent >= 90 ? COLOR.alert : percent >= 80 ? COLOR.warn : base

/** The 5h / 7d limits in four bands of the used percent (user, 2026-10-12): under 50 `success`, 50–79 `suggestion`, 80–89 `warning`, 90 and up `error`. */
export const limitColor = (percent: number): string =>
  percent >= 90 ? 'error' : percent >= 80 ? 'warning' : percent >= 50 ? 'suggestion' : 'success'

/** `compactions`: this session's count, drawn as `⇣N` after the context figures (§5.4). */
export type GroupOptions = { compactions?: number }

export function buildGroups(s: BinnacleSnapshot, settings: BinnacleSettings, now: number, b: BinnacleBreakdown | null = null, opts: GroupOptions = {}): Group[] {
  const st = settings.status
  const groups: Group[] = []

  if (st.model || st.effort) {
    const full: Span[] = []
    const short: Span[] = []
    if (st.model) {
      const m = modelLabel(s.model)
      full.push({ text: m, color: COLOR.model, press: 'model' })
      short.push({ text: m.split(' ')[0], color: COLOR.model, press: 'model' })
    }
    // Unknown until the first request reports it (no API gives it before): left out, Claude Code shows its own above.
    if (st.effort && s.effort !== null && s.effort !== '') {
      if (full.length) { full.push(MID); short.push(MID) }
      full.push({ text: effortLabel(s.effort), color: COLOR.effort, press: 'effort' })
      short.push({ text: effortLabel(s.effort, true), color: COLOR.effort, press: 'effort' })
    }
    if (full.length) groups.push({ id: 'model', priority: 3, forms: [full, short] })
  }

  if (st.context) {
    // Before the first request reports the context, the breakdown's total stands in: what /context counts already.
    const ctxTokens = s.contextTokens ?? b?.total ?? null
    const p = s.contextPercent ?? (s.contextTokens === null && b && b.window > 0 ? (b.total / b.window) * 100 : null)
    const color = toneColor(p, COLOR.info)
    const pct = p === null ? '—' : `${Math.round(p)}%`
    const used = ctxTokens === null ? '—' : tokens(ctxTokens)
    const tail = ` ${used}/${tokens(s.contextWindow)} ${pct}`
    // Empty cells are structure, not state: `subtle` (§4.2).
    const cells = b ? ctxBar(p ?? 0, b, 7, EMPTY) : null
    const [filled, empty] = barParts(p ?? 0, 7)
    const withBar: Span[] = cells
      ? [{ text: 'ctx ', color }, ...cells, { text: tail, color }]
      : [{ text: `ctx ${filled}`, color }, ...(empty ? [{ text: empty, color: EMPTY }] : []), { text: tail, color }]
    const top = b ? topCategory(b) : null
    // The compaction count in every form but the narrowest, none at 0 (§5.4; user, 2026-10-13).
    const count = opts.compactions ?? 0
    const mark: Span[] = count > 0 ? [{ text: ` ${SYM.compact}${count}`, color: 'inactive' }] : []
    const widest: Span[] = [...withBar, ...mark, ...(top ? [{ text: ` · ${top}`, dim: true }] : [])]
    groups.push({
      id: 'context', priority: 1,
      forms: [
        ...(top ? [widest] : []),
        [...withBar, ...mark],
        [{ text: `ctx ${used} ${pct}`, color }, ...mark],
        [{ text: `ctx ${pct}`, color }],
      ],
    })
  }

  if (st.limits) {
    const shown: [string, BinnacleLimit][] = []
    const five = s.limits.find(l => l.kind === 'five_hour')
    const seven = s.limits.find(l => l.kind === 'seven_day')
    if (five) shown.push(['5h', five])
    if (seven) shown.push(['7d', seven])
    if (shown.length) {
      const make = (withBar: boolean): Span[] =>
        shown.flatMap(([label, l], i) => {
          const reset = l.resetsAt !== null ? ` ↻${countdown(l.resetsAt - now)}` : ''
          const color = limitColor(l.percent)
          const [filled, empty] = barParts(l.percent, 3)
          const spans: Span[] = withBar
            ? [{ text: `${label} ${filled}`, color }, ...(empty ? [{ text: empty, color: EMPTY }] : []), { text: ` ${Math.round(l.percent)}%${reset}`, color }]
            : [{ text: `${label} ${Math.round(l.percent)}%${reset}`, color }]
          return i > 0 ? [MID, ...spans] : spans
        })
      const worst = Math.max(...shown.map(([, l]) => l.percent))
      const minimal: Span[] = [{ text: shown.map(([, l]) => `${Math.round(l.percent)}%`).join('/'), color: limitColor(worst) }]
      groups.push({ id: 'limits', priority: 2, forms: [make(true), make(false), minimal] })
    }
  }

  if (st.duration || (st.cost && s.costUsd !== null)) {
    const full: Span[] = []
    const short: Span[] = []
    if (st.duration) full.push({ text: duration(now - s.startedAt), color: COLOR.time })
    if (st.cost && s.costUsd !== null) {
      if (full.length) full.push(MID)
      const delta = s.turnCostUsd !== null && s.turnCostUsd > 0 ? ` (+${s.turnCostUsd.toFixed(2)})` : ''
      full.push({ text: money(s.costUsd) + delta, color: COLOR.cost })
      short.push({ text: money(s.costUsd), color: COLOR.cost })
    }
    groups.push({ id: 'time', priority: 4, forms: [full, short.length ? short : full] })
  }

  if (st.cwd) {
    const base = s.cwd === s.home ? '~' : s.cwd.split('/').filter(Boolean).pop() ?? s.cwd
    groups.push({ id: 'cwd', priority: 5, forms: [[{ text: shortenPath(s.cwd, s.home, 40), dim: true }], [{ text: base, dim: true }], []] })
  }


  return groups
}
