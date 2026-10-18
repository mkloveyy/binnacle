import type { BinnacleDiffFile, BinnacleTurnPatch, BinnacleWorkspaceDiff } from '../../../types'
import { visible } from '../activity/mask.ts'

export { visible }

/**
 * The working tree against HEAD. `diff-index` never rewrites `.git/index` (`git diff HEAD` refreshes its stat cache),
 * `-M` finds renames as `git diff` does, and the flags pin the output against user config (prefixes, textconv, colour).
 * `core.quotepath=false` keeps non-ASCII paths (e.g. Chinese) unescaped, so they display and match as written.
 */
export const GIT_DIFF: readonly string[] = [
  'git', '--no-optional-locks', '-c', 'core.quotepath=false', 'diff-index', '-p', '-M',
  '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD',
]
/** `--no-optional-locks` keeps status from refreshing the index. */
export const GIT_STATUS: readonly string[] = ['git', '--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain']
/** Under the engine's 100 000 characters per drawing, with room for the rest of the pane. */
export const MAX_SOURCE = 90_000
export const MAX_PATCHES = 2 * 1024 * 1024

export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
export type EditPatch = { file: string; hunks: string[]; added: number; removed: number }
export type ProcLike = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isHunk = (h: unknown): h is Hunk =>
  isRecord(h) && typeof h.oldStart === 'number' && typeof h.oldLines === 'number' && typeof h.newStart === 'number' &&
  typeof h.newLines === 'number' && Array.isArray(h.lines) && h.lines.every(l => typeof l === 'string')

export const hunkText = (h: Hunk): string => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** A hunk replacing all of `before` with `after`. The counts must match the body or `Code` draws plain text (probe Q7). */
export const wholeHunk = (before: string[], after: string[]): string =>
  hunkText({
    oldStart: before.length ? 1 : 0, oldLines: before.length,
    newStart: after.length ? 1 : 0, newLines: after.length,
    lines: [...before.map(l => '-' + l), ...after.map(l => '+' + l)],
  })

function counts(hunks: string[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const l of h.split('\n').slice(1)) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

/** The patch an edit tool's result carries, as hunk texts; null for anything else (a staged edit changed nothing). */
export function patchOf(tool: string, result: unknown): EditPatch | null {
  if (!isRecord(result) || result.staged === true) return null
  if (tool === 'NotebookEdit' && typeof result.notebook_path === 'string' && typeof result.new_source === 'string') {
    const before = typeof result.old_source === 'string' ? splitLines(result.old_source) : []
    const after = splitLines(result.new_source)
    const hunks = before.length || after.length ? [wholeHunk(before, after)] : []
    return { file: result.notebook_path, hunks, ...counts(hunks) }
  }
  if (typeof result.filePath !== 'string' || !Array.isArray(result.structuredPatch)) return null
  if (result.type === 'create' && result.structuredPatch.length === 0 && typeof result.content === 'string') {
    const after = splitLines(result.content)
    const hunks = after.length ? [wholeHunk([], after)] : []
    return { file: result.filePath, hunks, ...counts(hunks) }
  }
  const hunks = result.structuredPatch.filter(isHunk).map(hunkText)
  return { file: result.filePath, hunks, ...counts(hunks) }
}

const unquote = (p: string): string => (p.length > 1 && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p)

function headerPath(line: string): string {
  // `a/<p> b/<p>`: equal halves, so a path holding " b/" is still read whole.
  const rest = line.slice('diff --git '.length)
  const mid = (rest.length - 1) / 2
  if (rest[mid] === ' ' && rest.startsWith('a/') && rest.slice(mid + 1).startsWith('b/') && rest.slice(2, mid) === rest.slice(mid + 3)) return rest.slice(mid + 3)
  const q = line.lastIndexOf(' "b/')
  if (q >= 0) return line.slice(q + 4, -1)
  const i = line.lastIndexOf(' b/')
  return i >= 0 ? line.slice(i + 3) : line.slice('diff --git '.length)
}

/** Splits `git diff` output into files; hunks keep their own header so each one parses alone. */
export function parseGitDiff(stdout: string): BinnacleDiffFile[] {
  const files: BinnacleDiffFile[] = []
  let cur: BinnacleDiffFile | null = null
  let body: string[] | null = null
  const close = (): void => {
    if (cur !== null && body !== null) cur.hunks.push(body.join('\n'))
    body = null
  }
  const lines = stdout.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      close()
      cur = { path: headerPath(line), status: 'M', added: 0, removed: 0, hunks: [], binary: false }
      files.push(cur)
      continue
    }
    if (cur === null) continue
    if (line.startsWith('@@')) {
      close()
      body = [line]
      continue
    }
    if (body !== null) {
      // `diff.suppressBlankEmpty` writes a blank context line as an empty one.
      body.push(line === '' ? ' ' : line)
      if (line.startsWith('+')) cur.added++
      else if (line.startsWith('-')) cur.removed++
      continue
    }
    if (line.startsWith('new file mode')) cur.status = 'A'
    else if (line.startsWith('deleted file mode')) cur.status = 'D'
    else if (line.startsWith('rename to ')) {
      cur.status = 'R'
      cur.path = unquote(line.slice('rename to '.length))
    } else if (line.startsWith('Binary files ')) cur.binary = true
  }
  close()
  return files
}

