export type BinnacleItem = 'model' | 'effort' | 'context' | 'limits' | 'duration' | 'cost' | 'cwd'

export type BinnacleSettings = {
  version: 1
  status: Record<BinnacleItem, boolean>
  rules: Record<string, boolean>
  plugins: Record<string, boolean>
  /** Plugin settings (`$.binnacle.setting`), keyed `plugin/id`. */
  pluginSettings: Record<string, boolean>
  history: { lineage: boolean }
}

export type BinnacleLimit = { kind: string; percent: number; resetsAt: number | null }

export type BinnacleSnapshot = {
  model: string
  effort: string | null
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  startedAt: number
  costUsd: number | null
  turnCostUsd: number | null
  limits: BinnacleLimit[]
  cwd: string
  home: string
}

export type BinnacleCategory = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }

export type BinnacleBreakdown = {
  categories: BinnacleCategory[]
  total: number
  window: number
  compactAt: number | null
}

export type BinnacleGuardAction = 'deny' | 'ask-allow' | 'ask-deny' | 'auto-allow' | 'rewrite'

export type BinnacleGuardEntry = { at: number; ruleId: string; action: BinnacleGuardAction; summary: string }

export type BinnaclePermStats = { allow: number; ask: number; deny: number; files: number; shell: number; other: number }

export type BinnacleTurnReceipt = { durationMs: number; agents: number; edits: number; errors: number; costDelta: number | null }

export type BinnacleRuleMeta = { id: string; pack: string; title: string; action: 'deny' | 'ask' | 'rewrite' }

export type BinnacleTab = 'overview' | 'perm' | 'settings' | 'activity' | 'agents' | 'flow' | 'diff' | 'search' | `ext:${string}`

/** How a turn the person did not start began, from its prompt's origin. */
export type BinnacleTurnVia = 'hand-back' | 'loop' | 'peer' | 'plugin' | 'other'

export type BinnacleActivityDecider = 'rule' | 'hook' | 'classifier' | 'user' | 'unknown'

export type BinnacleActivityOutcome = 'approved' | 'denied-by-user' | 'denied-by-classifier' | 'denied-by-hook' | 'unknown'

export type BinnacleActivityEvent = { at: number; turnId: string; agentId: string | null } & (
  /**
   * `auto`: a turn Claude Code started itself, not the person; `via` says how (absent in records before v0.3, read
   * as a hand-back). Only hand-backs leave "this turn" running on; a `/loop` firing starts a new one.
   */
  | { kind: 'turn-start'; prompt: string; auto?: true; via?: BinnacleTurnVia }
  | { kind: 'turn-end'; durationMs: number; costUsd: number | null; aborted: boolean }
  | { kind: 'agent-start'; agentType: string; model: string; task: string; parentAgentId: string | null; background: boolean; teammate?: true }
  | { kind: 'agent-end'; durationMs: number; tokensIn: number | null; tokensOut: number | null; aborted: boolean; report: string[] }
  /** `reason`: a denial's reason, masked, first 120 characters; `source`/`ruleId`: a denial an external guard registered with `$.binnacle.guardSource` gave (`<prefix><rule> · …`). */
  | { kind: 'perm'; tool: string; summary: string; decision: 'ask' | 'deny'; decider: BinnacleActivityDecider; outcome: BinnacleActivityOutcome | null; reason?: string; source?: string; ruleId?: string }
  | { kind: 'guard'; ruleId: string; action: BinnacleGuardAction; summary: string }
  | { kind: 'error'; tool: string; summary: string; message: string }
  | { kind: 'edit'; tool: string; file: string; added: number; removed: number }
  /** A context compaction (v0.3 probe M3): the trigger, tokens before and after when core recorded them, how long it took. */
  | { kind: 'compact'; trigger: string; tokensBefore: number | null; tokensAfter: number | null; durationMs: number }
)

export type BinnacleActivityCount = { turnId: string; agentId: string | null; files: number; shell: number; other: number }

export type BinnacleActivitySession = {
  version: 1
  sessionId: string
  startedAt: number
  endedAt: number | null
  cwd: string
  firstPrompt: string
  events: BinnacleActivityEvent[]
  counts: BinnacleActivityCount[]
}

export type BinnacleActivityIndexEntry = { sessionId: string; startedAt: number; endedAt: number | null; cwd: string; firstPrompt: string; bytes: number }

export type BinnaclePendingCheck = {
  toolUseId: string
  agentId: string | null
  tool: string
  summary: string
  decision: 'ask' | 'deny'
  decider: BinnacleActivityDecider
  reason?: string
  at: number
}

/** A `compact_boundary` row of a transcript (v0.3 probe M2/M3); `uuid` names it across forks. */
export type BinnacleBoundary = { uuid: string; at: number; trigger: string; pre: number | null; post: number | null; durationMs: number | null }

/** The transcript's compaction history for one session, read in the background (§5.2); `lineage` only with the setting on (§5.3). */
export type BinnacleCompactions = {
  sessionId: string
  found: boolean
  file: BinnacleBoundary[]
  copied: boolean
  lineage: { boundaries: BinnacleBoundary[]; sessions: number; missing: boolean } | null
}

