import { card, cutSpans, dated, flat, heading, layoutRows, padEnd, stamp, widthOf, type Row, type Span } from '../ui/cols.ts'
import { stackBar } from '../ui/stack.ts'
import { ROLE, SYM } from '../ui/theme.ts'
import { elapsed } from '../../core/format.ts'
import type { LiveCall, Tally } from './live.ts'
import type { AgentCard, FlowView, LogLine } from './model.ts'

/** From this width the cards are boxes side by side; below it, a tree. */
export const WIDE = 80
const PER_ROW = 3
const GAP = 1
const MAX_CHILDREN = 2
const MAX_ANOMALIES = 3

const mark = (o: LiveCall['outcome']): Span =>
  o === 'running' ? { text: SYM.running, color: ROLE.focus } : o === 'ok' ? { text: SYM.done, color: ROLE.ok } : { text: SYM.failed, color: ROLE.bad }
const took = (c: LiveCall, now: number): string => elapsed((c.endedAt ?? now) - c.startedAt)
const stepsText = (n: number): string => `${n} step${n === 1 ? '' : 's'}`

/** One call as a row: mark, tool, what it ran, how long. */
const callRow = (c: LiveCall, now: number): Row => ({ lead: [mark(c.outcome), { text: ` ${padEnd(flat(c.tool), 6)} ` }], body: c.summary, nums: [[{ text: took(c, now), color: ROLE.dim }]] })

const agentState = (a: AgentCard, now: number): Span =>
  a.running ? { text: `${SYM.running} ${elapsed(now - a.at)}`, color: ROLE.focus }
  : { text: `${a.aborted ? SYM.failed : SYM.done} ${elapsed((a.endedAt ?? now) - a.at)}`, color: a.aborted ? ROLE.bad : ROLE.ok }

export function tallyParts(t: Tally): { allowed: number; asked: number; denied: number; line: string } {
  const allowed = t.allowRules + t.allowHook + t.allowAuto
  const asked = t.askApproved + t.askDeniedYou + t.askDeniedAuto + t.askDeniedHook
  const denied = t.denyRules + t.denyHook + t.denyAuto + t.denyGuard
  const parts = [
    t.allowRules ? `rules ${t.allowRules} → allow` : '', t.allowHook ? `hook ${t.allowHook} → allow` : '', t.allowAuto ? `auto ${t.allowAuto} → allow` : '',
    asked ? `asked ${asked} → ${[
      t.askApproved ? `${t.askApproved} approved` : '', t.askDeniedYou ? `${t.askDeniedYou} you denied` : '',
      t.askDeniedAuto ? `${t.askDeniedAuto} auto denied` : '', t.askDeniedHook ? `${t.askDeniedHook} hook denied` : '',
    ].filter(Boolean).join(' · ')}` : '',
    t.denyRules ? `rules ${t.denyRules} → deny` : '', t.denyHook ? `hook ${t.denyHook} → deny` : '', t.denyAuto ? `auto ${t.denyAuto} → deny` : '',
    t.denyGuard ? `guard ${t.denyGuard} → deny` : '',
  ].filter(Boolean)
  return { allowed, asked, denied, line: parts.join('   ') }
}

function titleLine(v: FlowView, width: number, now: number): Span[] {
  if (!v.turn) return heading('Flow', 'idle', width)
  const run = v.agents.filter(a => a.running).length
  const done = v.agents.length - run
  const clock = v.turn.endedAt === null ? `${SYM.running} ${elapsed(now - v.turn.at)}` : `${SYM.done} ${elapsed(v.turn.endedAt - v.turn.at)}`
  return heading('Flow', [`turn #${v.turn.n}`, clock, ...(v.agents.length ? [`${run} running`, `${done} done`] : [])].join(' · '), width)
}

/** Cards of one row side by side: their bodies were padded to one height, so every line has each card. */
function sideBySide(cards: Span[][][], widths: number[]): Span[][] {
  const h = Math.max(...cards.map(c => c.length))
  return Array.from({ length: h }, (_, i) => cards.flatMap((c, k) => {
    const line = c[i] ?? []
    const pad = (widths[k] as number) - widthOf(line)
    return [...(k ? [{ text: ' '.repeat(GAP) }] : []), ...line, ...(pad > 0 ? [{ text: ' '.repeat(pad) }] : [])]
  }))
}

