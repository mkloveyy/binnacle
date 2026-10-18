// Best-effort shell lexer for guard rules. Quotes (including ANSI-C $'...'), escapes, comments,
// heredoc bodies, subshells, `$(...)` and backticks are honoured. Variables, aliases and globs
// are not expanded. Arithmetic `((...))` is never read as a heredoc. Command substitution
// inside double quotes is split out as its own command, the enclosing command is kept whole.

export type Segment = { text: string; start: number; end: number }
/**
 * `depth` is 0 for a command written on the line itself, more for one parsed out of `bash -c`, `eval`, `su -c` or `$(...)`.
 * `heads` are the wrapper commands (and shell keywords) stripped before the command; `assigns` the `NAME=value` words stripped.
 */
export type Cmd = { text: string; words: string[]; depth: number; heads: string[]; assigns: string[] }

/** Head word of a segment that only assigns variables (`GIT_DIR=x;`): kept so later commands can see the change; no rule matches it. */
export const ASSIGNMENTS = '(assignments)'

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '\n', '(', ')', '`']

// Index of the ')' closing the '(' at `open`, skipping quoted text; text.length if unclosed.
function closeParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') { i++; continue }
    if (c === '"' || c === "'") {
      const e = text.indexOf(c, i + 1)
      if (e === -1) return text.length
      i = e
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return text.length
}

export function segments(line: string): Segment[] {
  const out: Segment[] = []
  let quote: '"' | "'" | "$'" | null = null
  let start = 0
  const heredocs: { delim: string; strip: boolean }[] = []
  const arith: [number, number][] = []

  const push = (end: number) => {
    const raw = line.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text !== '') out.push({ text, start: start + lead, end: start + lead + text.length })
  }

  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote === "$'") { if (c === '\\') i++; else if (c === "'") quote = null; continue }
    if (quote === "'") { if (c === "'") quote = null; continue }
    if (c === '\\') { i++; continue }
    if (quote === '"') { if (c === '"') quote = null; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '$' && line[i + 1] === "'") { quote = "$'"; i++; continue }

    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      push(i)
      while (i < line.length && line[i] !== '\n') i++
      start = i
      i--
      continue
    }

    if (c === '(' && line[i + 1] === '(') arith.push([i, closeParen(line, i)])

    if (c === '<' && line.startsWith('<<', i) && !line.startsWith('<<<', i) && !arith.some(([a, b]) => i > a && i < b)) {
      let j = i + 2
      const strip = line[j] === '-'
      if (strip) j++
      while (line[j] === ' ' || line[j] === '\t') j++
      const m = /^(['"]?)([A-Za-z0-9_.-]+)\1/.exec(line.slice(j))
      if (m) heredocs.push({ delim: m[2], strip })
      continue
    }

    const op = OPERATORS.find(o => line.startsWith(o, i))
    if (op === undefined) continue
    if (op === '&' && (line[i - 1] === '>' || line[i + 1] === '>' || line[i - 1] === '<')) continue
    push(i)
    i += op.length - 1
    start = i + 1

    if (op === '\n' && heredocs.length) {
      let pos = start
      for (const h of heredocs.splice(0)) {
        // A heredoc whose delimiter never appears is not skipped: its lines are lexed as commands.
        let p = pos
        let found = false
        while (p < line.length && !found) {
          const eol = line.indexOf('\n', p)
          const end = eol === -1 ? line.length : eol
          const body = line.slice(p, end)
          p = end + 1
          found = (h.strip ? body.replace(/^\t+/, '') : body).trim() === h.delim
        }
        if (found) pos = p
      }
      start = Math.min(pos, line.length)
      i = start - 1
    }
  }
  push(line.length)
  return out
}

export function words(text: string): string[] {
  const out: string[] = []
  let w = ''
  let inWord = false
  let quote: '"' | "'" | "$'" | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote === "$'") {
      if (c === '\\' && i + 1 < text.length) w += text[++i]
      else if (c === "'") quote = null
      else w += c
      continue
    }
    if (quote === "'") { if (c === "'") quote = null; else w += c; continue }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < text.length) w += text[++i]
      else w += c
      continue
    }
    if (c === '$' && text[i + 1] === "'") { quote = "$'"; inWord = true; i++; continue }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue }
    if (c === '\\' && i + 1 < text.length) { w += text[++i]; inWord = true; continue }
    if (/\s/.test(c)) { if (inWord) out.push(w); w = ''; inWord = false; continue }
    w += c
    inWord = true
  }
  if (inWord) out.push(w)
  return out
}

// `$(...)` and backtick bodies, including those inside double quotes (segments() does not split there).
function substitutions(text: string): string[] {
  const out: string[] = []
  let quote: '"' | "'" | "$'" | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote === "$'") { if (c === '\\') i++; else if (c === "'") quote = null; continue }
    if (quote === "'") { if (c === "'") quote = null; continue }
    if (c === '\\') { i++; continue }
    if (c === '"') { quote = quote === '"' ? null : '"'; continue }
    if (quote === null && c === "'") { quote = "'"; continue }
    if (quote === null && c === '$' && text[i + 1] === "'") { quote = "$'"; i++; continue }
    if (c === '$' && text[i + 1] === '(' && text[i + 2] !== '(') {
      const end = closeParen(text, i + 1)
      out.push(text.slice(i + 2, end))
      i = end
    } else if (c === '`') {
      const end = text.indexOf('`', i + 1)
      if (end === -1) break
      out.push(text.slice(i + 1, end))
      i = end
    }
  }
  return out
}

