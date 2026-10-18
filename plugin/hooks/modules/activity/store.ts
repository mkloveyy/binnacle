import type { BinnacleActivityIndexEntry, BinnacleActivitySession } from '../../../types'

type Session = BinnacleActivitySession
type Entry = BinnacleActivityIndexEntry

export const INDEX_KEY = 'activity:index'
export const sessionKey = (id: string): string => `activity:${id}`
/** One session's record at most, in UTF-8 bytes: `$.fs` refuses a read or write over 4 MiB, and this leaves room. */
export const SESSION_MAX = 3 * 1024 * 1024
/** All saved sessions at most, in UTF-8 bytes: past it the oldest go; the current session is never dropped for it. */
export const TOTAL_MAX = 100 * 1024 * 1024
/** Saved sessions at most: the session list stays short, and many small sessions (`claude -p`) still turn over. */
export const INDEX_MAX = 500
/** Saved sessions started longer ago than this go. */
export const AGE_MAX = 90 * 24 * 60 * 60 * 1000

/** UTF-8 bytes of a value's JSON text, as it is saved: the unit `$.fs`'s 4 MiB limit counts in (a CJK character is 3). */
export const sizeOf = (v: unknown): number => {
  const t = JSON.stringify(v)
  let n = 0
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++ }
    else n += 3
  }
  return n
}

const KEEP = new Set(['turn-start', 'turn-end', 'agent-start', 'agent-end', 'compact'])

/** Drops the oldest one-off events (perm, guard, error, edit) until the session fits; turns, agents, compactions and counts stay. */
export function prune(s: Session, max = SESSION_MAX): Session {
  let size = sizeOf(s)
  if (size <= max) return s
  const drop = new Set<number>()
  for (let i = 0; i < s.events.length && size > max; i++) {
    const ev = s.events[i]
    if (!ev || KEEP.has(ev.kind)) continue
    drop.add(i)
    size -= sizeOf(ev) + 1
  }
  return { ...s, events: s.events.filter((_, i) => !drop.has(i)) }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type Check = (v: unknown) => boolean
const str: Check = v => typeof v === 'string'
const num: Check = v => typeof v === 'number'
const bool: Check = v => typeof v === 'boolean'
const orNull = (f: Check): Check => v => v === null || f(v)
const lines: Check = v => Array.isArray(v) && v.every(str)

/** The fields each kind of event is drawn from; one missing or of the wrong type drops the event, not the session. */
const FIELDS: Record<Session['events'][number]['kind'], Record<string, Check>> = {
  'turn-start': { prompt: str },
  'turn-end': { durationMs: num, costUsd: orNull(num), aborted: bool },
  'agent-start': { agentType: str, model: str, task: str, parentAgentId: orNull(str), background: bool },
  'agent-end': { durationMs: num, tokensIn: orNull(num), tokensOut: orNull(num), aborted: bool, report: lines },
  perm: { tool: str, summary: str, decision: str, decider: str, outcome: orNull(str) },
  guard: { ruleId: str, action: str, summary: str },
  error: { tool: str, summary: str, message: str },
  edit: { tool: str, file: str, added: num, removed: num },
  compact: { trigger: str, tokensBefore: orNull(num), tokensAfter: orNull(num), durationMs: num },
}

const isEvent = (ev: unknown): boolean => {
  if (!isRecord(ev) || !num(ev.at) || !str(ev.turnId) || !orNull(str)(ev.agentId) || !str(ev.kind)) return false
  const fields = Object.hasOwn(FIELDS, ev.kind as string) ? FIELDS[ev.kind as keyof typeof FIELDS] : null
  return fields !== null && Object.entries(fields).every(([k, ok]) => ok(ev[k]))
}

const isCount = (c: unknown): boolean => isRecord(c) && str(c.turnId) && orNull(str)(c.agentId) && num(c.files) && num(c.shell) && num(c.other)

/** How soon after a spawn Claude Code 2.1.299–2.1.300 fired the subagent's own turn.start (seen 10–150 ms). */
const AGENT_TURN_MS = 1_000

/**
 * Records made before 0.5.0 on Claude Code 2.1.299–2.1.300 hold a turn.start per subagent: its own loop's, just after
 * the spawn, never ended. Each goes (at most one per spawn), and what binnacle put under it (main's calls, taken for
 * "this turn") goes back to the turn before it. A record with none is returned as it is.
 */
export function repairAgentTurns(s: Session): Session {
  const ended = new Set(s.events.filter(e => e.kind === 'turn-end').map(e => e.turnId))
  const spawns: number[] = []
  const home = new Map<string, string>()
  let kept: string | null = null
  for (const ev of s.events) {
    if (ev.kind === 'agent-start') spawns.push(ev.at)
    if (ev.kind !== 'turn-start') continue
    const i = ev.auto === true || ended.has(ev.turnId) || kept === null ? -1 : spawns.findIndex(at => ev.at >= at && ev.at - at <= AGENT_TURN_MS)
    if (i < 0) {
      kept = ev.turnId
      continue
    }
    spawns.splice(i, 1)
    home.set(ev.turnId, kept as string)
  }
  if (home.size === 0) return s
  const to = (id: string): string => home.get(id) ?? id
  const events = s.events
    .filter(e => !(e.kind === 'turn-start' && home.has(e.turnId)))
    .map(e => (home.has(e.turnId) ? { ...e, turnId: to(e.turnId) } : e))
  const merged = new Map<string, Session['counts'][number]>()
  for (const c of s.counts) {
    const turnId = to(c.turnId)
    const key = `${turnId}\u0000${c.agentId ?? ''}`
    const prev = merged.get(key)
    merged.set(key, prev ? { ...prev, files: prev.files + c.files, shell: prev.shell + c.shell, other: prev.other + c.other } : { ...c, turnId })
  }
  return { ...s, events, counts: [...merged.values()] }
}

export function normalizeSession(raw: unknown): Session | null {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.sessionId !== 'string' || typeof raw.startedAt !== 'number') return null
  if (!Array.isArray(raw.events) || !Array.isArray(raw.counts)) return null
  const events = raw.events.filter(isEvent) as Session['events']
  const counts = raw.counts.filter(isCount) as Session['counts']
  return repairAgentTurns({
    version: 1,
    sessionId: raw.sessionId,
    startedAt: raw.startedAt,
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : null,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    firstPrompt: typeof raw.firstPrompt === 'string' ? raw.firstPrompt : '',
    events,
    counts,
  })
}