export type BinnacleDiffFile = {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '?'
  added: number
  removed: number
  hunks: string[]
  binary: boolean
}

export type BinnacleWorkspaceDiff =
  | { kind: 'ok'; files: BinnacleDiffFile[]; note: string | null }
  | { kind: 'not-repo' }
  | { kind: 'error'; message: string }

export type BinnacleTurnPatch = { turnId: string; file: string; source: string }

export type BinnacleAttentionLevel = 'info' | 'warn' | 'error'

export type BinnacleAttentionItem = { plugin: string; id: string; level: BinnacleAttentionLevel; text: string }

export type BinnacleTabRow = {
  /** Needed by a row that is pressed or carries buttons. */
  id?: string
  /** A row with no text and only buttons is drawn as a row of buttons. */
  text?: string
  color?: string
  dim?: boolean
  bold?: boolean
  /** Right-aligned cells, aligned across the rows of one level; the text is cut first. At most 6. */
  cols?: BinnacleSpan[][]
  /** The whole row is pressed: notify `{ kind: 'press', id }`. */
  press?: boolean
  /** At most 6; a press notifies `{ kind: 'press', id: button id, row: row id }`. */
  buttons?: { id: string; label: string }[]
  children?: BinnacleTabRow[]
}

export type BinnacleExtTab = { plugin: string; id: string; title: string; rows: BinnacleTabRow[] }

export type BinnacleSpan = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type BinnacleButton = { plugin: string; id: string; label: string; color?: string }
export type BinnacleSegment = { plugin: string; id: string; text: string; color?: string; priority: number; press: boolean }
export type BinnacleLine = { plugin: string; id: string; forms: BinnacleSpan[][]; press: boolean }
export type BinnacleSettingItem = { plugin: string; id: string; title: string; def: boolean }
/** `id` is the prefix: one owner per prefix. */
export type BinnacleGuardSource = { plugin: string; id: string; prefix: string; source: string }
export type BinnacleNotify =
  | { plugin: string; kind: 'press'; id: string; row?: string }
  | { plugin: string; kind: 'setting'; id: string; value: boolean }
  | { plugin: string; kind: 'open'; id: string }

export type Binnacle = {
  version: (args: Record<string, never>) => Promise<{ api: number; binnacle: string }>
  register: (meta: BinnacleRuleMeta) => Promise<{ ok: true }>
  enabled: (args: { id: string }) => Promise<boolean>
  ask: (args: { ruleId: string; reason: string; preview: string[] }) => Promise<'allow' | 'deny'>
  record: (args: { ruleId: string; action: BinnacleGuardAction; summary: string }) => Promise<{ ok: true }>
  shell: (args: { command: string }) => Promise<{ segments: { text: string; words: string[] }[] }>
  attention: (args: { id: string; level: BinnacleAttentionLevel; text: string }) => Promise<{ ok: true }>
  tab: (args: { id: string; title: string; rows: BinnacleTabRow[] }) => Promise<{ ok: true }>
  button: (args: { id: string; label: string; color?: string }) => Promise<{ ok: true }>
  segment: (args: { id: string; text: string; color?: string; priority?: number; press?: boolean }) => Promise<{ ok: true }>
  line: (args: { id: string; forms: BinnacleSpan[][]; press?: boolean }) => Promise<{ ok: true }>
  setting: (args: { id: string; title: string; default: boolean }) => Promise<{ ok: true; value: boolean }>
  guardSource: (args: { prefix: string; source: string }) => Promise<{ ok: true }>
  /** Raised by binnacle when the person uses something a plugin registered; subscribe, check the origin is binnacle and the plugin is yours. */
  notify: (e: BinnacleNotify) => Promise<{ handled: boolean }>
}

declare module 'claude-code' {
  interface EngineInterface {
    binnacle: Binnacle
  }
  interface PluginState {
    binnacle: {
      settings: BinnacleSettings
      snapshot: BinnacleSnapshot | null
      effort: string | null
      breakdown: BinnacleBreakdown | null
      perm: BinnaclePermStats
      extRules: BinnacleRuleMeta[]
      tab: BinnacleTab
      /** Counts changes to the session record, which binnacle's code holds itself: drawings read it to draw again. */
      activity: number
      /** Counts changes to the Flow tab's live calls and tally, which binnacle's code holds itself: drawings read it to draw again. */
      flow: number
      pending: BinnaclePendingCheck[]
      patches: BinnacleTurnPatch[]
      viewSession: string | null
      treeOpen: string[]
      treeSelected: string | null
      agentSelected: string | null
      diffSource: string
      diffFile: string | null
      workspace: BinnacleWorkspaceDiff | null
      diffLoading: boolean
      /** Counts changes to what other plugins registered, which binnacle's code holds itself: drawings read it to draw again. */
      ext: number
      extOpen: string[]
      compactions: BinnacleCompactions | null
      searchQuery: string
      searchSession: string | null
      searchOpen: { sessionId: string; query: string; i: number } | null
    }
  }
}
