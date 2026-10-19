import type { BinnacleActivityEvent, BinnacleActivityIndexEntry, BinnacleActivitySession } from '../../../types'
import { elapsed, money, shortenPath, tokens } from '../../core/format.ts'
import { relPath } from '../diff/parse.ts'
import { textWidth } from '../../core/width.ts'
import { MAX_LIST, dated, flat, padEnd, padStart, stamp, type Row, type Span } from '../ui/cols.ts'
import { ROLE, SYM } from '../ui/theme.ts'
import { turnNumbers } from './events.ts'
import { clip, visible } from './mask.ts'

/** `text` and `color` are the row as one line (details, plugin tabs, tests); `row` is how the Activity tab lays it out. */
/** What a plugin's tab row adds (binnacle spec 2026-10-16 §4.4): its id, whether the row is pressed, its buttons. */
export type ExtRow = { id?: string; press: boolean; buttons: { id: string; label: string }[]; indent?: number }
export type TreeNode = { key: string; text: string; color?: string; dim?: boolean; bold?: boolean; detail?: string[]; children?: TreeNode[]; row?: Row; ext?: ExtRow }
export type FlatRow = { key: string; depth: number; text: string; color?: string; dim?: boolean; bold?: boolean; hasChildren: boolean; isOpen: boolean; row?: Row; ext?: ExtRow }

type Session = BinnacleActivitySession
type Ev = BinnacleActivityEvent
type Of<K extends Ev['kind']> = Extract<Ev, { kind: K }>

/** `HH:MM:SS`, the date before it when `at` is not today. */
const clock = (at: number, now: number): string => stamp(at, dated([at], now), true)

function permText(ev: Of<'perm'>): { text: string; refused: boolean } {
  if (ev.decision === 'deny') return { text: `denied by ${ev.decider}`, refused: true }
  if (ev.outcome === 'approved') return { text: 'asked → approved (you or the classifier)', refused: false }
  if (ev.outcome === 'denied-by-user') return { text: 'asked → you denied', refused: true }
  if (ev.outcome === 'denied-by-classifier') return { text: 'asked → classifier denied', refused: true }
  if (ev.outcome === 'denied-by-hook') return { text: 'asked → a hook denied', refused: true }
  return { text: 'asked', refused: false }
}

/** Every field of an event, one per line. */
const eventDetail = (ev: Ev, now: number): string[] =>
  Object.entries(ev).map(([k, v]) => `${k}: ${k === 'at' && typeof v === 'number' ? clock(v, now) : Array.isArray(v) ? v.join(' | ') : String(v)}`)

const tok = (n: number | null): string => (n === null ? '—' : tokens(n))
const span = (text: string, color?: string): Span => (color === undefined ? { text } : { text, color })

