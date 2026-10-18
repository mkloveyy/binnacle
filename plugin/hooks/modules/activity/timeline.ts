import type { BinnacleActivityEvent, BinnacleActivitySession } from '../../../types'
import { elapsed } from '../../core/format.ts'
import { textWidth } from '../../core/width.ts'
import { dated, flat, headFit, padEnd, padStart, stamp, type Span } from '../ui/cols.ts'
import { ROLE, SYM } from '../ui/theme.ts'
import { turnNumbers } from './events.ts'

type Of<K extends BinnacleActivityEvent['kind']> = Extract<BinnacleActivityEvent, { kind: K }>

/** Agents drawn: the newest 8; 4 below 70 columns; none below 60 (§4.8). Design values. */
export const LANES = 8
export const LANES_NARROW = 4

export type Timeline = { summary: string; marks: Span[]; lanes: Span[][]; axis: Span[] }

/**
 * The Agents tab's timeline: one lane per agent over the window the newest agents cover, turn starts marked `#N`
 * above, bars `━` coloured by state (running `suggestion`, done `inactive`, failed or refused `error`), at least one
 * cell, state and duration right-aligned. `now` is the end for running agents; a saved session passes its last event.
 * `today` is the clock: the span's times carry their date when it is not today.
 */
export function timeline(s: BinnacleActivitySession, since: number, now: number, width: number, today = now): Timeline | null {
  if (width < 60) return null
  const starts = s.events.filter((ev): ev is Of<'agent-start'> => ev.kind === 'agent-start' && ev.agentId !== null)
  const shown = starts.slice(-(width < 70 ? LANES_NARROW : LANES))
  if (shown.length === 0) return null
  const ends = new Map<string, Of<'agent-end'>>()
  const endedTurns = new Set<string>()
  const refused = new Set<string>()
  for (const ev of s.events) {
    if (ev.kind === 'agent-end' && ev.agentId !== null) ends.set(ev.agentId, ev)
    if (ev.kind === 'turn-end') endedTurns.add(ev.turnId)
    const bad = ev.kind === 'error' || (ev.kind === 'guard' && (ev.action === 'deny' || ev.action === 'ask-deny'))
      || (ev.kind === 'perm' && (ev.decision === 'deny' || (ev.outcome ?? '').startsWith('denied')))
    if (bad && ev.agentId !== null) refused.add(ev.agentId)
  }
  const lanes = shown.map(a => {
    const id = a.agentId as string
    const end = ends.get(id)
    const running = !end && a.at >= since && !(!a.background && endedTurns.has(a.turnId))
    const stop = end ? end.at : running ? now : a.at
    const state: 'running' | 'done' | 'failed' | 'unfinished' = end ? (end.aborted || refused.has(id) ? 'failed' : 'done') : running ? 'running' : 'unfinished'
    return { a, name: flat(a.agentType), from: a.at, to: Math.max(stop, a.at), state, dur: end ? elapsed(end.durationMs) : running ? elapsed(now - a.at) : '—' }
  })
  // The window opens at the start of the turn the first agent ran in, so its `#N` mark is on the axis.
  const turnStart = new Map<string, number>()
  for (const ev of s.events) if (ev.kind === 'turn-start' && !turnStart.has(ev.turnId)) turnStart.set(ev.turnId, ev.at)
  const t0 = Math.min(...lanes.map(l => Math.min(l.from, turnStart.get(l.a.turnId) ?? l.from)))
  const t1 = Math.max(t0 + 1_000, ...lanes.map(l => l.to))
  // Columns, not characters: a CJK type is twice as wide as its length.
  const nameW = Math.min(10, Math.max(...lanes.map(l => textWidth(l.name))))
  const durW = Math.max(...lanes.map(l => l.dur.length))
  const statusW = 1 + 2 + durW
  const barW = Math.max(10, width - 1 - nameW - 2 - 2 - statusW)
  const col = (t: number): number => Math.min(barW - 1, Math.max(0, Math.floor(((t - t0) / (t1 - t0)) * barW)))
  const lead = ' '.repeat(1 + nameW + 2)
  const marks: string[] = Array.from({ length: barW }, () => ' ')
  const nums = turnNumbers(s)
  for (const ev of s.events) {
    if (ev.kind !== 'turn-start' || ev.at < t0 || ev.at > t1) continue
    const label = `#${nums.get(ev.turnId) ?? 0}`
    const c = col(ev.at)
    if (c + label.length > barW || marks.slice(Math.max(0, c - 1), c + label.length + 1).some(x => x !== ' ')) continue
    for (let i = 0; i < label.length; i++) marks[c + i] = label[i] as string
  }
  const colorOf = { running: ROLE.focus, done: ROLE.dim, failed: ROLE.bad, unfinished: ROLE.dim } as const
  const withDate = dated([t0, t1], today)
  const symOf = { running: SYM.running, done: SYM.done, failed: SYM.failed, unfinished: SYM.todo } as const
  return {
    summary: `${stamp(t0, withDate)} → ${stamp(t1, withDate)}${lanes.some(l => l.state === 'running') ? ' now' : ''}`,
    marks: [{ text: lead + marks.join('').replace(/ +$/, ''), color: ROLE.dim }],
    lanes: lanes.map(l => {
      const a = col(l.from)
      const b = Math.max(a + 1, Math.min(barW, Math.ceil(((l.to - t0) / (t1 - t0)) * barW)))
      return [
        { text: ` ${padEnd(headFit(l.name, nameW), nameW)}  ` },
        { text: ' '.repeat(a) },
        { text: '━'.repeat(b - a), color: colorOf[l.state] },
        { text: ' '.repeat(barW - b) + '  ' },
        { text: symOf[l.state], color: l.state === 'done' ? ROLE.ok : colorOf[l.state] },
        { text: padStart(l.dur, durW + 2) },
      ]
    }),
    axis: [{ text: lead }, { text: '─'.repeat(barW), color: ROLE.frame }],
  }
}
