import { summarize } from '../guard/ask.ts'
import { clip, mask, visible } from '../activity/mask.ts'

/** Bytes per read: under process.run's 4 MiB stdout cap (index.d.ts:8040). Design value. */
export const CHUNK = 3 * 1024 * 1024
/** The first index reads only the newest this many bytes. Design value. */
export const FIRST_WINDOW = 24 * 1024 * 1024
/** Entries kept per session (oldest dropped) and characters per entry. Design values. */
export const MAX_ENTRIES = 20_000
export const MAX_TEXT = 2_000
/** Characters an index holds at most (text and norm), oldest entries dropped first. Design value (B12 review). */
export const MAX_CHARS = 32_000_000

/**
 * Reads `length` bytes at byte `offset`, read-only: perl opens the file for reading, seeks, reads one block and prints
 * it. Fixed argv, no shell: the path and the numbers are arguments (`$ARGV[0]`–`$ARGV[2]`) after `--`, so a path starting with `-` is never a perl switch.
 * perl, not `tail -c +N | head -c M`: macOS `head -c` costs about 35 ms a MiB (P1 #7, #8: 24 MiB in 0.2 s, not 1.1–2.5 s).
 */
export const readArgv = (path: string, offset: number, length: number): string[] =>
  ['perl', '-e', 'open(my $f, "<", $ARGV[0]) or exit 1; binmode $f; seek($f, $ARGV[1], 0); read($f, my $b, $ARGV[2]); binmode STDOUT; print $b', '--', path, String(offset), String(length)]

/** UTF-8 byte length of a string, without encoders (pure). */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/**
 * Whole lines of one chunk read at a line start: only through the last newline (a transcript line always ends in
 * one, so a line still being written is left for the next read). `consumed` counts those bytes, so the next read
 * starts at a line start and never inside a multi-byte character. `skipFirst`: the read began inside a line (the
 * first window, or the rest of a line too long to index), so the text before the first newline is dropped.
 * A chunk with no usable newline sets `noBreak`: the caller skips ahead (a full chunk) or waits (the file's end).
 */
export function splitChunk(text: string, skipFirst = false): { lines: string[]; consumed: number; noBreak: boolean } {
  const start = skipFirst ? text.indexOf('\n') + 1 : 0
  const last = text.lastIndexOf('\n')
  if ((skipFirst && start === 0) || last < 0) return { lines: [], consumed: 0, noBreak: true }
  const lines = last >= start ? text.slice(start, last).split('\n').filter(l => l !== '') : []
  // A read that began inside a multi-byte character decodes each stray byte (at most 3) as one U+FFFD: one byte, not three.
  const stray = skipFirst ? (/^�{1,3}/.exec(text)?.[0].length ?? 0) : 0
  return { lines, consumed: utf8Length(text.slice(0, last + 1)) - 2 * stray, noBreak: false }
}

/** `meta`: a user-side row the person did not type (`isMeta`: a skill's text, a command's caveat). */
export type SearchRole = 'you' | 'claude' | 'tool' | 'result' | 'summary' | 'meta'
/** `norm` only when it differs from `text` (memory: most of an index is lower case already or nearly). */
export type SearchEntry = { at: number; role: SearchRole; text: string; norm?: string; uuid: string; sidechain: boolean }

/** What matching runs on. */
export const normOf = (e: SearchEntry): string => e.norm ?? e.text

/** Lower case, whitespace collapsed: what matching runs on. */
export const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** Masked first, then control characters made visible, then clipped: the index holds only what may be drawn (§6.5). */
const entry = (at: number, role: SearchRole, raw: string, uuid: string, sidechain: boolean): SearchEntry | null => {
  const text = clip(visible(mask(raw.replace(/\s+/g, ' ').trim())), MAX_TEXT)
  if (text === '') return null
  const norm = normalize(text)
  return norm === text ? { at, role, text, uuid, sidechain } : { at, role, text, norm, uuid, sidechain }
}

const blockText = (content: unknown): string =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(b => (typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join(' ')
    : ''

/** The searchable texts of one transcript line (§6.2); other row types (attachments, cost-state, …) give none. */
export function entriesOf(line: string): SearchEntry[] {
  let row: Record<string, unknown>
  try {
    row = JSON.parse(line) as Record<string, unknown>
  } catch {
    return []
  }
  if (row.type !== 'user' && row.type !== 'assistant') return []
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
  if (!Number.isFinite(at)) return []
  const uuid = typeof row.uuid === 'string' ? row.uuid : ''
  const side = row.isSidechain === true
  const message = (typeof row.message === 'object' && row.message !== null ? row.message : {}) as { content?: unknown }
  const content = message.content
  const out: (SearchEntry | null)[] = []
  if (row.type === 'user') {
    // isMeta: the host's flag for a user-side row the person did not type (SessionAppendMessage.isMeta, index.d.ts).
    const own: SearchRole = row.isCompactSummary === true ? 'summary' : row.isMeta === true ? 'meta' : 'you'
    if (typeof content === 'string') out.push(entry(at, own, content, uuid, side))
    else if (Array.isArray(content)) {
      for (const b of content as Record<string, unknown>[]) {
        if (b?.type === 'text') out.push(entry(at, own, String(b.text ?? ''), uuid, side))
        else if (b?.type === 'tool_result') out.push(entry(at, 'result', blockText(b.content), uuid, side))
      }
    }
  } else if (Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (b?.type === 'text') out.push(entry(at, 'claude', String(b.text ?? ''), uuid, side))
      else if (b?.type === 'tool_use') {
        const name = String(b.name ?? 'tool')
        const input = (typeof b.input === 'object' && b.input !== null ? b.input : {}) as Record<string, unknown>
        out.push(entry(at, 'tool', `${name} · ${summarize(name, input)}`, uuid, side))
      }
    }
  }
  return out.filter((e): e is SearchEntry => e !== null)
}

const charsOf = (e: SearchEntry): number => e.text.length + (e.norm?.length ?? 0)

/** Appends and keeps the newest: at most `max` entries and `maxChars` characters (text and norm). */
export const keepNewest = (list: SearchEntry[], add: SearchEntry[], max = MAX_ENTRIES, maxChars = MAX_CHARS): SearchEntry[] => {
  const all = list.concat(add)
  let from = Math.max(0, all.length - max)
  let chars = 0
  for (let i = all.length - 1; i >= from; i--) {
    chars += charsOf(all[i] as SearchEntry)
    if (chars > maxChars) {
      from = i + 1
      break
    }
  }
  return from > 0 ? all.slice(from) : all
}

/** `24 MB`, `101 MB`, `850 KB`. */
export const sizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