function eventNode(ev: Ev, i: number, cwd: string, now: number): TreeNode | null {
  const key = `ev:${i}`
  const detail = eventDetail(ev, now)
  if (ev.kind === 'perm' && ev.source !== undefined) {
    const rule = ev.ruleId ?? '?'
    const source = flat(ev.source)
    return {
      key, text: `${SYM.guard} ${source} · ${rule} · ${clip(flat(ev.summary), 40)}`, color: 'red', detail,
      row: { lead: [span(SYM.guard, ROLE.bad), span(` ${source} · `), span(rule, ROLE.bad), span('   ')], body: ev.summary },
    }
  }
  if (ev.kind === 'perm') {
    const p = permText(ev)
    const mark = p.refused ? SYM.failed : '?'
    return {
      key, text: `${mark} ${p.text} · ${clip(flat(ev.summary), 40)}`, color: p.refused ? 'red' : 'blue', detail,
      row: p.refused
        ? { lead: [span(`${mark} ${p.text}   `, ROLE.bad)], body: ev.summary, bodyColor: ROLE.bad }
        : { lead: [span(mark, ROLE.ask), span(` ${p.text}   `)], body: ev.summary },
    }
  }
  if (ev.kind === 'guard') {
    const refused = ev.action === 'deny' || ev.action === 'ask-deny'
    return {
      key, text: `${SYM.guard} guard ${ev.action} · ${ev.ruleId} · ${clip(flat(ev.summary), 40)}`, color: refused ? 'red' : 'yellow', detail,
      row: refused
        ? { lead: [span(`${SYM.guard} guard ${ev.action} · ${ev.ruleId}   `, ROLE.bad)], body: ev.summary, bodyColor: ROLE.bad }
        : { lead: [span(SYM.guard, ROLE.warn), span(` guard ${ev.action} · ${ev.ruleId}   `)], body: ev.summary },
    }
  }
  if (ev.kind === 'error') {
    return {
      key, text: `! ${ev.tool} · ${clip(flat(ev.message), 40)}`, color: 'red', detail,
      row: { lead: [span(`${SYM.failed} ${ev.tool}   `, ROLE.bad)], body: ev.message, bodyColor: ROLE.bad },
    }
  }
  if (ev.kind === 'edit') {
    return {
      key, text: `✎ ${ev.file.split('/').pop() ?? ev.file} +${ev.added} −${ev.removed}`, color: 'green', detail,
      row: {
        lead: [span(`${SYM.edit} `)], body: relPath(ev.file, cwd), cut: 'middle',
        nums: [ev.added > 0 ? [span(`+${ev.added}`, ROLE.added)] : null, ev.removed > 0 ? [span(`−${ev.removed}`, ROLE.removed)] : null],
      },
    }
  }
  if (ev.kind === 'compact') {
    const sizes = ev.tokensBefore !== null && ev.tokensAfter !== null ? `${tokens(ev.tokensBefore)} → ${tokens(ev.tokensAfter)}` : ''
    const trigger = flat(ev.trigger)
    return {
      key, text: `${SYM.compact} compacted · ${trigger}${sizes ? ` · ${sizes}` : ''} · ${elapsed(ev.durationMs)}`, dim: true, detail,
      row: { lead: [span(`${SYM.compact} compacted · ${trigger}   `, ROLE.dim)], body: sizes, bodyColor: ROLE.dim, nums: [[span(elapsed(ev.durationMs), ROLE.dim)]] },
    }
  }
  return null
}

/** The agent a hand-back turn's saved prompt names: `<agent-message from="id">` or `<task-notification> <task-id>id`. */
export const HAND_BACK = /^<agent-message from="([^"]+)">|^<task-notification> <task-id>([^<\s]+)<\/task-id>/

/**
 * Turns (newest first) → the agents they spawned (nested by parent) and the main loop's events, each with its
 * counts. `since`: agents and turns from before it without an end are history (`no local events`, `unfinished`).
 */