/** `┌──┼──┐` above the cards (down) or `└──┬──┘` below them (up), between the card centres and the main column. */
function branch(centres: number[], main: number, width: number, down: boolean): Span[][] {
  // A card centre a column or two off main's takes main's line: `┬┴` side by side reads as a glitch.
  const mid = centres.find(c => Math.abs(c - main) <= 2) ?? main
  const row = Array.from({ length: width }, () => ' ')
  const lo = Math.min(mid, ...centres)
  const hi = Math.max(mid, ...centres)
  for (let x = lo; x <= hi; x++) row[x] = '─'
  // Cards hang below a fork (down) and above a join; main is above a fork and below a join.
  const card = (x: number): string => (x === lo ? (down ? '┌' : '└') : x === hi ? (down ? '┐' : '┘') : down ? '┬' : '┴')
  for (const c of centres) row[c] = card(c)
  if (lo === hi) row[mid] = '│'
  else if (centres.includes(mid)) row[mid] = mid === lo ? '├' : mid === hi ? '┤' : '┼'
  else row[mid] = mid === lo ? (down ? '└' : '┌') : mid === hi ? (down ? '┘' : '┐') : down ? '┴' : '┬'
  const arrows = Array.from({ length: width }, () => ' ')
  for (const c of down ? centres : [mid]) arrows[c] = '▼'
  const line = (cells: string[]): Span[] => [{ text: cells.join('').replace(/ +$/, ''), color: ROLE.frame }]
  return [line(row), line(arrows)]
}

function agentBody(a: AgentCard, inner: number, now: number): Span[][] {
  const kids = a.children.slice(0, MAX_CHILDREN).map(c => `↳ ${flat(c.type)} ${c.running ? SYM.running : SYM.done}`)
  const more = a.children.length > MAX_CHILDREN ? [`↳ +${a.children.length - MAX_CHILDREN}`] : []
  return [
    [{ text: flat(a.task), color: ROLE.dim }],
    ...layoutRows(a.calls.map(c => callRow(c, now)), inner),
    [{ text: stepsText(a.steps), color: ROLE.dim }, ...a.flags.map(f => ({ text: ` · ⚠ ${f}`, color: ROLE.warn }))],
    ...(kids.length || more.length ? [[{ text: [...kids, ...more].join('  '), color: ROLE.dim }]] : []),
  ]
}

function oneLine(a: AgentCard, width: number, now: number): Span[] {
  const s = agentState(a, now)
  return cutSpans([{ text: ' ' }, { text: s.text.split(' ')[0] as string, color: s.color }, { text: ` ${flat(a.type)} · ${flat(a.task)} · ${elapsed((a.endedAt ?? now) - a.at)} · ${stepsText(a.steps)}${a.aborted ? ' · aborted' : ''}`, color: ROLE.dim }], width)
}

function wide(v: FlowView, head: { model: string; effort: string }, width: number, now: number): Span[][] {
  const out: Span[][] = []
  const mainClock = v.turn ? (v.turn.endedAt === null ? `${SYM.running} ${elapsed(now - v.turn.at)}` : `${SYM.done} ${elapsed(v.turn.endedAt - v.turn.at)}`) : ''
  out.push(...card(['main', head.model, head.effort].filter(Boolean).join(' · '), mainClock, [
    ...(v.turn ? [[{ text: `"${flat(v.turn.prompt)}"` }]] : []),
    ...layoutRows(v.mainCalls.map(c => callRow(c, now)), width - 4),
    ...(v.mainFlags.length ? [v.mainFlags.map(f => ({ text: `⚠ ${f}  `, color: ROLE.warn }))] : []),
  ], width))
  const running = v.agents.filter(a => a.running)
  const finished = v.agents.filter(a => !a.running)
  if (v.agents.length === 0) return out
  const mid = Math.floor(width / 2)
  const rows: AgentCard[][] = []
  for (let i = 0; i < running.length; i += PER_ROW) rows.push(running.slice(i, i + PER_ROW))
  let lastCentres = [mid]
  // Every row keeps the first row's card width, so a short last row does not stretch its cards.
  const perRow = Math.min(PER_ROW, running.length)
  const cw = Math.floor((width - GAP * (perRow - 1)) / perRow)
  rows.forEach((row, r) => {
    const widths = row.map((_, k) => (row.length === perRow && k === row.length - 1 ? width - (cw + GAP) * (row.length - 1) : cw))
    const centres = widths.map((w, k) => (cw + GAP) * k + Math.floor(w / 2))
    if (r === 0) out.push(...branch(centres, mid, width, true))
    const bodies = row.map((a, k) => agentBody(a, (widths[k] as number) - 4, now))
    const tallest = Math.max(...bodies.map(b => b.length))
    const even = bodies.map(b => [...b, ...Array.from({ length: tallest - b.length }, (): Span[] => [])])
    out.push(...sideBySide(row.map((a, k) => card(flat(a.type), agentState(a, now).text, even[k] as Span[][], widths[k] as number, 0)), widths))
    lastCentres = centres
  })
  for (const a of finished) out.push(oneLine(a, width, now))
  out.push(...branch(rows.length ? lastCentres : [mid], mid, width, false))
  const done = finished.length
  const back = `back to main · ${done} of ${v.agents.length} done`
  out.push([{ text: ' '.repeat(Math.max(0, mid - Math.floor(back.length / 2))) }, { text: back, color: ROLE.dim }])
  return out
}