export const base = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!'])
const PLAIN_WRAPPERS = new Set(['nohup'])
// Value-taking letters of a short-flag cluster, and long flags that take a separate value, per wrapper.
const SUDO_SHORT = 'ugCDhprtUTR'
const SUDO_LONG = new Set(['--user', '--group', '--chdir', '--host', '--prompt', '--role', '--type', '--other-user', '--command-timeout', '--close-from', '--chroot'])
const ENV_SHORT = 'uCS'
const ENV_LONG = new Set(['--unset', '--chdir', '--split-string'])
const XARGS_SHORT = 'nIPLsEda'
const XARGS_LONG = new Set(['--max-args', '--max-procs', '--delimiter', '--arg-file', '--max-chars'])
const TIME_LONG = new Set(['--output', '--format'])
const TIMEOUT_VALUE_FLAGS = new Set(['-s', '-k', '--signal', '--kill-after'])

export type Stripped = { rest: string[]; heads: string[]; assigns: string[] }

export function stripPrefixesInfo(w: string[]): Stripped {
  let i = 0
  const heads: string[] = []
  const assigns: string[] = []
  /** Skips flags; `short` lists the letters that take a value (a value letter ending a cluster takes the next word, mid-cluster it is attached). */
  const skipFlags = (short = '', long: ReadonlySet<string> = new Set(), exact: ReadonlySet<string> = new Set()) => {
    while (i < w.length && w[i].startsWith('-')) {
      const f = w[i]
      i++
      if (f === '--') return
      if (f.startsWith('--')) { if (!f.includes('=') && long.has(f)) i++; continue }
      if (exact.has(f)) { i++; continue }
      const at = [...f.slice(1)].findIndex(ch => short.includes(ch))
      if (at !== -1 && at === f.length - 2) i++
    }
  }
  for (let guard = 0; guard < 16 && i < w.length; guard++) {
    const head = base(w[i])
    if (KEYWORDS.has(w[i])) { heads.push(w[i]); i++; continue }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { assigns.push(w[i]); i++; continue }
    if (PLAIN_WRAPPERS.has(head)) { heads.push(head); i++; continue }
    if (head === 'command' || head === 'builtin') { heads.push(head); i++; skipFlags(); continue }
    if (head === 'time') { heads.push(head); i++; skipFlags('of', TIME_LONG); continue }
    if (head === 'exec') { heads.push(head); i++; skipFlags('a'); continue }
    if (head === 'env') { heads.push(head); i++; skipFlags(ENV_SHORT, ENV_LONG); continue }
    if (head === 'sudo') { heads.push(head); i++; skipFlags(SUDO_SHORT, SUDO_LONG); continue }
    if (head === 'doas') { heads.push(head); i++; skipFlags('uC'); continue }
    if (head === 'pkexec') { heads.push(head); i++; skipFlags('', new Set(['--user'])); continue }
    if (head === 'runuser') { heads.push(head); i++; skipFlags('ugG', new Set(['--user', '--group', '--supp-group'])); continue }
    if (head === 'nice') { heads.push(head); i++; skipFlags('n', new Set(['--adjustment'])); continue }
    if (head === 'xargs') { heads.push(head); i++; skipFlags(XARGS_SHORT, XARGS_LONG); continue }
    if (head === 'timeout') { heads.push(head); i++; skipFlags('', TIMEOUT_VALUE_FLAGS, TIMEOUT_VALUE_FLAGS); if (i < w.length) i++; continue }
    break
  }
  return { rest: w.slice(i), heads, assigns }
}

export const stripPrefixes = (w: string[]): string[] => stripPrefixesInfo(w).rest

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

export function commands(line: string, depth = 0): Cmd[] {
  const out: Cmd[] = []
  for (const seg of segments(line)) {
    const { rest, heads, assigns } = stripPrefixesInfo(words(seg.text))
    if (rest.length === 0 && assigns.length === 0) continue
    const w = rest.length === 0 ? [ASSIGNMENTS, ...assigns] : rest
    out.push({ text: seg.text, words: w, depth, heads, assigns })
    if (depth >= 3) continue
    for (const body of substitutions(seg.text)) out.push(...commands(body, depth + 1))
    const head = base(w[0])
    if (SHELLS.has(head)) {
      const c = w.findIndex((x, k) => k > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(x))
      const script = c === -1 ? undefined : w.slice(c + 1).find(x => !x.startsWith('-'))
      if (script !== undefined) out.push(...commands(script, depth + 1))
    } else if (head === 'su') {
      const k = w.findIndex((x, j) => j > 0 && (/^-[a-zA-Z]*c$/.test(x) || x === '--command'))
      const inline = w.find(x => x.startsWith('--command='))
      const script = inline !== undefined ? inline.slice('--command='.length) : k === -1 ? undefined : w[k + 1]
      if (script !== undefined) out.push(...commands(script, depth + 1))
    } else if (head === 'eval' && w.length > 1) {
      out.push(...commands(w.slice(1).join(' '), depth + 1))
    }
  }
  return out
}