export function buildTree(s: Session, since: number, now: number): TreeNode[] {
  const nums = turnNumbers(s)
  const turnEnds = new Map<string, Of<'turn-end'>>()
  const agentEnds = new Map<string, Of<'agent-end'>>()
  for (const ev of s.events) {
    if (ev.kind === 'turn-end') turnEnds.set(ev.turnId, ev)
    if (ev.kind === 'agent-end' && ev.agentId !== null) agentEnds.set(ev.agentId, ev)
  }
  const starts = s.events.filter((ev): ev is Of<'agent-start'> => ev.kind === 'agent-start')
  const known = new Set(starts.map(a => a.agentId))
  // Grouped once, so a draw reads the events once however many turns and agents there are.
  const group = <T,>(list: readonly T[], key: (x: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>()
    for (const x of list) m.get(key(x))?.push(x) ?? m.set(key(x), [x])
    return m
  }
  const where = (turnId: string, agentId: string | null): string => `${turnId}\u0000${agentId ?? ''}`
  const byPlace = group(s.events.map((ev, i) => ({ ev, i })), x => where(x.ev.turnId, x.ev.agentId))
  const countOf = new Map(s.counts.map(c => [where(c.turnId, c.agentId), c]))
  const byParent = group(starts, a => a.parentAgentId ?? '')
  const byTurn = group(starts, a => a.turnId)
  const byId = new Map(starts.map(a => [a.agentId, a]))
  // A foreground agent cannot outlive its turn: one with no agent-end of its own in an ended turn was cut off.
  const cutOff = (a: Of<'agent-start'>): boolean => !a.background && turnEnds.has(a.turnId)

  const leaves = (turnId: string, agentId: string | null): TreeNode[] => {
    const out: TreeNode[] = []
    for (const { ev, i } of byPlace.get(where(turnId, agentId)) ?? []) {
      const n = eventNode(ev, i, s.cwd, now)
      if (n) out.push(n)
    }
    const c = countOf.get(where(turnId, agentId))
    if (c) {
      const text = `files ${c.files} · shell ${c.shell} · other ${c.other}`
      out.push({ key: `count:${turnId}:${agentId ?? 'main'}`, text, dim: true, row: { lead: [span(text, ROLE.dim)] } })
    }
    return out
  }

  const agentNode = (a: Of<'agent-start'>): TreeNode => {
    const id = a.agentId ?? ''
    const end = agentEnds.get(id)
    const state = end
      ? `${elapsed(end.durationMs)} · ${tok(end.tokensIn)}/${tok(end.tokensOut)} tok${end.aborted ? ' · aborted' : ''}`
      : cutOff(a) ? 'unfinished' : a.at >= since ? 'running' : 'no local events'
    const mark = end ? (end.aborted ? span(SYM.failed, ROLE.bad) : span(SYM.done, ROLE.ok)) : state === 'running' ? span(SYM.running, ROLE.focus) : span(SYM.todo, ROLE.dim)
    const row: Row = {
      lead: [mark, span(` ${a.agentType}   `)], body: a.task,
      nums: end
        ? [[span(elapsed(end.durationMs))], [span(`${tok(end.tokensIn)}/${tok(end.tokensOut)}`, ROLE.dim)]]
        : [[span(state, state === 'running' ? ROLE.focus : ROLE.dim)], null],
    }
    const detail = [
      `agent ${a.agentType} · ${a.model}${a.background ? ' · background' : ''}`,
      `task: ${a.task}`,
      `started ${clock(a.at, now)}${end ? ` · ran ${elapsed(end.durationMs)}` : ''}`,
      ...(end ? ['report:', ...end.report.map(l => `  ${l}`)] : []),
    ]
    const children = [...(byParent.get(id) ?? []).map(agentNode), ...leaves(a.turnId, id)]
    return { key: `agent:${id}`, text: `${a.agentType} · ${clip(flat(a.task), 40)} · ${state}`, color: end || state !== 'running' ? undefined : 'blue', detail, children, row }
  }

  const turns = s.events.filter((ev): ev is Of<'turn-start'> => ev.kind === 'turn-start')
  const numW = String(turns.length).length + 1
  return [...turns].reverse().map(t => {
    const end = turnEnds.get(t.turnId)
    const running = !end && t.at >= since
    const state = end
      ? `${elapsed(end.durationMs)}${end.costUsd !== null ? ` · ${money(end.costUsd)}` : ''}${end.aborted ? ' · aborted' : ''}`
      : running ? 'running' : 'unfinished'
    const top = (byTurn.get(t.turnId) ?? []).filter(a => a.parentAgentId === null || !known.has(a.parentAgentId))
    const hand = t.auto === true ? HAND_BACK.exec(t.prompt) : null
    const from = hand ? byId.get(hand[1] ?? hand[2] ?? '') : undefined
    const loop = t.auto === true && t.via === 'loop'
    const label = hand ? `↩ agent hand-back${from ? ` · ${from.agentType} · ${clip(flat(from.task), 40)}` : ''}`
      : loop ? `${SYM.loop} /loop · ${clip(flat(t.prompt), 40)}` : `"${clip(flat(t.prompt), 40)}"`
    const n = `#${nums.get(t.turnId) ?? 0}`
    const who: Span[] = hand ? [span(`${SYM.handBack} agent hand-back${from ? ` · ${from.agentType} · ` : ''}`)]
      : loop ? [span(`${SYM.loop} /loop · `)]
      : t.auto === true ? [span(`${t.via ?? 'auto'} · `, ROLE.dim)]
      : [span('you   ')]
    const row: Row = {
      lead: [span(`${padStart(n, numW)}  `, undefined), ...who],
      body: hand ? (from ? from.task : '') : t.prompt,
      nums: end
        ? [[span(`${elapsed(end.durationMs)}${end.aborted ? ` ${SYM.failed}` : ''}`)], end.costUsd !== null ? [span(money(end.costUsd), ROLE.dim)] : null]
        : [[span(state, running ? ROLE.focus : ROLE.dim)], null],
    }
    return {
      key: `turn:${t.turnId}`,
      text: `${n} · ${state} · ${label}`,
      bold: true,
      detail: [`prompt: ${t.prompt}`, `started ${clock(t.at, now)}${end ? ` · ran ${elapsed(end.durationMs)}` : ''}`],
      children: [...top.map(agentNode), ...leaves(t.turnId, null)],
      row,
    }
  })
}

export type AgentRow = { key: string; text: string; detail: string[]; row: Row }

/** Denials and errors an agent's details list each; the rest are counted. */
export const MAX_DETAIL_LINES = 20
const capped = (lines: string[]): string[] =>
  lines.length > MAX_DETAIL_LINES ? [...lines.slice(0, MAX_DETAIL_LINES), `… and ${lines.length - MAX_DETAIL_LINES} more`] : lines

/**
 * Every agent of a session, newest first: `type · task · duration · steps · outcome`, and its details (task, tools,
 * denials, errors, the first lines of its answer). `since` as in buildTree; `now` times the ones still running.
 */
export function agentRows(s: Session, since: number, now: number): AgentRow[] {
  const ends = new Map<string, Of<'agent-end'>>()
  for (const ev of s.events) if (ev.kind === 'agent-end' && ev.agentId !== null) ends.set(ev.agentId, ev)
  const starts = s.events.filter((ev): ev is Of<'agent-start'> => ev.kind === 'agent-start' && ev.agentId !== null)
  const endedTurns = new Set(s.events.filter(ev => ev.kind === 'turn-end').map(ev => ev.turnId))
  // Each agent's events and counts, gathered in one pass over the session.
  const ownOf = new Map<string, Ev[]>()
  for (const ev of s.events) if (ev.agentId !== null) ownOf.get(ev.agentId)?.push(ev) ?? ownOf.set(ev.agentId, [ev])
  const countsOf = new Map<string, Session['counts']>()
  for (const c of s.counts) if (c.agentId !== null) countsOf.get(c.agentId)?.push(c) ?? countsOf.set(c.agentId, [c])
  // Columns, not characters: a CJK type is twice as wide as its length.
  const typeW = Math.min(16, starts.reduce((w, a) => Math.max(w, textWidth(visible(a.agentType))), 0))
  return [...starts].reverse().map(a => {
    const id = a.agentId ?? ''
    const end = ends.get(id)
    const own = ownOf.get(id) ?? []
    const denials: string[] = []
    const errors: string[] = []
    for (const ev of own) {
      if (ev.kind === 'perm' && ev.source !== undefined) denials.push(`${SYM.guard} ${visible(ev.source)} · ${visible(ev.ruleId ?? '?')} · ${clip(visible(ev.summary), 80)}`)
      else if (ev.kind === 'perm' && permText(ev).refused) denials.push(`✗ ${permText(ev).text} · ${clip(visible(ev.summary), 80)}`)
      if (ev.kind === 'guard' && (ev.action === 'deny' || ev.action === 'ask-deny')) denials.push(`⚑ guard ${ev.action} · ${visible(ev.ruleId)} · ${clip(visible(ev.summary), 80)}`)
      if (ev.kind === 'error') errors.push(`! ${visible(ev.tool)} · ${clip(visible(ev.message), 80)}`)
    }
    const tools = (countsOf.get(id) ?? []).reduce((t, c) => ({ files: t.files + c.files, shell: t.shell + c.shell, other: t.other + c.other }), { files: 0, shell: 0, other: 0 })
    const steps = tools.files + tools.shell + tools.other
    // A foreground agent with no agent-end in an ended turn was cut off: unfinished, not running (§7.2).
    const running = !end && a.at >= since && !(!a.background && endedTurns.has(a.turnId))
    const duration = end ? elapsed(end.durationMs) : running ? elapsed(now - a.at) : '—'
    const refused = [denials.length ? `${denials.length} denied` : '', errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : ''].filter(Boolean)
    const outcome = !end ? (running ? 'running' : 'unfinished') : end.aborted ? '✗ aborted' : refused.length ? `✗ ${refused.join(' · ')}` : '✓ done'
    const type = visible(a.agentType)
    const outcomeSpans: Span[] = !end ? [span(outcome, running ? ROLE.focus : ROLE.dim)]
      : outcome.startsWith('✗') ? [span(SYM.failed, ROLE.bad), span(outcome.slice(1))]
      : [span(SYM.done, ROLE.ok), span(outcome.slice(1))]
    return {
      key: `agent:${id}`,
      text: `${type} · ${clip(visible(a.task), 40)} · ${duration} · ${steps} steps · ${outcome}`,
      row: { lead: [span(`${padEnd(type, typeW)}   `)], body: visible(a.task), nums: [[span(duration)], [span(`${steps} steps`, ROLE.dim)], outcomeSpans] },
      detail: [
        `agent ${type} · ${visible(a.model)}${a.background ? ' · background' : ''}`,
        `task: ${visible(a.task)}`,
        `started ${clock(a.at, now)}${end ? ` · ran ${elapsed(end.durationMs)}` : ''}`,
        `tools: files ${tools.files} · shell ${tools.shell} · other ${tools.other}`,
        ...(denials.length ? ['denials:', ...capped(denials).map(l => `  ${l}`)] : []),
        ...(errors.length ? ['errors:', ...capped(errors).map(l => `  ${l}`)] : []),
        ...(end?.report.length ? ['answer:', ...end.report.map(l => `  ${visible(l)}`)] : []),
      ],
    }
  })
}

/** The rows a person sees: each node, and the children of open ones. Rows past `max` are only counted. */
export function flatten(nodes: TreeNode[], isOpen: (key: string) => boolean, max = MAX_LIST): { rows: FlatRow[]; hidden: number } {
  const rows: FlatRow[] = []
  let hidden = 0
  const walk = (list: TreeNode[], depth: number): void => {
    for (const n of list) {
      const hasChildren = (n.children?.length ?? 0) > 0
      const open = hasChildren && isOpen(n.key)
      if (rows.length < max) rows.push({ key: n.key, depth, text: n.text, color: n.color, dim: n.dim, bold: n.bold, hasChildren, isOpen: open, row: n.row, ext: n.ext })
      else hidden++
      if (open) walk(n.children ?? [], depth + 1)
    }
  }
  walk(nodes, 0)
  return { rows, hidden }
}

export function findNode(nodes: TreeNode[], key: string): TreeNode | null {
  for (const n of nodes) {
    if (n.key === key) return n
    const hit = findNode(n.children ?? [], key)
    if (hit) return hit
  }
  return null
}

export const rowLabel = (r: FlatRow): string => `${'  '.repeat(r.depth)}${r.hasChildren ? (r.isOpen ? '▾ ' : '▸ ') : '  '}${r.text}`

/** The Activity tab's row (§4.7): turns flush left with their toggle, everything under a turn indented 5 columns a level. */
export function treeRow(r: FlatRow): Row {
  const toggle = r.hasChildren ? (r.isOpen ? `${SYM.open} ` : `${SYM.closed} `) : r.depth === 0 ? '  ' : ''
  const base = r.row ?? { lead: [{ text: r.text, color: r.color, bold: r.bold, dim: r.dim }] }
  // A plugin row's indent (BinnacleTabRow.indent) goes after the toggle: its text is cleaned, so spaces of its own would be lost.
  return { ...base, lead: [{ text: ' '.repeat(5 * r.depth) + toggle + '  '.repeat(r.ext?.indent ?? 0) }, ...base.lead] }
}

/**
 * Turns open by default: the newest, and the latest one the person started when turns Claude Code started itself
 * (a background agent's hand-back) came after it, so the turn holding the agent is not left collapsed.
 */
export function openByDefault(s: Session): string[] {
  const turns = s.events.filter((ev): ev is Of<'turn-start'> => ev.kind === 'turn-start')
  const newest = turns.at(-1)
  if (!newest) return []
  const mine = turns.findLast(t => t.auto !== true)
  return mine && mine !== newest ? [`turn:${newest.turnId}`, `turn:${mine.turnId}`] : [`turn:${newest.turnId}`]
}

/** Open = open by default XOR toggled by the person. */
export const toggledOpen = (defaults: string[], toggled: string[]) => (key: string): boolean => defaults.includes(key) !== toggled.includes(key)

const pad = (n: number): string => String(n).padStart(2, '0')

export function sessionLabel(x: BinnacleActivityIndexEntry, home: string): string {
  const d = new Date(x.startedAt)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${shortenPath(flat(x.cwd), home, 30)} · "${clip(flat(x.firstPrompt), 30)}"`
}

/** The host refuses a Select with more than 64 options: "This session" plus the 63 newest saved ones. */
const MAX_SAVED_OPTIONS = 63

export const sessionOptions = (index: BinnacleActivityIndexEntry[], currentId: string | null, home: string): { value: string; label: string }[] => [
  { value: 'current', label: 'This session' },
  ...index.filter(x => x.sessionId !== currentId && visible(x.sessionId) === x.sessionId).sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_SAVED_OPTIONS).map(x => ({ value: x.sessionId, label: sessionLabel(x, home) })),
]
