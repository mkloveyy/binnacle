import type { BinnacleActivitySession, BinnacleBoundary, BinnacleCompactions } from '../../../types'
import { elapsed, tokens } from '../../core/format.ts'
import { dated, flat, padEnd, stamp, when, type Row } from '../ui/cols.ts'
import { ROLE } from '../ui/theme.ts'

/** One `compact_boundary` row of a transcript (v0.3 probe M2/M3): its `uuid` names it across forks. */
export type Boundary = BinnacleBoundary

/** Where Claude Code keeps a session's transcript (undocumented, probe M2): the cwd's realpath with every character outside `[A-Za-z0-9-]` made `-`. */
export const slugOf = (realCwd: string): string => realCwd.replace(/[^A-Za-z0-9-]/g, '-')
export const transcriptPath = (home: string, realCwd: string, sessionId: string): string => `${home}/.claude/projects/${slugOf(realCwd)}/${sessionId}.jsonl`

/** Fixed argv, no shell: only the boundary rows come back (the JSON is compact; a user's text holding the same words is escaped). */
export const grepBoundaries = (path: string): string[] => ['grep', '-F', '"subtype":"compact_boundary"', path]
/** The undocumented back-links a fork or a hand-off copies in (probe M2). */
export const grepSessionIds = (path: string): string[] => ['grep', '-oE', '"session_id":"[0-9a-f-]{36}"', path]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseBoundaries(stdout: string): Boundary[] {
  const out: Boundary[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (row.subtype !== 'compact_boundary' || typeof row.uuid !== 'string') continue
    const meta = (typeof row.compactMetadata === 'object' && row.compactMetadata !== null ? row.compactMetadata : {}) as Record<string, unknown>
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
    // A row with no readable time could never be paired with its live compaction, which would then count twice.
    if (!Number.isFinite(at) || at <= 0) continue
    out.push({
      uuid: row.uuid, at, trigger: typeof meta.trigger === 'string' ? meta.trigger : 'unknown',
      pre: num(meta.preTokens), post: num(meta.postTokens), durationMs: num(meta.durationMs),
    })
  }
  return out
}

/** The session ids of rows copied from another session, other than this one (they point at a predecessor). */
export function foreignIds(stdout: string, selfId: string): string[] {
  const ids = new Set<string>()
  for (const m of stdout.matchAll(/"session_id":"([0-9a-f-]{36})"/g)) if (m[1] !== selfId) ids.add(m[1] as string)
  return [...ids]
}

export type FileHistory = { boundaries: Boundary[]; predecessors: string[] }
export type Lineage = { boundaries: Boundary[]; sessions: number; missing: boolean }

/**
 * Compactions across a fork chain (probe M2's algorithm): this file's boundaries, then each predecessor's, at most
 * `maxHops` files, every id read once, all boundaries de-duplicated by `uuid` (a fork copies the last one in).
 * `read` answers null for a file that is gone or unreadable; a predecessor that is not found, or not read because
 * the cap was reached, sets `missing`.
 */
export async function lineage(selfId: string, read: (id: string) => Promise<FileHistory | null>, maxHops = 10): Promise<Lineage> {
  const seen = new Set<string>()
  const byUuid = new Map<string, Boundary>()
  let queue = [selfId]
  let missing = false
  let sessions = 0
  while (queue.length && seen.size < maxHops) {
    const next: string[] = []
    for (const id of queue) {
      if (seen.has(id)) continue
      if (seen.size >= maxHops) {
        missing = true
        continue
      }
      seen.add(id)
      const file = await read(id)
      if (!file) {
        if (id !== selfId) missing = true
        continue
      }
      sessions++
      for (const b of file.boundaries) if (!byUuid.has(b.uuid)) byUuid.set(b.uuid, b)
      for (const p of file.predecessors) if (!seen.has(p)) next.push(p)
    }
    queue = next
  }
  if (queue.some(id => !seen.has(id))) missing = true
  return { boundaries: [...byUuid.values()].sort((a, b) => a.at - b.at), sessions, missing }
}

export type CompactSummary = { count: number; auto: number; manual: number; last: Boundary | null; recent: Boundary[] }

/** Counts and the newest five, newest first. */
export function summarize(list: readonly Boundary[], keep = 5): CompactSummary {
  const sorted = [...list].sort((a, b) => b.at - a.at)
  return {
    count: list.length,
    auto: list.filter(b => b.trigger === 'auto').length,
    manual: list.filter(b => b.trigger === 'manual').length,
    last: sorted[0] ?? null,
    recent: sorted.slice(0, keep),
  }
}

