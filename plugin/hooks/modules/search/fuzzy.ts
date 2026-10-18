import type { BinnacleActivitySession } from '../../../types'
import { turnNumbers } from '../activity/events.ts'
import { brief } from '../activity/mask.ts'
import { cutSpans, padEnd, padStart, stamp, type Span } from '../ui/cols.ts'
import { ROLE } from '../ui/theme.ts'
import type { SearchEntry, SearchRole } from './transcript.ts'
import { normOf, normalize } from './transcript.ts'

/** Below this many characters a query does not search. Results drawn at most. Subsequence matching fills in below this many hits. */
export const MIN_QUERY = 2
export const MAX_RESULTS = 400
/** Characters a query keeps. */
export const MAX_QUERY = 200
export const DEBOUNCE_MS = 300
/** Search as you type: P1 #7 measured 4–27 ms on 20 000 entries. Were it over 100 ms, searching would wait for Enter (onInput only keeping the text). */
export const SEARCH_ON_TYPE = true
/**
 * The subsequence tier looks at the newest this many entries: a term of common letters (`eeeeee`) costs a window scan
 * at every occurrence of its first letter (B12 review M3). Both tiers stop SEARCH_MS after the search began, by the
 * clock the caller gives (register.tsx: the plugin's `performance.now`), read once every CHECK_EVERY entries. A term
 * looks at its first MAX_OCCURRENCES places in a text. Design values.
 */
export const SUBSEQUENCE_SCAN = 5_000
export const SEARCH_MS = 50
export const CHECK_EVERY = 16
export const MAX_OCCURRENCES = 32

/** A synchronous clock and the time to stop at, in its units. */
export type Deadline = { now: () => number; until: number }
/** Your prompt's row comes before its turn-start: the next turn within this long that saved the same text, or any within the shorter. */
export const PROMPT_LEAD_MS = 5_000
export const PROMPT_NEAR_MS = 2_000

export type Hit = { entry: SearchEntry; score: number; start: number; end: number }

/** Words of a query, lower case, each once; text in double quotes is one phrase. */
export function terms(query: string): string[] {
  const out: string[] = []
  for (const m of normalize(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? '').trim()
    if (t !== '' && !out.includes(t)) out.push(t)
  }
  return out
}

const WORD = /[a-z0-9_]/
const isAsciiWord = (t: string): boolean => /^[\x20-\x7e]+$/.test(t)

/**
 * One term against one normalized text (§6.3): whole word 4, start of a word 3, substring 2, else (ASCII terms of 3
 * or more characters, the span at most three times the term) subsequence 1 × length / span. 0 when absent.
 * Returns the score and where the first best hit is.
 */
export function scoreTerm(term: string, text: string, subsequence: boolean): { score: number; start: number; end: number } {
  let best = { score: 0, start: -1, end: -1 }
  for (let i = text.indexOf(term), n = 0; i >= 0 && n < MAX_OCCURRENCES; i = text.indexOf(term, i + 1), n++) {
    const before = i === 0 || !WORD.test(text[i - 1] ?? '')
    const after = i + term.length >= text.length || !WORD.test(text[i + term.length] ?? '')
    const s = before && after ? 4 : before ? 3 : 2
    if (s > best.score) best = { score: s, start: i, end: i + term.length }
    if (s === 4) break
  }
  if (best.score > 0 || !subsequence || term.length < 3 || !isAsciiWord(term)) return best
  for (let from = text.indexOf(term[0] as string); from >= 0; from = text.indexOf(term[0] as string, from + 1)) {
    let j = 0
    let k = from
    for (; k < text.length && j < term.length && k - from < term.length * 3; k++) if (text[k] === term[j]) j++
    if (j === term.length) {
      const span = k - from
      const s = term.length / span
      if (s > best.score) best = { score: s, start: from, end: k }
    }
  }
  return best
}

/**
 * Every entry holding all terms, best first (role `you` +0.5), newer first on ties; entries from the newest down, until
 * the deadline when given, and how many of the newest entries it looked at before the deadline cut it (`cut`).
 */
function rank(entries: readonly SearchEntry[], query: string, subsequence: boolean, deadline?: Deadline): { hits: Hit[]; searched: number; cut: boolean } {
  const ts = terms(query)
  if (ts.length === 0) return { hits: [], searched: 0, cut: false }
  const hits: Hit[] = []
  let searched = entries.length
  for (let i = entries.length - 1; i >= 0; i--) {
    if (deadline && (entries.length - 1 - i) % CHECK_EVERY === 0 && deadline.now() > deadline.until) {
      searched = entries.length - 1 - i
      break
    }
    const entry = entries[i] as SearchEntry
    let score = 0
    let first: { start: number; end: number } | null = null
    for (const t of ts) {
      const r = scoreTerm(t, normOf(entry), subsequence)
      if (r.score === 0) {
        score = 0
        break
      }
      score += r.score
      if (first === null || r.start < first.start) first = { start: r.start, end: r.end }
    }
    if (score > 0 && first) hits.push({ entry, score: score + (entry.role === 'you' ? 0.5 : 0), start: first.start, end: first.end })
  }
  return { hits: hits.sort((a, b) => b.score - a.score || b.entry.at - a.entry.at), searched, cut: searched < entries.length }
}

/** A search's hits and, when the deadline cut a tier, which one and how many of the newest entries it looked at. */
export type Scan = { hits: Hit[]; cut: { tier: 'substring' | 'subsequence'; searched: number } | null }

