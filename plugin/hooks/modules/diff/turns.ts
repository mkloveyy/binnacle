import type { BinnacleActivitySession, BinnacleDiffFile, BinnacleTurnPatch } from '../../../types'
import { turnNumbers } from '../activity/events.ts'
import { relPath } from './parse.ts'

/** Turns that changed files, newest first, with their number. */
export function editedTurns(s: BinnacleActivitySession): { turnId: string; n: number }[] {
  const nums = turnNumbers(s)
  const ids = [...new Set(s.events.filter(ev => ev.kind === 'edit').map(ev => ev.turnId))]
  return ids.map(turnId => ({ turnId, n: nums.get(turnId) ?? 0 })).sort((a, b) => b.n - a.n)
}

/** The host refuses a Select with more than 64 options: the Source list offers Workspace and the 63 newest edited turns. */
const MAX_TURN_OPTIONS = 63

/** The edited turns the Diff tab's Source list offers, newest first. */
export const sourceTurns = (s: BinnacleActivitySession): { turnId: string; n: number }[] => editedTurns(s).slice(0, MAX_TURN_OPTIONS)

/** One entry per file a turn changed, line counts summed; hunks only while the session still holds the patch bodies. */
export function turnFiles(s: BinnacleActivitySession, turnId: string, patches: BinnacleTurnPatch[]): BinnacleDiffFile[] {
  const files = new Map<string, BinnacleDiffFile>()
  for (const ev of s.events) {
    if (ev.kind !== 'edit' || ev.turnId !== turnId) continue
    const f = files.get(ev.file) ?? { path: relPath(ev.file, s.cwd), status: 'M' as const, added: 0, removed: 0, hunks: [], binary: false }
    files.set(ev.file, { ...f, added: f.added + ev.added, removed: f.removed + ev.removed })
  }
  return [...files.entries()].map(([file, f]) => ({
    ...f,
    hunks: patches.filter(p => p.turnId === turnId && p.file === file && p.source !== '').map(p => p.source),
  }))
}
