export const ALLOW = 'Allow once'
export const DENY = 'Deny'

export const question = (title: string, reason: string, preview: string[]): string =>
  [`binnacle · ${title}`, reason, ...preview.map(l => `  ${l}`), 'Allow this once?'].join('\n')

export type AskResult = { ok: true } | { ok: false; note: string }

export function interpret(answer: string | null): AskResult {
  if (answer === ALLOW) return { ok: true }
  if (answer === null || answer === DENY) return { ok: false, note: '' }
  return { ok: false, note: answer.trim() }
}

export const denyMessage = (reason: string): string =>
  `binnacle: ${reason} Do not work around this with a different command; ask the user.`

export function summarize(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash' && typeof input.command === 'string') return input.command.slice(0, 120)
  const firstString = Object.entries(input).find(([k, v]) => typeof v === 'string' && !['tool', 'tool_use_id', 'agentId'].includes(k))?.[1]
  return `${tool}${typeof firstString === 'string' ? ' ' + firstString : ''}`.slice(0, 120)
}
