import type { On } from 'claude-code'

/** Where the tests' HOME (`/home/u`) keeps plugin data; the helper answers only under it. */
export const DATA = '/home/u/.claude/plugins/data/'
export const SESSIONS = `${DATA}binnacle-binnacle/sessions`
export const sessionFile = (id: string): string => `${SESSIONS}/${id}.json`

/** Matched registrations, so a test's own unmatched hooks on the same events still load beside these. */
const UNDER = /^\/home\/u\/\.claude\/plugins\/data\//

const DONE = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

/**
 * Plugin data files in memory: `fs.read`, `fs.write`, `fs.exists` and `fs.list` under DATA, and `process.run` of
 * `rm -f <one path under DATA>`. Anything else goes to `next`, so a test's own hooks still answer it: register this
 * first. It registers with matchers, so a test may still register its own `fs.*` and `process.run` hooks. `refuse`: paths whose writes fail; `keep`: paths rm fails on (exit 1). `seed` writes a session's file;
 * `record` reads one back, parsed.
 */
export function files(on: On, options: { refuse?: (path: string) => boolean; keep?: (path: string) => boolean } = {}) {
  const disk = new Map<string, string>()
  const removed: string[] = []
  const writes: string[] = []
  const under = (path: string) => path.startsWith(DATA)
  on('fs.read', { path: UNDER }, (_$, e, next) => {
    if (!under(e.path)) return next(e)
    const text = disk.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${e.path}'`)
    return { value: text }
  })
  on('fs.write', { path: UNDER }, (_$, e, next) => {
    if (!under(e.path)) return next(e)
    if (options.refuse?.(e.path)) throw new Error(`EACCES: permission denied, open '${e.path}'`)
    disk.set(e.path, e.text)
    writes.push(e.path)
    return { value: undefined }
  })
  on('fs.exists', { path: UNDER }, (_$, e, next) => {
    if (!under(e.path)) return next(e)
    const dir = `${e.path.replace(/\/$/, '')}/`
    return { value: disk.has(e.path) || [...disk.keys()].some(p => p.startsWith(dir)) }
  })
  on('fs.list', { path: UNDER }, (_$, e, next) => {
    if (!under(e.path)) return next(e)
    const dir = `${e.path.replace(/\/$/, '')}/`
    const inside = [...disk.keys()].filter(p => p.startsWith(dir))
    if (inside.length === 0) throw new Error(`ENOENT: no such file or directory, scandir '${e.path}'`)
    const names = new Map<string, 'file' | 'dir'>()
    for (const p of inside) {
      const rest = p.slice(dir.length)
      const cut = rest.indexOf('/')
      names.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'dir')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: kind === 'file' ? (disk.get(dir + name) ?? '').length : 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', { argv: UNDER }, (_$, e, next) => {
    const argv = e.argv
    if (argv.length !== 3 || argv[0] !== 'rm' || argv[1] !== '-f' || !under(argv[2] ?? '')) return next(e)
    const path = argv[2] as string
    if (options.keep?.(path)) return { value: { ...DONE, exitCode: 1, stderr: `rm: ${path}: Operation not permitted` } }
    removed.push(path)
    disk.delete(path)
    return { value: DONE }
  })
  return {
    disk,
    /** The paths `rm -f` was run on, in order. */
    removed,
    /** The paths written, in order. */
    writes,
    seed: (id: string, value: unknown) => void disk.set(sessionFile(id), JSON.stringify(value)),
    has: (id: string) => disk.has(sessionFile(id)),
    record: (id: string): unknown => {
      const text = disk.get(sessionFile(id))
      return text === undefined ? undefined : JSON.parse(text)
    },
    /** The ids with a session file. */
    ids: () => [...disk.keys()].filter(p => p.startsWith(`${SESSIONS}/`) && p.endsWith('.json')).map(p => p.slice(SESSIONS.length + 1, -'.json'.length)),
  }
}

/** `$.env.get('HOME')` as `/home/u`, the HOME `files` answers under; other names go to `next`. */
export function home(on: On): void {
  on('env.get', (_$, e, next) => (e.name === 'HOME' ? { value: '/home/u' } : next(e)))
}

/**
 * The session record as binnacle saved it. binnacle holds the live record in its own code, not in `$.state`, so a test
 * reads it from its file: this ends the session, which saves it (a session with no turn is not saved), and reads the
 * file back. The session opens again at its next event. Needs `files` and `home`, and a `session.end` bottom.
 */
export async function savedRecord($: { session: { end: (e: never) => Promise<unknown> } }, disk: { record: (id: string) => unknown }, id = 's1'): Promise<unknown> {
  await $.session.end({ reason: 'other', sessionId: id, resume: { id } } as never)
  return disk.record(id)
}
