import type { Rule, RuleContext, Verdict } from './types.ts'

type Hit = { rule: Rule; verdict: Exclude<Verdict, { kind: 'pass' }> }

const SEVERITY = { deny: 3, ask: 2, rewrite: 1 } as const

const matchesTool = (tools: readonly string[], tool: string) =>
  tools.includes(tool) || (tools.includes('mcp:*') && tool.startsWith('mcp__'))

export function evaluate(rules: readonly Rule[], isEnabled: (id: string, def: boolean) => boolean, tool: string, input: Record<string, unknown>, ctx: RuleContext): Hit | null {
  let best: Hit | null = null
  for (const rule of rules) {
    if (!matchesTool(rule.tools, tool) || !isEnabled(rule.id, rule.defaultEnabled)) continue
    const verdict = rule.check(tool, input, ctx)
    if (verdict.kind === 'pass') continue
    if (best === null || SEVERITY[verdict.kind] > SEVERITY[best.verdict.kind]) best = { rule, verdict }
  }
  return best
}
