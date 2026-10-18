/** A session id that may become a file name: Claude Code's are UUIDs. Anything else (`/`, `..`) never becomes a path. */
const ID = /^[A-Za-z0-9_-]+$/

export const validId = (id: string): boolean => ID.test(id)

/** Claude Code's place for a plugin's own data, `~/.claude/plugins/data/<plugin>-<marketplace>/`. */
export const dataDir = (home: string): string => `${home}/.claude/plugins/data/binnacle-binnacle`

/** One file per saved session. */
export const sessionsDir = (home: string): string => `${dataDir(home)}/sessions`

/** A saved session's file; null when HOME is unknown or the id is not one a file may be named after. */
export const recordPath = (home: string, id: string): string | null => (home !== '' && validId(id) ? `${sessionsDir(home)}/${id}.json` : null)

/** The session ids of the files in a listing of `sessionsDir`. */
export const fileIds = (entries: readonly { name: string; kind: string }[]): string[] =>
  entries.filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name.slice(0, -'.json'.length)).filter(validId)

