import type { BinnacleActivityDecider, BinnacleActivityEvent, BinnacleActivityOutcome, BinnacleActivitySession, BinnacleTurnVia } from '../../../types'
import { categoryOf } from '../guard/stats.ts'
import { brief, clip, mask, visible } from './mask.ts'

type Session = BinnacleActivitySession

export const newSession = (sessionId: string, startedAt: number, cwd: string): Session =>
  ({ version: 1, sessionId, startedAt, endedAt: null, cwd, firstPrompt: '', events: [], counts: [] })

export function append(s: Session, ev: BinnacleActivityEvent): Session {
  // A hand-back turn Claude Code starts itself is not what the session was about: only a turn the person started names it.
  const firstPrompt = s.firstPrompt === '' && ev.kind === 'turn-start' && ev.auto !== true ? ev.prompt : s.firstPrompt
  return { ...s, firstPrompt, events: [...s.events, ev] }
}

/** Counts one call that ended without error under its turn × agent row. */
export function bump(s: Session, turnId: string, agentId: string | null, tool: string): Session {
  const c = categoryOf(tool)
  const i = s.counts.findIndex(x => x.turnId === turnId && x.agentId === agentId)
  const row = s.counts[i] ?? { turnId, agentId, files: 0, shell: 0, other: 0 }
  const next = { ...row, [c]: row[c] + 1 }
  return { ...s, counts: i >= 0 ? s.counts.map((x, j) => (j === i ? next : x)) : [...s.counts, next] }
}

export function currentTurn(s: Session): string {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const ev = s.events[i]
    if (ev?.kind === 'turn-start') return ev.turnId
  }
  return ''
}

export function agentTurn(s: Session, agentId: string): string | null {
  const ev = s.events.find(x => x.kind === 'agent-start' && x.agentId === agentId)
  return ev ? ev.turnId : null
}

/** Where a call belongs: its agent's spawning turn, or the current main turn (also for loops no agent-start names, such as compaction forks). */
export function attribute(s: Session, agentId: string | undefined): { turnId: string; agentId: string | null } {
  if (agentId !== undefined) {
    const t = agentTurn(s, agentId)
    if (t !== null) return { turnId: t, agentId }
  }
  return { turnId: currentTurn(s), agentId: null }
}

/**
 * Prompt origins that are a person's own message. Any other starts a turn the person did not: 2.1.296 hands a
 * background agent's report back as a turn of its own, origin `task-notification` (probe 2026-10-12) or, for an
 * `<agent-message …>` hand-back, `peer` (the e2e session's transcript).
 */
const PERSON = new Set(['composer', 'bridge', 'sdk', 'slack-ping', 'auto-continuation'])

/** A plugin's prompt counts as the person's only when it submitted the person's own words (`asUser`, e.g. dictation). */
export const byPerson = (origin: { kind: string; asUser?: true }): boolean => PERSON.has(origin.kind) || (origin.kind === 'plugin' && origin.asUser === true)

/**
 * How a turn the person did not start began (§7.3): a background agent's report handed back (`task-notification`,
 * or a peer message that is an `<agent-message …>` hand-back), a `/loop` or scheduled prompt firing, another
 * session's message, a plugin's prompt, or anything else. Null for the person's own.
 */
export function viaOf(origin: { kind: string; asUser?: true }, text: string): BinnacleTurnVia | null {
  if (byPerson(origin)) return null
  if (origin.kind === 'task-notification') return 'hand-back'
  if (origin.kind === 'peer') return text.startsWith('<agent-message') ? 'hand-back' : 'peer'
  if (origin.kind === 'scheduled-trigger') return 'loop'
  if (origin.kind === 'plugin') return 'plugin'
  return 'other'
}

/** A turn that leaves "this turn" running on: a hand-back (and, in records from before `via`, any turn Claude Code started). */
const passesThrough = (ev: Extract<BinnacleActivityEvent, { kind: 'turn-start' }>): boolean =>
  ev.auto === true && (ev.via === undefined || ev.via === 'hand-back')

/**
 * When "this turn" began for the live rows: the latest turn that is not a hand-back. A `/loop` firing starts a new
 * one, so hours of scheduled turns do not pile their denials and errors up. A record with nothing but hand-backs
 * counts from its newest turn, and one with no turn from 0.
 */
export function personTurnAt(s: Session): number {
  let newest: number | null = null
  for (let i = s.events.length - 1; i >= 0; i--) {
    const ev = s.events[i]
    if (ev?.kind !== 'turn-start') continue
    if (!passesThrough(ev)) return ev.at
    newest ??= ev.at
  }
  return newest ?? 0
}

export function turnNumbers(s: Session): Map<string, number> {
  const m = new Map<string, number>()
  for (const ev of s.events) if (ev.kind === 'turn-start' && !m.has(ev.turnId)) m.set(ev.turnId, m.size + 1)
  return m
}

export type CallOutcomeLike = { deny?: string; isError?: true; text?: string }

const BY_CLASSIFIER = 'denied by the Claude Code auto mode classifier'
const BY_PERSON = "The user doesn't want to proceed with this tool use"
/** A subagent's call refused in its dialog (2.1.296, probe 2026-10-12); a PermissionRequest hook's refusal reads as its own message. */
const BY_PERSON_IN_AGENT = 'Permission for this tool use was denied'

/** How an asked call ended, read from its result text: best effort (probe Q4). An approval by you and by the classifier look the same. */
export function askOutcome(r: CallOutcomeLike): BinnacleActivityOutcome {
  if (r.deny !== undefined) return 'denied-by-hook'
  if (r.isError !== true) return 'approved'
  const t = r.text ?? ''
  if (t.includes(BY_CLASSIFIER)) return 'denied-by-classifier'
  if (t.includes(BY_PERSON) || t.startsWith(BY_PERSON_IN_AGENT)) return 'denied-by-user'
  return 'unknown'
}

export const deciderOf = (o: BinnacleActivityOutcome): BinnacleActivityDecider =>
  o === 'denied-by-classifier' ? 'classifier' : o === 'denied-by-user' ? 'user' : o === 'denied-by-hook' ? 'hook' : 'unknown'

/**
 * Whether a guard (binnacle's, or a rule pack's through `binnacle.record`) logged refusing a call with this summary in
 * this turn since `since`, the time of the call's permission check: that row stands for the call.
 */
export const guardRefused = (s: Session, turnId: string, summary: string, since: number): boolean =>
  s.events.some(ev => ev.kind === 'guard' && (ev.action === 'deny' || ev.action === 'ask-deny') && ev.turnId === turnId && ev.summary === summary && ev.at >= since)

export const reportLines = (answer: string): string[] =>
  answer.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5).map(l => clip(visible(mask(l)), 160))

export type UsageLike = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

export function tokensOf(u: UsageLike | undefined): { tokensIn: number | null; tokensOut: number | null } {
  if (!u) return { tokensIn: null, tokensOut: null }
  return { tokensIn: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokensOut: u.output_tokens }
}

export const firstLine = (text: string): string => clip(visible(mask((text.split('\n').find(l => l.trim() !== '') ?? '').trim())), 160)

