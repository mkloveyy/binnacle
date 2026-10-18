import { textWidth } from '../../core/width.ts'
import { visible } from '../activity/mask.ts'
import { ROLE } from './theme.ts'

/** A piece of a drawn line. Every text reaches the screen through `visible` first: the host refuses control characters. */
export type Span = { text: string; color?: string; bold?: boolean; dim?: boolean }

/**
 * One row of a list: `lead` (marks, numbers, labels; cut only as a last resort), `body` (the free text, cut first),
 * and right-aligned number cells (`nums`), aligned across the whole set of rows. A trailing cell is dropped
 * before the body would get under 8 columns. Symbols, status words and numbers are never cut.
 */
export type Row = { lead: Span[]; body?: string; bodyColor?: string; cut?: 'end' | 'middle'; nums?: (Span[] | null)[] }

/** Below this many columns the panel draws no borders, single-column legends, no timeline and no time column (§4.1.8). */
export const NARROW = 60
/** Characters one drawing may hold; the host refuses past 100 000 (index.d.ts:1637). */
export const BUDGET = 90_000
/** Rows a long list draws at most; the rest are counted. */
export const MAX_LIST = 400
/** Options a Select may hold: the host refuses the whole panel past 64. */
export const MAX_OPTIONS = 64

export const widthOf = (spans: readonly Span[]): number => spans.reduce((w, s) => w + textWidth(s.text), 0)

/** The longest prefix of `text` within `max` columns. */
export function headFit(text: string, max: number): string {
  let out = ''
  let w = 0
  for (const ch of text) {
    const c = textWidth(ch)
    if (w + c > max) break
    out += ch
    w += c
  }
  return out
}

/** The longest suffix of `text` within `max` columns. */
export function tailFit(text: string, max: number): string {
  const chars = [...text]
  let out = ''
  let w = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = textWidth(chars[i] ?? '')
    if (w + c > max) break
    out = chars[i] + out
    w += c
  }
  return out
}

/** `text` within `max` columns, `…` at the end when cut. */
export const cutEnd = (text: string, max: number): string =>
  max <= 0 ? '' : textWidth(text) <= max ? text : headFit(text, max - 1) + '…'

/** A path within `max` columns, cut in the middle, the last segment kept whole when it fits: `~/w…/binnacle`. */
export function cutMiddle(text: string, max: number): string {
  if (textWidth(text) <= max) return text
  if (max <= 2) return cutEnd(text, max)
  const slash = text.lastIndexOf('/')
  const seg = slash > 0 ? text.slice(slash) : ''
  if (seg !== '' && textWidth(seg) + 2 <= max) return headFit(text, max - 1 - textWidth(seg)) + '…' + seg
  const tail = Math.floor((max - 1) / 2)
  return headFit(text, max - 1 - tail) + '…' + tailFit(text, tail)
}

export const padEnd = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - textWidth(text)))
export const padStart = (text: string, w: number): string => ' '.repeat(Math.max(0, w - textWidth(text))) + text

/** Spans cut to `max` columns as one line, `…` at the cut. */
export function cutSpans(spans: readonly Span[], max: number): Span[] {
  if (max <= 0) return []
  if (widthOf(spans) <= max) return [...spans]
  const out: Span[] = []
  let left = max - 1
  for (const s of spans) {
    const w = textWidth(s.text)
    if (w <= left) {
      out.push(s)
      left -= w
      continue
    }
    out.push({ ...s, text: headFit(s.text, left) + '…' })
    return out
  }
  return out
}

/** One line of drawable text: tab and newline become a space each (they would break the column arithmetic), other control characters visible. */
export const flat = (t: string): string => visible(t.replace(/[\t\n]/g, ' '))

const clean = (spans: readonly Span[]): Span[] => spans.map(s => ({ ...s, text: flat(s.text) }))

/** Drops trailing blanks and empty spans, so no line ends in padding. */
function trimEnd(spans: Span[]): Span[] {
  const out = spans.filter(s => s.text !== '')
  while (out.length) {
    const last = out[out.length - 1] as Span
    const t = last.text.replace(/ +$/, '')
    if (t !== '') {
      out[out.length - 1] = { ...last, text: t }
      break
    }
    out.pop()
  }
  return out
}

/** Lays rows out in `width` columns (§4.1.5–7): number columns right-aligned across the set, the body cut first. */
export function layoutRows(list: readonly Row[], width: number, gap = 2): Span[][] {
  const cols = Math.max(0, ...list.map(r => r.nums?.length ?? 0))
  let numW = Array.from({ length: cols }, (_, i) => Math.max(0, ...list.map(r => widthOf(clean(r.nums?.[i] ?? [])))))
  const block = (): number => numW.reduce((a, w) => a + (w > 0 ? w + gap : 0), 0)
  const leadMax = Math.max(0, ...list.map(r => widthOf(clean(r.lead))))
  while (numW.length > 0 && width - block() < Math.min(leadMax + 8, width)) numW = numW.slice(0, -1)
  const leftW = Math.max(0, width - block())
  return list.map(r => {
    const lead = clean(r.lead)
    const room = leftW - widthOf(lead)
    let left: Span[]
    if (room < 0) left = cutSpans(lead, leftW)
    else {
      const body = flat(r.body ?? '')
      const shown = r.cut === 'middle' ? cutMiddle(body, room) : cutEnd(body, room)
      left = shown === '' ? lead : [...lead, { text: shown, color: r.bodyColor }]
    }
    const tail: Span[] = []
    numW.forEach((w, i) => {
      if (w === 0) return
      const cell = clean(r.nums?.[i] ?? [])
      tail.push({ text: ' '.repeat(gap + w - widthOf(cell)) }, ...cell)
    })
    const hasNums = tail.some(s => s.text.trim() !== '')
    return trimEnd(hasNums ? [...left, { text: ' '.repeat(Math.max(0, leftW - widthOf(left))) }, ...tail] : left)
  })
}