export type CompactView = { list: Boundary[]; scope: 'record' | 'file' | 'lineage'; copied: boolean; sessions: number; missing: boolean }

/**
 * The compactions binnacle recorded live in this session, as boundaries. `mainOnly` leaves out a sub-agent's: its
 * boundary row is written to another file, so it would never be matched in this one.
 */
function recorded(s: BinnacleActivitySession | null, mainOnly = false): Boundary[] {
  const list: Boundary[] = []
  s?.events.forEach((ev, i) => {
    if (ev.kind === 'compact' && !(mainOnly && ev.agentId !== null)) list.push({ uuid: `ev:${i}`, at: ev.at, trigger: ev.trigger, pre: ev.tokensBefore, post: ev.tokensAfter, durationMs: ev.durationMs })
  })
  return list
}

/** Clock leeway when a live compaction is matched to its boundary row. */
const SLACK_MS = 2_000

/**
 * `list` with the live compactions it does not hold yet. Claude Code writes the boundary row behind: a read just after
 * session.compact settles does not see it (2.1.296, 2026-10-13: ⇣1 after the second /compact, two rows in the file a
 * moment later). The row is written while core's `next` runs, so a live one is in the file when a row lies in
 * [at − durationMs, at]. Each row pairs with one live compaction, oldest first: two run back to back share a window.
 */
function withRecorded(list: Boundary[], live: Boundary[]): Boundary[] {
  const used = new Set<Boundary>()
  const behind = [...live].sort((a, b) => a.at - b.at).filter(ev => {
    const row = list.find(b => !used.has(b) && b.at >= ev.at - (ev.durationMs ?? 0) - SLACK_MS && b.at <= ev.at + SLACK_MS)
    if (row) used.add(row)
    return row === undefined
  })
  return [...list, ...behind]
}

/**
 * What the Overview counts (§5.2–5.4): the fork chain when the setting is on and it was read, else this transcript
 * file, else (no transcript found) the compactions binnacle recorded live in this session. The file's counts take in
 * the live compactions whose rows are not written yet.
 */
export function compactView(c: BinnacleCompactions | null, s: BinnacleActivitySession | null): CompactView {
  const live = recorded(s, true)
  if (c && s && c.sessionId === s.sessionId && c.lineage) return { list: withRecorded(c.lineage.boundaries, live), scope: 'lineage', copied: false, sessions: c.lineage.sessions, missing: c.lineage.missing }
  if (c && s && c.sessionId === s.sessionId && c.found) return { list: withRecorded(c.file, live), scope: 'file', copied: c.copied, sessions: 1, missing: false }
  return { list: recorded(s), scope: 'record', copied: false, sessions: 1, missing: false }
}

/** `2 in this file · 2 auto · last 14:02`, with the copy and lineage notes (§5.2, §5.3). */
export function compactHeading(v: CompactView, now: number): string {
  const sum = summarize(v.list)
  const count = v.scope === 'lineage' ? `${sum.count} across ${v.sessions} session${v.sessions === 1 ? '' : 's'}${v.missing ? ' · earlier sessions not found' : ''}`
    : v.scope === 'file' ? `${sum.count} in this file${v.copied && sum.count > 0 ? ' (1 may be copied from the session it came from)' : ''}`
    : `${sum.count} this session`
  const kinds = [sum.auto ? `${sum.auto} auto` : '', sum.manual ? `${sum.manual} manual` : ''].filter(Boolean)
  return [count, ...kinds, ...(sum.last ? [`last ${when(sum.last.at, now)}`] : [])].join(' · ')
}

/** The newest five as rows: time (with the date when one is not today), trigger, tokens before → after, how long. */
export function compactRows(v: CompactView, now: number): Row[] {
  const recent = summarize(v.list).recent
  const withDate = dated(recent.map(b => b.at), now)
  return recent.map(b => ({
    lead: [{ text: `${stamp(b.at, withDate)}  `, color: ROLE.dim }, { text: padEnd(flat(b.trigger), 8) }],
    nums: [
      [{ text: b.pre === null ? '—' : tokens(b.pre) }],
      [{ text: '→', color: ROLE.dim }],
      [{ text: b.post === null ? '—' : tokens(b.post) }],
      [{ text: b.durationMs === null ? '—' : elapsed(b.durationMs) }],
    ],
  }))
}
