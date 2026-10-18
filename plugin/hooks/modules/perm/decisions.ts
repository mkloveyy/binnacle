import type { Span } from '../ui/cols.ts'
import { stackBar, stackLegend } from '../ui/stack.ts'

/**
 * Who decided this session's permission checks that were not a plain allow, as Claude Code writes it on each tool
 * result in the transcript (`permissionDecision`, P2-6): the person in the dialog (`source` `user_*`), the auto-mode
 * classifier (`reasonType` `classifier`), the permission mode, a rule or the configuration, a hook, anything else.
 */
export type Decisions = {
  youAllowed: number
  youDenied: number
  autoAllowed: number
  autoDenied: number
  byMode: number
  byRules: number
  hookDenied: number
  otherDenied: number
  /** Who settled the latest ask: the classifier (the session is in auto mode) or the person; null while none was. */
  lastAsk: 'auto' | 'you' | null
}

export const NO_DECISIONS: Decisions = { youAllowed: 0, youDenied: 0, autoAllowed: 0, autoDenied: 0, byMode: 0, byRules: 0, hookDenied: 0, otherDenied: 0, lastAsk: null }

/** Only the decision objects, read-only: the transcript's text never reaches binnacle this way. */
export const grepDecisions = (path: string): string[] => ['grep', '-oE', '"permissionDecision":\\{[^}]*\\}', path]

type Raw = { decision?: unknown; source?: unknown; reasonType?: unknown }

export function parseDecisions(stdout: string): Decisions {
  const d = { ...NO_DECISIONS }
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    let raw: Raw
    try {
      raw = (JSON.parse(`{${line}}`) as { permissionDecision?: Raw }).permissionDecision ?? {}
    } catch {
      continue
    }
    const accept = raw.decision === 'accept'
    const source = typeof raw.source === 'string' ? raw.source : ''
    const reason = typeof raw.reasonType === 'string' ? raw.reasonType : ''
    if (source.startsWith('user')) {
      accept ? d.youAllowed++ : d.youDenied++
      d.lastAsk = 'you'
    } else if (reason === 'classifier') {
      accept ? d.autoAllowed++ : d.autoDenied++
      d.lastAsk = 'auto'
    }
    else if (source === 'hook') accept ? d.byRules++ : d.hookDenied++
    else if (reason === 'mode') accept ? d.byMode++ : d.otherDenied++
    else accept ? d.byRules++ : d.otherDenied++
  }
  return d
}

/** One bar by share and its legend (the Context block's look), for what happened only; nothing when nothing did. */
export function decisionLines(d: Decisions, width: number): Span[][] {
  const parts = [
    { name: 'you allowed', n: d.youAllowed, color: '#7aa2f7' },
    { name: 'you denied', n: d.youDenied, color: '#f7768e' },
    { name: 'auto allowed', n: d.autoAllowed, color: '#9ece6a' },
    { name: 'auto denied', n: d.autoDenied, color: '#ff9e64' },
    { name: 'mode allowed', n: d.byMode, color: '#bb9af7' },
    { name: 'rules allowed', n: d.byRules, color: '#7dcfff' },
    { name: 'hooks denied', n: d.hookDenied, color: '#e0af68' },
    { name: 'other denied', n: d.otherDenied, color: 'gray' },
  ]
  const bar = stackBar(parts, width - 1)
  return bar.length ? [bar, ...stackLegend(parts, width)] : []
}