export const untracked = (stdout: string): BinnacleDiffFile[] =>
  stdout.split('\n').filter(l => l.startsWith('?? ')).map(l => ({ path: unquote(l.slice(3)), status: '?' as const, added: 0, removed: 0, hunks: [], binary: false }))

/** Whether a hunk's body has as many lines as its header counts. */
function complete(hunk: string): boolean {
  const [head = '', ...body] = hunk.split('\n')
  const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(head)
  if (!m) return false
  let old = 0
  let now = 0
  for (const l of body) {
    if (l.startsWith(' ')) { old++; now++ } else if (l.startsWith('-')) old++
    else if (l.startsWith('+')) now++
  }
  return old === Number(m[1] ?? 1) && now === Number(m[2] ?? 1)
}

/** Output cut at 4 MiB: the partial last line goes, and the last hunk with it unless it is whole. */
function dropCut(stdout: string): BinnacleDiffFile[] {
  const files = parseGitDiff(stdout.slice(0, stdout.lastIndexOf('\n') + 1))
  const last = files.at(-1)
  const hunk = last?.hunks.at(-1)
  if (last && hunk !== undefined && !complete(hunk)) {
    last.hunks.pop()
    for (const l of hunk.split('\n').slice(1)) {
      if (l.startsWith('+')) last.added--
      else if (l.startsWith('-')) last.removed--
    }
  }
  return files
}

export function workspaceDiff(diff: ProcLike, status: ProcLike | null): BinnacleWorkspaceDiff {
  const extra = status !== null && status.exitCode === 0 ? untracked(status.stdout) : []
  if (diff.exitCode !== 0) {
    if (/not a git repository/i.test(diff.stderr)) return { kind: 'not-repo' }
    if (/ambiguous argument 'HEAD'|unknown revision/i.test(diff.stderr)) return { kind: 'ok', files: extra, note: 'no commits yet: only untracked files are listed' }
    return { kind: 'error', message: `git diff failed: ${diff.stderr.split('\n')[0] ?? ''}`.trim() }
  }
  const files = diff.isStdoutTruncated ? dropCut(diff.stdout) : parseGitDiff(diff.stdout)
  return {
    kind: 'ok',
    files: [...files, ...extra],
    note: diff.isStdoutTruncated ? 'git diff output was over 4 MiB; the last file may be cut' : null,
  }
}

/** Joins whole hunks, as drawn (`visible`), while they fit; a diff cut mid-hunk would not parse. */
export function capHunks(hunks: string[], max = MAX_SOURCE): { source: string; omitted: number } {
  let source = ''
  let kept = 0
  for (const h of hunks) {
    const add = (source ? '\n' : '') + visible(h)
    if (source.length + add.length > max) break
    source += add
    kept++
  }
  return { source, omitted: hunks.length - kept }
}

export const fileLabel = (f: BinnacleDiffFile): string =>
  f.status === '?' ? `? ${f.path}` : `${f.status} ${f.path} +${f.added} −${f.removed}`

export const relPath = (file: string, cwd: string): string =>
  cwd !== '' && file.startsWith(cwd + '/') ? file.slice(cwd.length + 1) : file

export function keepPatches(list: BinnacleTurnPatch[], add: BinnacleTurnPatch, max = MAX_PATCHES): BinnacleTurnPatch[] {
  const out = [...list, add]
  let size = out.reduce((n, p) => n + p.source.length, 0)
  while (out.length > 1 && size > max) size -= out.shift()?.source.length ?? 0
  return out
}
