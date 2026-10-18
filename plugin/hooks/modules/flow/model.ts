import type { BinnacleActivitySession, BinnaclePendingCheck } from '../../../types'
import { personTurnAt, turnNumbers } from '../activity/events.ts'
import { awaitsApproval } from '../activity/derive.ts'
import { anomalies, callsOf, type Anomaly, type Live, type LiveCall, type Tally } from './live.ts'

type Session = BinnacleActivitySession
type Ev = Session['events'][number]
type Of<K extends Ev['kind']> = Extract<Ev, { kind: K }>

export type AgentCard = {
  agentId: string; type: string; task: string; at: number; endedAt: number | null; aborted: boolean; running: boolean
  steps: number; calls: LiveCall[]; children: { type: string; running: boolean; at: number }[]; flags: string[]
}
export type LogLine = { at: number; who: string; mark: 'running' | 'done' | 'failed' | 'spawn' | 'compact'; text: string }
export type FlowView = {
  turn: { n: number; prompt: string; at: number; endedAt: number | null } | null
  mainCalls: LiveCall[]; mainFlags: string[]; agents: AgentCard[]; tally: Tally
  waiting: { tool: string; summary: string; reason?: string; at: number }[]
  anomalies: Anomaly[]; log: LogLine[]
}

/** Calls each card lists, and log lines kept for the widest layout. */
const CARD_CALLS = 3
const LOG_LINES = 5
const MAX_WAITING = 2

/** One pass over the record: this turn, and every agent with its end. */
function scan(s: Session, since: number) {
  const turnAt = personTurnAt(s)
  const ends = new Map<string, Of<'agent-end'>>()
  const endedTurns = new Set<string>()
  const starts: Of<'agent-start'>[] = []
  let turn: Of<'turn-start'> | null = null
  let turnEnd: Of<'turn-end'> | null = null
  const recent: Ev[] = []
  for (const ev of s.events) {
    if (ev.kind === 'agent-end' && ev.agentId !== null) ends.set(ev.agentId, ev)
    if (ev.kind === 'turn-end') endedTurns.add(ev.turnId)
    // An agent team's teammate runs in its own pane and never reports an end: it is not one of main's agents here.
    if (ev.kind === 'agent-start' && ev.agentId !== null && ev.at >= since && ev.teammate !== true) starts.push(ev)
    if (ev.kind === 'turn-start' && ev.at === turnAt && turn === null) turn = ev
    if (ev.at >= turnAt) recent.push(ev)
  }
  if (turn) for (const ev of recent) if (ev.kind === 'turn-end' && ev.turnId === turn.turnId) turnEnd = ev
  // Running: started in this process, no end, and not a foreground agent of an ended turn (cut off, as liveRows).
  const running = (a: Of<'agent-start'>): boolean => !ends.has(a.agentId as string) && !(!a.background && endedTurns.has(a.turnId))
  return { turnAt, turn, turnEnd, ends, starts, running, recent }
}

/** The ids of the agents running now, started in this process. */
export function runningAgentIds(s: Session | null, since: number): Set<string> {
  if (!s) return new Set()
  const { starts, running } = scan(s, since)
  return new Set(starts.filter(running).map(a => a.agentId as string))
}

/** The footer's count: running agents drawn as cards, so not one another agent spawned (its card lists it as `↳`). */
export function runningAgents(s: Session | null, since: number): number {
  if (!s) return 0
  const { starts, running } = scan(s, since)
  const known = new Set(starts.map(a => a.agentId))
  return starts.filter(a => running(a) && (a.parentAgentId === null || !known.has(a.parentAgentId))).length
}

