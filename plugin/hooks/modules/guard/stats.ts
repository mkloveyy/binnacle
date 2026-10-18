import type { BinnaclePermStats } from '../../../types'

export const EMPTY_STATS: BinnaclePermStats = { allow: 0, ask: 0, deny: 0, files: 0, shell: 0, other: 0 }

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

export const categoryOf = (tool: string): 'files' | 'shell' | 'other' =>
  FILE_TOOLS.has(tool) ? 'files' : SHELL_TOOLS.has(tool) ? 'shell' : 'other'

export function tally(s: BinnaclePermStats, tool: string, decision: 'allow' | 'ask' | 'deny'): BinnaclePermStats {
  const c = categoryOf(tool)
  return { ...s, [decision]: s[decision] + 1, [c]: s[c] + 1 }
}
