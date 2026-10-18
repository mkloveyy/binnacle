import type { BinnacleActivitySession, BinnacleGuardEntry, BinnaclePendingCheck, BinnacleTurnReceipt } from '../../../types'
import { elapsed } from '../../core/format.ts'
import { textWidth } from '../../core/width.ts'
import { flat, padEnd, type Row, type Span } from '../ui/cols.ts'
import { ROLE, SYM } from '../ui/theme.ts'
import { personTurnAt } from './events.ts'
import { clip } from './mask.ts'

type Session = BinnacleActivitySession

/** v0.1's guard log, now read from the stream. */
export function guardEntries(s: Session | null, max = 50): BinnacleGuardEntry[] {
  if (!s) return []
  const out: BinnacleGuardEntry[] = []
  for (const ev of s.events) if (ev.kind === 'guard') out.push({ at: ev.at, ruleId: ev.ruleId, action: ev.action, summary: ev.summary })
  return out.slice(-max)
}

/** v0.1's "last turn" receipt, now read from the stream. */
export function lastReceipt(s: Session | null): BinnacleTurnReceipt | null {
  if (!s) return null
  for (let i = s.events.length - 1; i >= 0; i--) {
    const end = s.events[i]
    if (end?.kind !== 'turn-end') continue
    const inTurn = s.events.filter(ev => ev.turnId === end.turnId)
    return {
      durationMs: end.durationMs,
      agents: inTurn.filter(ev => ev.kind === 'agent-start').length,
      edits: inTurn.filter(ev => ev.kind === 'edit').length,
      errors: inTurn.filter(ev => ev.kind === 'error').length,
      costDelta: end.costUsd,
    }
  }
  return null
}

/** `text`/`color`: the row as one line; `row`: how the Agents tab lays it out (§4.8). */
export type LiveRow = { text: string; color: string; row: Row }

/** An ask still open after this long is shown as waiting; the auto-mode classifier usually answers in 1–2 s (probe Q4). */
export const ASK_AFTER_MS = 3_000
/** In auto mode the classifier settles an ask within seconds; one older than this was settled and its call runs. */
export const AUTO_SETTLED_MS = 15_000

/**
 * Whether an ask still waits on a decision. No API says when an ask is settled (the mode settles it after tool.check,
 * inside the call), so in auto mode one past AUTO_SETTLED_MS counts as approved and running (user, 2026-10-15).
 */
export const awaitsApproval = (c: BinnaclePendingCheck, now: number, autoMode: boolean): boolean =>
  c.decision === 'ask' && now - c.at >= ASK_AFTER_MS && !(autoMode && now - c.at >= AUTO_SETTLED_MS)

/**
 * The live rows on top of the Agents tab: running subagents (or the one waiting on an ask), background agents that finished
 * since this turn started, and this turn's denials and errors, where this turn is the latest one the person
 * started. Only agents started at or after `since` (this process) count as running, so a resumed session shows
 * no ghosts.
 */
export function liveRows(s: Session | null, checks: BinnaclePendingCheck[], now: number, since: number, max = 5, autoMode = false): LiveRow[] {
  if (!s) return []
  const ends = new Map<string, number>()
  const endedTurns = new Set<string>()
  // A turn Claude Code starts itself (a background agent's hand-back, ~150 ms after the agent ends) does not clear them.
  const turnAt = personTurnAt(s)
  for (const ev of s.events) {
    if (ev.kind === 'agent-end' && ev.agentId !== null) ends.set(ev.agentId, ev.at)
    if (ev.kind === 'turn-end') endedTurns.add(ev.turnId)
  }
  const steps = (agentId: string): number =>
    s.counts.filter(c => c.agentId === agentId).reduce((n, c) => n + c.files + c.shell + c.other, 0)
  // The type column is as wide as the widest type of this process's agents, in columns (a CJK type counts double).
  const typeW = Math.min(16, s.events.reduce((w, ev) => (ev.kind === 'agent-start' && ev.agentId !== null && ev.at >= since ? Math.max(w, textWidth(flat(ev.agentType))) : w), 0))
  const type = (agentType: string): string => padEnd(flat(agentType), typeW)
  const rows: LiveRow[] = []
  for (const ev of s.events) {
    if (ev.kind !== 'agent-start' || ev.agentId === null || ev.at < since) continue
    const agentId = ev.agentId
    const task = clip(ev.task, 40)
    const end = ends.get(agentId)
    if (end === undefined) {
      // A foreground agent cannot outlive its turn: one with no agent-end of its own was cut off.
      if (!ev.background && endedTurns.has(ev.turnId)) continue
      const ask = checks.find(c => c.agentId === agentId && awaitsApproval(c, now, autoMode))
      rows.push(ask
        ? {
            text: `⏸ ${ev.agentType} · approval? ${clip(ask.summary, 40)} · ${elapsed(now - ask.at)}`, color: 'yellow',
            row: { lead: [{ text: SYM.waiting, color: ROLE.warn }, { text: ` ${type(ev.agentType)}   approval? ` }], body: ask.summary, nums: [[{ text: elapsed(now - ask.at) }], null] },
          }
        : {
            text: `● ${ev.agentType} · ${task} · ${elapsed(now - ev.at)} · ${steps(agentId)} steps`, color: 'blue',
            row: { lead: [{ text: SYM.running, color: ROLE.focus }, { text: ` ${type(ev.agentType)}   ` }], body: ev.task, nums: [[{ text: elapsed(now - ev.at) }], [{ text: `${steps(agentId)} steps`, color: ROLE.dim }]] },
          })
    } else if (ev.background && end >= turnAt) {
      rows.push({
        text: `✓ ${ev.agentType} · ${task} · done ${elapsed(now - end)} ago`, color: 'green',
        row: { lead: [{ text: SYM.done, color: ROLE.ok }, { text: ` ${type(ev.agentType)}   ` }], body: ev.task, nums: [[{ text: `done ${elapsed(now - end)} ago`, color: ROLE.dim }], null] },
      })
    }
  }
  let denied = 0
  let errors = 0
  for (const ev of s.events) {
    if (ev.at < turnAt) continue
    if (ev.kind === 'error') errors++
    else if (ev.kind === 'guard' && (ev.action === 'deny' || ev.action === 'ask-deny')) denied++
    else if (ev.kind === 'perm' && (ev.decision === 'deny' || (ev.outcome ?? '').startsWith('denied'))) denied++
  }
  const parts = [denied ? `${denied} denied` : '', errors ? `${errors} error${errors === 1 ? '' : 's'}` : ''].filter(Boolean)
  const line = (text: string, color: string, role: string): LiveRow => ({ text, color, row: { lead: [{ text, color: role } as Span] } })
  if (parts.length) rows.push(line(`✗ ${parts.join(' · ')} this turn`, 'red', ROLE.bad))
  return rows.length > max ? [...rows.slice(0, max - 1), line(`… and ${rows.length - max + 1} more`, 'gray', ROLE.dim)] : rows
}

/** A live row whose clock moves (running, waiting, `done Ns ago`): only these need the Agents tab redrawn as time passes. */
export const moves = (r: LiveRow): boolean => /^[●⏸✓]/.test(r.text)
