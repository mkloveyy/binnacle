import type { BinnacleBreakdown, BinnacleCategory, BinnacleLimit, BinnacleSnapshot } from '../../../types'

export type UsageLike = {
  startedAt: number
  context: { tokens?: number; window: number; percent?: number; breakdown?: unknown }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

export function toLimits(r: UsageLike['rateLimits']): BinnacleLimit[] {
  return r.map(l => {
    const t = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)
    return { kind: l.kind, percent: l.percentUsed, resetsAt: Number.isFinite(t) ? t : null }
  })
}

export function toSnapshot(u: UsageLike, model: string, effort: string | null, cwd: string, home: string, turnCostUsd: number | null): BinnacleSnapshot {
  return {
    model, effort, cwd, home, turnCostUsd,
    contextTokens: u.context.tokens ?? null,
    contextWindow: u.context.window,
    contextPercent: u.context.percent ?? null,
    startedAt: u.startedAt,
    costUsd: u.cost?.usd ?? null,
    limits: toLimits(u.rateLimits),
  }
}

const KINDS = new Set(['used', 'free', 'buffer'])

export function toBreakdown(raw: unknown): BinnacleBreakdown | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  if (!Array.isArray(b.categories) || typeof b.totalTokens !== 'number' || typeof b.rawMaxTokens !== 'number') return null
  const categories: BinnacleCategory[] = []
  for (const c of b.categories as Record<string, unknown>[]) {
    if (typeof c?.name !== 'string' || typeof c.tokens !== 'number' || c.tokens <= 0 || !KINDS.has(String(c.kind))) continue
    categories.push({ name: c.name.toLowerCase(), tokens: c.tokens, kind: c.kind as BinnacleCategory['kind'] })
  }
  const compactAt = b.isAutoCompactEnabled === true && typeof b.autoCompactThreshold === 'number' ? b.autoCompactThreshold : null
  return { categories, total: b.totalTokens, window: b.rawMaxTokens, compactAt }
}