/** Entries without an id, a start time or a size are dropped (a size-less one is listed again from the files); the rest get defaults. */
export const normalizeIndex = (raw: unknown): Entry[] =>
  Array.isArray(raw)
    ? raw.filter(x => isRecord(x) && str(x.sessionId) && num(x.startedAt) && num(x.bytes)).map((x: Record<string, unknown>) => ({
        sessionId: x.sessionId as string,
        startedAt: x.startedAt as number,
        endedAt: num(x.endedAt) ? (x.endedAt as number) : null,
        cwd: str(x.cwd) ? (x.cwd as string) : '',
        firstPrompt: str(x.firstPrompt) ? (x.firstPrompt as string) : '',
        bytes: x.bytes as number,
      }))
    : []

export const entryOf = (s: Session, bytes: number): Entry =>
  ({ sessionId: s.sessionId, startedAt: s.startedAt, endedAt: s.endedAt, cwd: s.cwd, firstPrompt: s.firstPrompt, bytes })

export const upsertIndex = (index: Entry[], entry: Entry): Entry[] => [...index.filter(x => x.sessionId !== entry.sessionId), entry]

export const hasTurn = (s: Session): boolean => s.events.some(ev => ev.kind === 'turn-start')

/** When a record was last written to: its end, or its last event, whichever is later (0 for one that is not a record). */
export const lastAt = (raw: unknown): number => {
  const s = normalizeSession(raw)
  return s ? Math.max(s.endedAt ?? 0, s.events.at(-1)?.at ?? 0, s.startedAt) : 0
}

/** Saved sessions the index does not list (a save that failed half way, two processes saving at once), each once. */
export const unlisted = (ids: readonly string[], index: Entry[], currentId: string): string[] => {
  const listed = new Set([currentId, ...index.map(x => x.sessionId)])
  return [...new Set(ids)].filter(id => !listed.has(id))
}

/** The session ids of `activity:<id>` store keys, the index left out: records saved before they moved to files. */
export const storeIds = (keys: readonly string[]): string[] =>
  keys.filter(k => k.startsWith('activity:') && k !== INDEX_KEY).map(k => k.slice('activity:'.length))

/**
 * Sessions started before `now - maxAge` go, then the oldest until at most `maxEntries` are kept and their sizes add
 * up to at most `maxBytes`; the current session is never dropped.
 */
export function evict(index: Entry[], currentId: string, now: number, maxAge = AGE_MAX, maxEntries = INDEX_MAX, maxBytes = TOTAL_MAX): { keep: Entry[]; drop: string[] } {
  const cutoff = now - maxAge
  let count = index.length
  let bytes = index.reduce((n, x) => n + x.bytes, 0)
  const drop: string[] = []
  for (const x of [...index].sort((a, b) => a.startedAt - b.startedAt)) {
    if (x.startedAt >= cutoff && count <= maxEntries && bytes <= maxBytes) break
    if (x.sessionId === currentId) continue
    drop.push(x.sessionId)
    count--
    bytes -= x.bytes
  }
  const dropped = new Set(drop)
  return { keep: index.filter(x => !dropped.has(x.sessionId)), drop }
}
