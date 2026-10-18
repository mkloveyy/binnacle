import { ASSIGNMENTS, base, commands, type Cmd } from '../../core/shell.ts'

export type PreviewSpec =
  | { kind: 'rm'; targets: string[] }
  | { kind: 'find'; args: string[] }
  | { kind: 'git-clean'; args: string[] }
  | { kind: 'force-push'; remote: string | null; branch: string | null }
  | { kind: 'discard'; paths: string[] }

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason: string; preview: PreviewSpec | null }
  | { kind: 'rewrite'; input: Record<string, unknown>; note: string }

export type RuleContext = { cwd: string | null; home: string | null }

export type Rule = {
  id: string
  pack: string
  title: string
  /** One line on what the rule covers, shown under it in /binnacle Settings. */
  summary?: string
  action: 'deny' | 'ask' | 'rewrite'
  /** Tool names, or 'mcp:*' for every MCP tool. */
  tools: readonly string[]
  defaultEnabled: boolean
  check(tool: string, input: Record<string, unknown>, ctx: RuleContext): Verdict
}

export const PASS: Verdict = { kind: 'pass' }

export const bashCommands = (input: Record<string, unknown>): Cmd[] =>
  typeof input.command === 'string' ? commands(input.command) : []

const BENIGN_HEADS = new Set(['time', 'nice', 'nohup', 'timeout', 'command', 'builtin', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!'])
const STATE_HEADS = new Set(['cd', 'pushd', 'popd', 'export', 'source', '.', 'unset', 'set', 'eval', 'declare', 'typeset', 'local', 'readonly', 'alias', 'shopt'])
const LOCATION_VARS = /^(HOME|PWD|KUBECONFIG|GIT_[A-Za-z0-9_]*)=/

/**
 * Allowlist for "the command acts in the session cwd as the session user": a top-level command whose only prefixes are
 * plain assignments (not HOME / PWD / KUBECONFIG / GIT_*) or benign wrappers, with nothing earlier on the line that could
 * change the directory or environment (a state builtin, or an assignment-only segment setting one of those variables).
 * Everything else is unknown, so the rule asks without a preview.
 */
export function locationKnown(c: Cmd, line: Cmd[]): boolean {
  if (c.depth !== 0 || !c.heads.every(h => BENIGN_HEADS.has(h))) return false
  if (c.assigns.some(a => LOCATION_VARS.test(a))) return false
  for (const e of line) {
    if (e === c) break
    if (STATE_HEADS.has(base(e.words[0]))) return false
    if (e.words[0] === ASSIGNMENTS && e.assigns.some(a => LOCATION_VARS.test(a))) return false
  }
  return true
}

/** True when git was pointed at another repository or work tree before the subcommand (including `-c core.worktree` / `core.bare`). */
export function gitRelocated(c: Cmd): boolean {
  const w = c.words
  for (let i = 1; i < w.length && w[i].startsWith('-'); i++) {
    if (/^(-C|--git-dir|--work-tree)(=|$)/.test(w[i])) return true
    if (w[i] === '-c' && /^core\.(worktree|bare)(=|$)/i.test(w[i + 1] ?? '')) return true
    if (['-c', '--namespace'].includes(w[i])) i++
  }
  return false
}

/** git's subcommand and its arguments, skipping global options such as -C <dir>. */
export function gitArgs(w: string[]): { sub: string; args: string[] } | null {
  let i = 1
  while (i < w.length && w[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(w[i]) ? 2 : 1
  return i < w.length ? { sub: w[i], args: w.slice(i + 1) } : null
}
