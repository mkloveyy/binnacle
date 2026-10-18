import type { PreviewSpec } from './types.ts'

export type RunResult = { exitCode: number; stdout: string }
export type Runner = (argv: string[]) => Promise<RunResult>

export const PREVIEW_LIMIT = 20

const UNSAFE = /[$`]|^~[^/]/
const FIND_ACTIONS = /^-(exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls|delete)$/
const BRACE = /[{}]/
// Lists the files under each rm target. A target counts as missing only when the nearest existing ancestor is readable and searchable; otherwise the loop exits non-zero.
const GLOB_LOOP = [
  'rc=0; shopt -s nullglob dotglob; IFS=',
  'chk() { a=$1; while [ ! -e "$a" ] && [ ! -L "$a" ]; do case "$a" in */*) a=${a%/*}; [ -n "$a" ] || a=/;; *) a=.;; esac; done; if [ -d "$a" ] && ! { [ -r "$a" ] && [ -x "$a" ]; }; then return 1; fi; return 0; }',
  'for t in "$@"; do',
  'case "$t" in "~") t=$HOME;; "~/"*) t="$HOME/${t#"~/"}";; esac',
  'if [ -e "$t" ] || [ -L "$t" ]; then chk "$t" || { rc=1; continue; }; find "$t" -type f 2>/dev/null || rc=1; continue; fi',
  'case "$t" in',
  '*[*?[]*) pre=${t%%[*?[]*}; case "$pre" in */*) d=${pre%/*}; [ -n "$d" ] || d=/;; *) d=.;; esac; chk "$d" || { rc=1; continue; }; for f in $t; do find "$f" -type f 2>/dev/null || rc=1; done;;',
  '*) chk "$t" || { rc=1; continue; }; if [ -e "$t" ] || [ -L "$t" ]; then find "$t" -type f 2>/dev/null || rc=1; fi;;',
  'esac',
  'done; exit $rc',
].join('\n')

const lines = (s: string) => s.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l !== '')

function cleanArgsKnown(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') return true
    if (!a.startsWith('-')) continue
    if (/^-[dfnqxX]+$/.test(a) || a === '--force' || a === '--quiet' || a === '--dry-run' || a.startsWith('--exclude=')) continue
    if (/^-[dfnqxX]*e/.test(a)) { if (/^-[dfnqxX]*e$/.test(a)) i++; continue }
    if (a === '--exclude') { i++; continue }
    return false
  }
  return true
}

function capped(items: string[], noun: string): string[] {
  if (items.length <= PREVIEW_LIMIT) return items
  return [...items.slice(0, PREVIEW_LIMIT), `… and ${items.length - PREVIEW_LIMIT} more ${noun}`]
}

const NOTHING = new Set(['no targets', 'no matching files', 'nothing would be removed', 'no uncommitted changes would be lost'])

export type Preview = { lines: string[]; nothingLost: boolean }

const files = (out: string[]) => (out.length ? [`${out.length} file(s) would be deleted:`, ...capped(out, 'files')] : ['no matching files'])

async function previewLines(spec: PreviewSpec, run: Runner): Promise<string[]> {
  try {
    switch (spec.kind) {
      case 'rm': {
        if (spec.targets.length === 0) return ['no targets']
        if (spec.targets.some(t => UNSAFE.test(t) || BRACE.test(t))) return ['cannot preview: the paths use shell expansion']
        const r = await run(['bash', '-c', GLOB_LOOP, 'binnacle', ...spec.targets])
        const out = lines(r.stdout)
        if (r.exitCode !== 0 && out.length === 0) return ['cannot preview: some paths could not be read']
        return files(out)
      }
      case 'find': {
        if (spec.args.some(a => FIND_ACTIONS.test(a))) return ['cannot preview: find runs other actions']
        if (spec.args.some(a => UNSAFE.test(a))) return ['cannot preview: the paths use shell expansion']
        const r = await run(['find', ...spec.args, '-print'])
        const out = lines(r.stdout)
        if (r.exitCode !== 0 && out.length === 0) return ['cannot preview: find failed']
        return files(out)
      }
      case 'git-clean': {
        // The original flags, unchanged: -n wins over -f, and -ff still lists nested repositories.
        // Only known options run, so nothing (--no-dry-run, -i) can turn the dry run back off.
        if (!cleanArgsKnown(spec.args)) return ['cannot preview: git clean has an option the preview does not know']
        const r = await run(['git', 'clean', '-n', ...spec.args])
        if (r.exitCode !== 0) return ['cannot preview: git clean -n failed']
        const out = lines(r.stdout)
        return out.length ? capped(out, 'paths') : ['nothing would be removed']
      }
      case 'force-push': {
        const ref = spec.remote !== null && spec.branch !== null ? `${spec.remote}/${spec.branch}` : '@{u}'
        const r = await run(['git', 'log', '--oneline', '-n', '50', `HEAD..${ref}`])
        if (r.exitCode !== 0) return [`cannot preview: could not compare with ${ref}`]
        const out = lines(r.stdout)
        return out.length ? [`the remote would lose ${out.length} commit(s):`, ...capped(out, 'commits')] : ['the remote has no commits that would be lost']
      }
      case 'discard': {
        const r = await run(['git', '--no-optional-locks', 'status', '--porcelain', '--', ...(spec.paths.length ? spec.paths : [':/'])])
        if (r.exitCode !== 0) return ['cannot preview: git status failed']
        const out = lines(r.stdout).filter(l => !l.startsWith('??'))
        return out.length ? ['changes that would be lost:', ...capped(out, 'files')] : ['no uncommitted changes would be lost']
      }
    }
  } catch {
    return ['cannot preview: the preview command did not run']
  }
}

export async function runPreview(spec: PreviewSpec, run: Runner): Promise<Preview> {
  const out = await previewLines(spec, run)
  return { lines: out, nothingLost: out.length === 1 && NOTHING.has(out[0]) }
}
