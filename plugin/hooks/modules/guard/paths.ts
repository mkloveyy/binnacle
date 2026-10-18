import type { RuleContext } from './types.ts'

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') || '/' : p)
const WILD = /[*?[]/

/**
 * Lexical resolution: `dir` is the collapsed path up to the first wildcard segment, `tail` the raw segments from it on.
 * Null when the target cannot be resolved (`~user`, `~` with no home).
 */
function resolve(target: string, cwd: string, home: string | null): { dir: string[]; tail: string[] } | null {
  let raw = target
  if (raw === '~' || raw.startsWith('~/')) {
    if (home === null) return null
    raw = home + raw.slice(1)
  } else if (raw.startsWith('~')) return null
  const segments = (raw.startsWith('/') ? raw : `${cwd}/${raw}`).split('/')
  const dir: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (WILD.test(seg)) return { dir, tail: segments.slice(i) }
    if (seg === '' || seg === '.') continue
    if (seg === '..') dir.pop()
    else dir.push(seg)
  }
  return { dir, tail: [] }
}

/** True when deleting `target` could reach outside the project (the session's cwd). Lexical only: no filesystem access, no symlink resolution. */
export function outsideProject(target: string, ctx: RuleContext, allowRoot: boolean): boolean {
  if (ctx.cwd === null) return true
  const cwd = trimSlash(ctx.cwd)
  const home = ctx.home === null ? null : trimSlash(ctx.home)
  if (cwd === '/' || (home !== null && (cwd === home || home.startsWith(`${cwd}/`)))) return true
  if (/[$`]/.test(target)) return true

  const r = resolve(target, cwd, home)
  if (r === null || r.tail.includes('..')) return true
  const resolved = `/${r.dir.join('/')}`
  if (resolved === cwd) return !allowRoot
  return !resolved.startsWith(`${cwd}/`)
}

// A wildcard segment can only match `.git` when it starts with a literal dot (the shell never matches a leading dot otherwise).
function globMatchesGit(seg: string): boolean {
  if (!seg.startsWith('.')) return false
  try {
    return new RegExp(`^${seg.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test('.git')
  } catch {
    return true
  }
}

/** True when `target` is a `.git` directory or lies inside one (lexically resolved; wildcard segments that could match `.git` count). */
export function inGitDir(target: string, ctx: RuleContext): boolean {
  const r = resolve(target, trimSlash(ctx.cwd ?? '/'), ctx.home === null ? null : trimSlash(ctx.home))
  if (r === null) return false
  return r.dir.includes('.git') || r.tail.some(seg => seg === '.git' || (WILD.test(seg) && globMatchesGit(seg)))
}
