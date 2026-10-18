import { stackBar, stackLegend } from './stack.ts'
import type { BinnacleActivitySession, BinnacleDiffFile, BinnacleGuardAction, BinnaclePermStats, BinnacleSnapshot } from '../../../types'
import { barParts, money, resetLabel } from '../../core/format.ts'
import { textWidth } from '../../core/width.ts'
import { limitColor } from '../status/segments.ts'
import { cutEnd, cutSpans, dated, flat, layoutRows, padEnd, padStart, type Row, type Span, stamp } from './cols.ts'
import { ROLE, SYM } from './theme.ts'

const LIMIT_NAME: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

/** A bar as spans: the filled cells in `color`, the empty ones `subtle` (§4.2); a part with no cells is left out. */
function barSpans(percent: number, width: number, color: string): Span[] {
  const [filled, empty] = barParts(percent, width)
  return [...(filled ? [{ text: filled, color }] : []), ...(empty ? [{ text: empty, color: ROLE.frame }] : [])]
}

/** The Overview card's body (§4.4): cost and this turn, then one bar per limit window, bar and percent in the limit bands. */
/** `compactions`: this session's count (§5.4), its own line when there is one, so Overview shows it without scrolling. */
export function sessionLines(s: BinnacleSnapshot, now: number, compactions = 0): Span[][] {
  const lines: Span[][] = []
  if (s.costUsd !== null) {
    lines.push([
      { text: 'cost    ', color: ROLE.dim }, { text: padEnd(money(s.costUsd), 11) },
      ...(s.turnCostUsd !== null ? [{ text: 'this turn  ', color: ROLE.dim }, { text: `+${money(s.turnCostUsd)}` }] : []),
    ])
  }
  for (const l of s.limits) {
    const color = limitColor(l.percent)
    lines.push([
      { text: padEnd(LIMIT_NAME[l.kind] ?? flat(l.kind), 8), color: ROLE.dim },
      ...barSpans(l.percent, 10, color),
      { text: `  ${padStart(`${Math.round(l.percent)}%`, 4)}`, color },
      ...(l.resetsAt !== null ? [{ text: `   ↻${resetLabel(l.resetsAt, now, l.kind === 'seven_day')}`, color: ROLE.dim }] : []),
    ])
  }
  if (compactions > 0) lines.push([{ text: 'compact ', color: ROLE.dim }, { text: String(compactions) }])
  return lines
}

/** The three permission counts with a bar each, only the bar coloured (§4.5); every count line is `width` wide. */
export function permLines(p: BinnaclePermStats, width: number): Span[][] {
  // The Context block's look: one bar split by share, the legend with counts and shares, then the kinds of tool.
  const parts = [{ name: 'allowed by rules', n: p.allow, color: ROLE.ok }, { name: 'asked', n: p.ask, color: ROLE.ask }, { name: 'denied', n: p.deny, color: ROLE.bad }]
  const bar = stackBar(parts, width - 1)
  return [
    ...(bar.length ? [bar] : []),
    ...stackLegend(parts, width),
    cutSpans([{ text: ` files ${p.files} · shell ${p.shell} · other ${p.other}`, color: ROLE.dim }], width),
  ]
}

export type GuardRecord = { at: number; action: BinnacleGuardAction; source: string; ruleId: string; summary: string; external?: true }

/** The guard's decisions this session and external guards' denials, newest first (§4.5); `sourceOf` names binnacle or the rule pack. */
export function guardRecords(s: BinnacleActivitySession | null, sourceOf: (ruleId: string) => string, max = 10): GuardRecord[] {
  if (!s) return []
  const out: GuardRecord[] = []
  for (const ev of s.events) {
    if (ev.kind === 'guard') out.push({ at: ev.at, action: ev.action, source: sourceOf(ev.ruleId), ruleId: ev.ruleId, summary: ev.summary })
    if (ev.kind === 'perm' && ev.source !== undefined) out.push({ at: ev.at, action: 'deny', source: ev.source, ruleId: ev.ruleId ?? '?', summary: ev.summary, external: true })
  }
  return out.slice(-max).reverse()
}

/**
 * `blocked 3 · asked 1 · auto 2` (and `· rewritten N` when any). Each record counts once: an ask the person refused is
 * blocked, so `asked` is the asks that went ahead.
 */
export function guardSummary(records: readonly GuardRecord[]): string {
  const n = (f: (r: GuardRecord) => boolean): number => records.filter(f).length
  const rewritten = n(r => r.action === 'rewrite')
  return `blocked ${n(r => r.action === 'deny' || r.action === 'ask-deny')} · asked ${n(r => r.action === 'ask-allow')} · auto ${n(r => r.action === 'auto-allow')}${rewritten ? ` · rewritten ${rewritten}` : ''}`
}

/** One row per record: time, symbol and action, source, rule, the command (cut first). A refused row is `error` throughout. */
export function guardLines(records: readonly GuardRecord[], width: number, now: number): Span[][] {
  // Source and rule come from saved records and other plugins: made visible before the columns are measured.
  const shown = records.map(r => ({ ...r, source: flat(r.source), ruleId: flat(r.ruleId) }))
  const srcW = Math.max(0, ...shown.map(r => textWidth(r.source)))
  const ruleW = Math.min(18, Math.max(0, ...shown.map(r => textWidth(r.ruleId))))
  const withDate = dated(records.map(r => r.at), now)
  const rows: Row[] = shown.map(r => {
    const refused = r.action === 'deny' || r.action === 'ask-deny'
    const sym = r.external ? SYM.guard : refused ? SYM.failed : r.action === 'rewrite' ? '↻' : SYM.done
    const color = refused ? ROLE.bad : undefined
    return {
      lead: [
        { text: ` ${stamp(r.at, withDate)}  `, color: color ?? ROLE.dim },
        { text: sym, color: refused ? ROLE.bad : ROLE.ok },
        { text: ` ${padEnd(r.action, 10)} ${padEnd(r.source, srcW)}  ${padEnd(cutEnd(r.ruleId, ruleW), ruleW)}  `, color },
      ],
      body: r.summary, bodyColor: color,
    }
  })
  return layoutRows(rows, width)
}

/**
 * A guard rule's Settings row: `[✓] pack · title`, cut first, the action right-aligned at `width`. The action comes
 * from another plugin too: made visible, and cut to half the width so the row keeps its width and its title.
 */
export function ruleLabel(enabled: boolean, title: string, action: string, width: number): string {
  const act = cutEnd(flat(action), Math.max(1, Math.floor(width / 2)))
  const left = cutEnd(flat(`[${enabled ? '✓' : ' '}] ${title}`), Math.max(8, width - textWidth(act) - 2))
  return padEnd(left, width - textWidth(act)) + act
}

/** A Diff file row (§4.9): the pick mark, the status letter, the path cut in the middle, `+N −N` right-aligned. */
export function diffFileRow(f: BinnacleDiffFile, selected: boolean): Row {
  return {
    lead: [{ text: selected ? `${SYM.closed} ` : '  ', color: ROLE.focus }, { text: `${f.status}  ` }],
    body: f.path,
    cut: 'middle',
    nums: f.status === '?' ? [[{ text: 'untracked', color: ROLE.dim }]] : [f.added > 0 ? [{ text: `+${f.added}`, color: ROLE.added }] : null, f.removed > 0 ? [{ text: `−${f.removed}`, color: ROLE.removed }] : null],
  }
}