function narrow(v: FlowView, head: { model: string; effort: string }, width: number, now: number): Span[][] {
  const out: Span[][] = []
  const clock = v.turn ? (v.turn.endedAt === null ? `${SYM.running} ${elapsed(now - v.turn.at)}` : `${SYM.done} ${elapsed(v.turn.endedAt - v.turn.at)}`) : ''
  out.push(heading(['main', head.model, head.effort].filter(Boolean).join(' · '), clock, width))
  const first = v.mainCalls[0]
  if (first) out.push(cutSpans([{ text: '│ ', color: ROLE.frame }, mark(first.outcome), { text: ` ${flat(first.tool)}  ${first.summary}  ${took(first, now)}` }], width))
  v.agents.forEach((a, i) => {
    const last = i === v.agents.length - 1
    const s = agentState(a, now)
    out.push(cutSpans([{ text: last ? '└─ ' : '├─ ', color: ROLE.frame }, { text: s.text.split(' ')[0] as string, color: s.color }, { text: ` ${flat(a.type)}  ${flat(a.task)}  ${s.text.split(' ')[1] ?? ''}` }], width))
    const c = a.calls[0]
    if (a.running && c) out.push(cutSpans([{ text: last ? '     ' : '│    ', color: ROLE.frame }, mark(c.outcome), { text: ` ${flat(c.tool)} ${c.summary} ${took(c, now)}` }, ...a.flags.map(f => ({ text: ` · ⚠ ${f}`, color: ROLE.warn }))], width))
  })
  return out
}

function decisions(v: FlowView, width: number, isWide: boolean): Span[][] {
  const p = tallyParts(v.tally)
  if (p.allowed + p.asked + p.denied === 0 && v.waiting.length === 0) return []
  const out: Span[][] = [heading('Decisions this turn', `${p.allowed} allowed · ${p.asked} asked · ${p.denied} denied`, width)]
  const bar = stackBar([
    { name: 'allowed', n: p.allowed + v.tally.askApproved, color: ROLE.ok },
    { name: 'asked', n: v.waiting.length, color: ROLE.warn },
    { name: 'denied', n: p.denied + p.asked - v.tally.askApproved, color: ROLE.bad },
  ], width - 1)
  if (bar.length) out.push([{ text: ' ' }, ...bar])
  if (isWide && p.line) out.push(cutSpans([{ text: ` ${p.line}`, color: ROLE.dim }], width))
  for (const w of v.waiting) out.push(cutSpans([{ text: ' ⏳ waiting for approval   ', color: ROLE.warn }, { text: `${padEnd(flat(w.tool), 6)} ${w.summary}` }, ...(w.reason ? [{ text: `   ${flat(w.reason)}`, color: ROLE.dim }] : [])], width))
  return out
}

function warnings(v: FlowView, width: number): Span[][] {
  const typeOf = new Map(v.agents.map(a => [a.agentId, a.type]))
  const items = v.anomalies.slice(0, MAX_ANOMALIES).map(a => `⚠ ${a.agentId === null ? '' : `${typeOf.get(a.agentId) ?? 'agent'}: `}${a.text}`)
  if (!items.length) return []
  const joined = items.join('     ')
  return (joined.length + 1 <= width ? [joined] : items).map(t => cutSpans([{ text: ` ${t}`, color: ROLE.warn }], width))
}

function logLines(list: readonly LogLine[], width: number, now: number, max: number): Span[][] {
  const shown = list.slice(0, max)
  if (!shown.length) return []
  const withDate = dated(shown.map(l => l.at), now)
  const glyph = (m: LogLine['mark']): Span =>
    m === 'running' ? { text: SYM.running, color: ROLE.focus } : m === 'done' ? { text: SYM.done, color: ROLE.ok } : m === 'failed' ? { text: SYM.failed, color: ROLE.bad } : m === 'spawn' ? { text: '↳', color: ROLE.dim } : { text: SYM.compact, color: ROLE.dim }
  return [heading('Log', '', width), ...shown.map(l => cutSpans([{ text: ` ${stamp(l.at, withDate, true)}  `, color: ROLE.dim }, { text: `${padEnd(flat(l.who), 8)} ` }, glyph(l.mark), { text: ` ${flat(l.text)}` }], width))]
}

export function flowLines(v: FlowView, head: { model: string; effort: string }, width: number, now: number): Span[][] {
  const isWide = width >= WIDE
  return [
    titleLine(v, width, now),
    ...(isWide ? wide(v, head, width, now) : narrow(v, head, width, now)),
    ...decisions(v, width, isWide),
    ...warnings(v, width),
    ...logLines(v.log, width, now, isWide ? 5 : 3),
  ].map(l => cutSpans(l, width))
}
