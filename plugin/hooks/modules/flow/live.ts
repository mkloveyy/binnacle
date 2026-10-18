import type { BinnacleActivityOutcome } from '../../../types'
import { askOutcome } from '../activity/events.ts'
import { elapsed } from '../../core/format.ts'

export type CallOutcome = 'running' | 'ok' | 'error' | 'denied'
/** One tool call as the Flow tab shows it: held in memory only, never saved (spec §3.1). */
export type LiveCall = { id: string; agentId: string | null; tool: string; summary: string; startedAt: number; endedAt: number | null; outcome: CallOutcome; error?: string }
/** This turn's permission decisions by who made them (spec §3.2). `allowAuto` is the mode or the classifier: live, they look alike. */
export type Tally = {
  allowRules: number; allowHook: number; allowAuto: number
  askApproved: number; askDeniedYou: number; askDeniedAuto: number; askDeniedHook: number
  denyRules: number; denyHook: number; denyAuto: number; denyGuard: number
}
export type Live = { calls: LiveCall[]; tally: Tally }
export type Anomaly = { agentId: string | null; text: string }

/** Calls kept per agent (main is `null`) and in all. */
export const PER_AGENT = 20
export const ALL = 50
/** A running agent with no call running and nothing for this long is flagged. */
export const QUIET_MS = 120_000

export const EMPTY_TALLY: Tally = { allowRules: 0, allowHook: 0, allowAuto: 0, askApproved: 0, askDeniedYou: 0, askDeniedAuto: 0, askDeniedHook: 0, denyRules: 0, denyHook: 0, denyAuto: 0, denyGuard: 0 }
export const emptyLive = (): Live => ({ calls: [], tally: EMPTY_TALLY })

/**
 * A turn the person (or a /loop) started: what the Flow tab shows starts over, but for the calls of agents still
 * running (`keep`): a background agent carries on into the new turn, and dropping its calls would call it quiet.
 */
export const newTurn = (l: Live, keep: ReadonlySet<string> = new Set()): Live =>
  ({ calls: l.calls.filter(c => c.agentId !== null && keep.has(c.agentId)), tally: EMPTY_TALLY })

/** The newest ALL calls, and of each agent the newest PER_AGENT, in the order they started. */
function keep(calls: readonly LiveCall[]): LiveCall[] {
  const per = new Map<string, number>()
  const out: LiveCall[] = []
  for (let i = calls.length - 1; i >= 0 && out.length < ALL; i--) {
    const c = calls[i] as LiveCall
    const k = c.agentId ?? ''
    const n = per.get(k) ?? 0
    if (n >= PER_AGENT) continue
    per.set(k, n + 1)
    out.push(c)
  }
  return out.reverse()
}

/** A call's summary without the tool's name it starts with (the guard's summary is `Read /path`): Flow draws the name beside it. */
export const callSummary = (tool: string, summary: string): string =>
  summary === tool ? '' : summary.startsWith(`${tool} `) ? summary.slice(tool.length + 1) : summary

export const callStarted = (l: Live, c: { id: string; agentId: string | null; tool: string; summary: string; startedAt: number }): Live =>
  ({ ...l, calls: keep([...l.calls.filter(x => x.id !== c.id), { ...c, endedAt: null, outcome: 'running' }]) })

export const callEnded = (l: Live, id: string, at: number, outcome: Exclude<CallOutcome, 'running'>, error?: string): Live =>
  ({ ...l, calls: l.calls.map(c => (c.id === id ? { ...c, endedAt: at, outcome, ...(error !== undefined ? { error } : {}) } : c)) })

/** How a call ended: a hook's refusal, or an asked call refused in its dialog, is denied; any other failure an error. */
export function outcomeOf(r: { deny?: string; isError?: true; text?: string }, asked: boolean): Exclude<CallOutcome, 'running'> {
  if (r.deny !== undefined) return 'denied'
  if (r.isError !== true) return 'ok'
  return asked && askOutcome(r).startsWith('denied') ? 'denied' : 'error'
}

const add = (l: Live, key: keyof Tally): Live => ({ ...l, tally: { ...l.tally, [key]: l.tally[key] + 1 } })

/** A permission check: an allow or a deny counts now, by who decided; an ask counts when its call ends (tallyAsk). */
export function tallyCheck(l: Live, decision: 'allow' | 'ask' | 'deny', by: 'rule' | 'hook' | 'other', guard: boolean): Live {
  if (decision === 'allow') return add(l, by === 'rule' ? 'allowRules' : by === 'hook' ? 'allowHook' : 'allowAuto')
  // A deny with neither a rule nor a hook behind it is the permission mode's.
  if (decision === 'deny') return add(l, guard ? 'denyGuard' : by === 'hook' ? 'denyHook' : by === 'rule' ? 'denyRules' : 'denyAuto')
  return l
}

export function tallyAsk(l: Live, outcome: BinnacleActivityOutcome): Live {
  if (outcome === 'approved') return add(l, 'askApproved')
  if (outcome === 'denied-by-user') return add(l, 'askDeniedYou')
  if (outcome === 'denied-by-classifier') return add(l, 'askDeniedAuto')
  if (outcome === 'denied-by-hook') return add(l, 'askDeniedHook')
  // `unknown`: the call failed for another reason after it was let through, so the ask was approved.
  return add(l, 'askApproved')
}

/** A loop ended (main's turn, or an agent): its calls still running were cut off. No error text, so never "the same error". */
export const endRunning = (l: Live, agentId: string | null, at: number): Live =>
  ({ ...l, calls: l.calls.map(c => (c.agentId === agentId && c.outcome === 'running' ? { ...c, endedAt: at, outcome: 'error' } : c)) })

/** binnacle's own guard refused a call in tool.call, with no check behind it. */
export const tallyGuard = (l: Live): Live => add(l, 'denyGuard')

/** One agent's newest `n` calls, newest first. */
export const callsOf = (l: Live, agentId: string | null, n: number): LiveCall[] =>
  l.calls.filter(c => c.agentId === agentId).slice(-n).reverse()

/** What looks wrong right now (spec §5), main's first, then the agents' in the order their calls came. */
export function anomalies(l: Live, running: readonly { agentId: string; at: number }[], now: number, contextPercent: number | null): Anomaly[] {
  const out: Anomaly[] = []
  const agents = [...new Set([null, ...l.calls.map(c => c.agentId)])]
  for (const agentId of agents) {
    const own = l.calls.filter(c => c.agentId === agentId)
    const errors = new Map<string, number>()
    for (const c of own) if (c.outcome === 'error' && c.error !== undefined) errors.set(`${c.tool}\u0000${c.error}`, (errors.get(`${c.tool}\u0000${c.error}`) ?? 0) + 1)
    for (const [key, n] of errors) if (n >= 2) out.push({ agentId, text: `same error ×${n} · ${key.split('\u0000')[1]}` })
    const ended = own.filter(c => c.outcome !== 'running')
    if (ended.length >= 2 && ended.slice(-2).every(c => c.outcome === 'denied')) out.push({ agentId, text: 'denied ×2 in a row' })
  }
  for (const a of running) {
    const own = l.calls.filter(c => c.agentId === a.agentId)
    if (own.some(c => c.outcome === 'running')) continue
    const last = Math.max(a.at, ...own.map(c => c.endedAt ?? c.startedAt))
    if (now - last >= QUIET_MS) out.push({ agentId: a.agentId, text: `quiet ${elapsed(now - last)}` })
  }
  if (contextPercent !== null && contextPercent >= 80) out.push({ agentId: null, text: `context ${Math.round(contextPercent)}% · compaction near` })
  return out
}