/** A section title (bold) with its summary right-aligned in `inactive`; the summary gives way first, the title stays whole. */
export function heading(title: string, summary: string, width: number): Span[] {
  const t = cutEnd(flat(title), width)
  const room = width - textWidth(t) - 2
  if (summary === '' || room < 4) return [{ text: t, bold: true }]
  const sum = cutEnd(flat(summary), room)
  return [{ text: t, bold: true }, { text: ' '.repeat(width - textWidth(t) - textWidth(sum)) }, { text: sum, color: ROLE.dim }]
}

/**
 * The page's one card (§4.1.3): a `subtle` rounded border with the title in its top edge and a summary at its right,
 * one column of padding inside. Narrower than `framedFrom` (a narrow pane), the heading and the body without a border;
 * the Flow tab's side-by-side cards pass 0 to keep theirs.
 */
export function card(title: string, right: string, body: readonly Span[][], width: number, framedFrom = NARROW): Span[][] {
  if (width < framedFrom) return [heading(title, right, width), ...body.map(l => cutSpans(clean(l), width))]
  const inner = width - 4
  const r = cutEnd(flat(right), Math.max(0, width - 12))
  const rw = r === '' ? 0 : textWidth(r) + 2
  const t = cutEnd(flat(title), Math.max(1, width - 6 - rw))
  const fill = width - 4 - textWidth(t) - rw
  const top: Span[] = [
    { text: '╭ ', color: ROLE.frame }, { text: t, bold: true }, { text: ` ${'─'.repeat(Math.max(1, fill))}`, color: ROLE.frame },
    ...(r === '' ? [] : [{ text: ' ' }, { text: r, color: ROLE.dim }, { text: ' ' }]),
    { text: '╮', color: ROLE.frame },
  ]
  const rows = body.map(l => {
    const content = cutSpans(clean(l), inner)
    return [{ text: '│ ', color: ROLE.frame }, ...content, { text: ' '.repeat(inner - widthOf(content)) }, { text: ' │', color: ROLE.frame }]
  })
  return [top, ...rows, [{ text: `╰${'─'.repeat(width - 2)}╯`, color: ROLE.frame }]]
}

/** The one rule under the tab bar. */
export const rule = (width: number): Span[] => [{ text: '─'.repeat(Math.max(0, width)), color: ROLE.frame }]


/**
 * What a keyed line adds besides its text. The host counts a drawing's text, Button labels, Select labels and options,
 * Code sources, and the key of each keyed Box (`ln`'s), not a Button's key (measured on 2.1.296, 2026-10-13: Activity
 * at 260 and 300 columns matched the engine's own count exactly). Keys here are under 12 characters.
 */
export const LINE_KEY = 12

/** Characters the host counts for a line: its text's length (a CJK character is one), not its columns. */
export const charsOf = (line: readonly Span[] | string): number =>
  typeof line === 'string' ? line.length : line.reduce((n, s) => n + s.text.length, 0)

export type Budget = {
  /** Characters still free. */
  left: () => number
  spend: (n: number) => void
  /** The lines that fit in order, `reserve` held back for what is drawn after them; a line that does not fit ends the list. */
  take: <T extends readonly Span[] | string>(lines: readonly T[], reserve?: number) => { kept: T[]; dropped: number }
}

/**
 * One drawing's budget, shared by everything a render draws. Past 100 000 characters the host cuts the tree and
 * appends `… N more characters, not drawn`, losing what came last ("more" lines, details); `BUDGET` leaves margin.
 */
export function budget(max = BUDGET): Budget {
  let used = 0
  const left = (): number => Math.max(0, max - used)
  return {
    left,
    spend: n => { used += n },
    take: (lines, reserve = 0) => {
      const room = left() - reserve
      let n = 0
      let size = 0
      for (const l of lines) {
        const c = charsOf(l) + LINE_KEY
        if (size + c > room) break
        size += c
        n++
      }
      used += size
      return { kept: lines.slice(0, n), dropped: lines.length - n }
    },
  }
}

/** Integer percent, right-aligned in 4 columns: `  7%`, ` 41%`, `<1%` for a share above 0 that rounds to 0. */
export const pct = (part: number, whole: number): string => {
  if (whole <= 0) return '  0%'
  const p = Math.round((part / whole) * 100)
  return padStart(part > 0 && p === 0 ? '<1%' : `${p}%`, 4)
}

/** `HH:MM` local time. */
export const hhmm = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Whether any of `ats` falls on another local day than `now`: then times among them carry their date. */
export const dated = (ats: readonly number[], now: number): boolean => ats.some(at => new Date(at).toDateString() !== new Date(now).toDateString())

/** `HH:MM`, or `MM-DD HH:MM` when `withDate`; `seconds` adds `:SS`. */
export const stamp = (at: number, withDate: boolean, seconds = false): string => {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${withDate ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ` : ''}${hhmm(at)}${seconds ? `:${p(d.getSeconds())}` : ''}`
}

/** One time on its own: `HH:MM` today, `MM-DD HH:MM` on another day. */
export const when = (at: number, now: number): string => stamp(at, dated([at], now))