/**
 * Substring tiers first; the subsequence tier only when they found fewer than MAX_RESULTS (§6.3), over the newest
 * SUBSEQUENCE_SCAN entries. One deadline for both (the substring tier's time is taken out of the subsequence
 * tier's); none when the caller gives none. Says whether the deadline cut it short.
 */
export function scan(entries: readonly SearchEntry[], query: string, deadline?: Deadline): Scan {
  if (normalize(query).length < MIN_QUERY) return { hits: [], cut: null }
  const plain = rank(entries, query, false, deadline)
  if (plain.cut) return { hits: plain.hits, cut: { tier: 'substring', searched: plain.searched } }
  if (plain.hits.length >= MAX_RESULTS) return { hits: plain.hits, cut: null }
  const seen = new Set(plain.hits.map(h => h.entry))
  const loose = rank(entries.slice(-SUBSEQUENCE_SCAN), query, true, deadline)
  return { hits: [...plain.hits, ...loose.hits.filter(h => !seen.has(h.entry))], cut: loose.cut ? { tier: 'subsequence', searched: loose.searched } : null }
}

/** The info line's note when the deadline cut the search: the results come from part of the index. */
export function stoppedNote(cut: Scan['cut']): string | null {
  if (cut === null) return null
  const n = cut.searched.toLocaleString('en-US')
  return cut.tier === 'substring' ? `stopped early · newest ${n} rows searched` : `stopped early · close matches from the newest ${n} rows`
}

/**
 * The piece of `norm` around the hit that fits `width` columns (one column per character: the snippet is cut by
 * characters; the drawing clips the line again), with `…` where it was cut.
 */
export function snippet(norm: string, start: number, end: number, width: number): { before: string; hit: string; after: string } {
  const hit = norm.slice(start, end).slice(0, Math.max(1, width - 2))
  const room = Math.max(0, width - hit.length)
  const left = Math.min(start, Math.floor(room / 2))
  const from = start - left
  const to = Math.min(norm.length, start + hit.length + (room - left))
  return {
    before: (from > 0 ? '…' : '') + norm.slice(from > 0 ? from + 1 : from, start),
    hit,
    after: norm.slice(start + hit.length, to < norm.length ? to - 1 : to) + (to < norm.length ? '…' : ''),
  }
}

/**
 * The turn a transcript row belongs to: the last turn-start at or before it in the session's Activity record. Your
 * prompt (`prompt`) is written before its turn starts (about 0.3 s in a real session, longer with prompt hooks), so it
 * belongs to the first turn to start after it: within PROMPT_LEAD_MS when that turn saved the same text (`brief`, as
 * startTurn saves it), within PROMPT_NEAR_MS whatever it saved (a pasted image, a command's expansion).
 */
export function turnAt(s: BinnacleActivitySession | null, at: number, prompt?: string): { turnId: string; n: number } | null {
  if (!s) return null
  const nums = turnNumbers(s)
  if (prompt !== undefined) {
    const next = s.events.find(ev => ev.kind === 'turn-start' && ev.at >= at)
    const gap = next ? next.at - at : Infinity
    if (next?.kind === 'turn-start' && gap <= PROMPT_LEAD_MS && (gap < PROMPT_NEAR_MS || next.prompt === brief(prompt))) return { turnId: next.turnId, n: nums.get(next.turnId) ?? 0 }
  }
  let hit: { turnId: string; n: number } | null = null
  for (const ev of s.events) {
    if (ev.kind !== 'turn-start' || ev.at > at) continue
    hit = { turnId: ev.turnId, n: nums.get(ev.turnId) ?? 0 }
  }
  return hit
}

export type HitView = { at: number; turnId: string | null; n: number | null; prompt: string | null; role: SearchRole; text: string; start: number; end: number }

/** The hit's offsets are in `norm`; the row shows `text` unless lower-casing changed the length (`İ`), which would shift them. */
export const toView = (h: Hit, s: BinnacleActivitySession | null): HitView => {
  const t = turnAt(s, h.entry.at, h.entry.role === 'you' ? h.entry.text : undefined)
  const norm = normOf(h.entry)
  const text = h.entry.text.length === norm.length ? h.entry.text : norm
  const started = t && s ? s.events.find(ev => ev.kind === 'turn-start' && ev.turnId === t.turnId) : undefined
  const prompt = started?.kind === 'turn-start' ? started.prompt : null
  return { at: h.entry.at, turnId: t?.turnId ?? null, n: t?.n ?? null, prompt, role: h.entry.role, text, start: h.start, end: h.end }
}

/** One result row (§4.11): time, turn, role, then the snippet around the first hit, the hit in `suggestion` bold. */
export function resultLine(v: HitView, width: number, withDate = false): Span[] {
  const lead = `${stamp(v.at, withDate)}  ${padStart(v.n === null ? '#—' : `#${v.n}`, 4)}  ${padEnd(v.role, 8)}`
  const sn = snippet(v.text, v.start, v.end, Math.max(4, width - lead.length))
  // The snippet is cut by characters; a wide (CJK) character takes two columns, so the row is cut again by columns.
  return cutSpans([
    { text: lead, color: ROLE.dim },
    { text: sn.before },
    { text: sn.hit, color: ROLE.focus, bold: true },
    { text: sn.after },
  ].filter(s => s.text !== ''), width)
}