export function flowView(s: Session | null, live: Live, checks: readonly BinnaclePendingCheck[], now: number, since: number, contextPercent: number | null, autoMode = false): FlowView {
  const waiting = checks.filter(c => awaitsApproval(c, now, autoMode)).slice(0, MAX_WAITING)
    .map(c => ({ tool: c.tool, summary: c.summary, ...(c.reason ? { reason: c.reason } : {}), at: c.at }))
  const empty: FlowView = { turn: null, mainCalls: callsOf(live, null, CARD_CALLS), mainFlags: [], agents: [], tally: live.tally, waiting, anomalies: [], log: [] }
  if (!s) return { ...empty, anomalies: anomalies(live, [], now, contextPercent), mainFlags: anomalies(live, [], now, contextPercent).map(a => a.text) }
  const { turnAt, turn, turnEnd, ends, starts, running, recent } = scan(s, since)
  const n = turn ? turnNumbers(s).get(turn.turnId) ?? 0 : 0
  const known = new Set(starts.map(a => a.agentId))
  // Main's own: this turn's top-level agents, and background ones still running from an earlier turn.
  const top = starts.filter(a => (a.parentAgentId === null || !known.has(a.parentAgentId)) && (a.at >= turnAt || running(a)))
  const steps = (agentId: string): number => s.counts.filter(c => c.agentId === agentId).reduce((t, c) => t + c.files + c.shell + c.other, 0)
  const live_ = starts.filter(running).map(a => ({ agentId: a.agentId as string, at: a.at }))
  const found = anomalies(live, live_, now, contextPercent)
  const flagsOf = (agentId: string | null): string[] => found.filter(f => f.agentId === agentId).map(f => f.text)
  const agents: AgentCard[] = top.map(a => {
    const id = a.agentId as string
    const e = ends.get(id)
    return {
      agentId: id, type: a.agentType, task: a.task, at: a.at, endedAt: e?.at ?? null, aborted: e?.aborted ?? false, running: running(a),
      steps: steps(id), calls: callsOf(live, id, CARD_CALLS),
      children: starts.filter(c => c.parentAgentId === id).map(c => ({ type: c.agentType, running: running(c), at: c.at })),
      flags: flagsOf(id),
    }
  })
  const typeOf = new Map(starts.map(a => [a.agentId as string, a.agentType]))
  const who = (agentId: string | null): string => (agentId === null ? 'main' : typeOf.get(agentId) ?? 'agent')
  const log: LogLine[] = [
    ...live.calls.map(c => ({ at: c.startedAt, who: who(c.agentId), mark: c.outcome === 'running' ? 'running' as const : c.outcome === 'ok' ? 'done' as const : 'failed' as const, text: `${c.tool} ${c.summary}` })),
    ...recent.flatMap((ev): LogLine[] => {
      if (ev.kind === 'agent-start' && ev.agentId !== null) return [{ at: ev.at, who: who(ev.parentAgentId), mark: 'spawn', text: `spawned ${ev.agentType}` }]
      if (ev.kind === 'agent-end' && ev.agentId !== null) return [{ at: ev.at, who: who(ev.agentId), mark: ev.aborted ? 'failed' : 'done', text: ev.aborted ? 'aborted' : 'done' }]
      if (ev.kind === 'guard' && (ev.action === 'deny' || ev.action === 'ask-deny')) return [{ at: ev.at, who: 'guard', mark: 'failed', text: `denied ${ev.summary} · ${ev.ruleId}` }]
      if (ev.kind === 'compact') return [{ at: ev.at, who: who(ev.agentId), mark: 'compact', text: `compacted · ${ev.trigger}` }]
      return []
    }),
  ].sort((a, b) => b.at - a.at).slice(0, LOG_LINES)
  return {
    turn: turn ? { n, prompt: turn.prompt, at: turn.at, endedAt: turnEnd?.at ?? null } : null,
    mainCalls: empty.mainCalls, mainFlags: flagsOf(null), agents, tally: live.tally, waiting, anomalies: found, log,
  }
}

/** Something on the Flow tab moves with the clock: a call or an agent running, or an ask waiting. */
export const moving = (v: FlowView): boolean =>
  v.mainCalls.some(c => c.outcome === 'running') || v.agents.some(a => a.running || a.calls.some(c => c.outcome === 'running')) || v.waiting.length > 0
