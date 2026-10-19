import { atom, read, update } from 'claude-code'
import type { Args, EngineInterface, EventResult, Frozen, Next, Register } from 'claude-code'
import type { BinnacleActivityIndexEntry, BinnacleActivitySession, BinnacleDiffFile, BinnacleGuardAction, BinnacleItem, BinnacleNotify, BinnaclePendingCheck, BinnaclePermStats, BinnacleRuleMeta, BinnacleSettingItem, BinnacleSettings, BinnacleTab, BinnacleTabRow, BinnacleTurnVia, BinnacleWorkspaceDiff } from '../types'
import { ASSIGNMENTS, commands } from './core/shell.ts'
import { DEFAULT_SETTINGS, ITEMS, STORE_KEY, VERSION, normalizeSettings, parseCommand, pluginEnabled, pluginSetting, ruleEnabled, setItem, setLineage, setPlugin, setPluginSetting, setRule } from './core/settings.ts'
import { ALLOW, DENY, denyMessage, interpret, question, summarize, type AskResult } from './modules/guard/ask.ts'
import { evaluate } from './modules/guard/engine.ts'
import { runPreview } from './modules/guard/preview.ts'
import { BUILTIN_RULES } from './modules/guard/rules/index.ts'
import { bashCommands } from './modules/guard/types.ts'
import { EMPTY_STATS, tally } from './modules/guard/stats.ts'
import { alerts } from './modules/status/attention.ts'
import { NO_DECISIONS, decisionLines, grepDecisions, parseDecisions, type Decisions } from './modules/perm/decisions.ts'
import { duration, effortLabel, elapsed, modelEffort, modelLabel, money, tokens } from './core/format.ts'
import { fit, withTail } from './modules/status/layout.ts'
import { buildGroups, type Span as StatusSpan } from './modules/status/segments.ts'
import { LEGEND_GAP, legendRows, overviewCells } from './modules/status/palette.ts'
import { toBreakdown, toSnapshot } from './modules/status/snapshot.ts'
import { brief, clip, mask, visible } from './modules/activity/mask.ts'
import { agentTurn, append, askOutcome, attribute, bump, currentTurn, deciderOf, firstLine, guardRefused, newSession, reportLines, tokensOf, viaOf } from './modules/activity/events.ts'
import { guardEntries, lastReceipt, liveRows, moves } from './modules/activity/derive.ts'
import { GIT_DIFF, GIT_STATUS, MAX_SOURCE, capHunks, keepPatches, patchOf, workspaceDiff } from './modules/diff/parse.ts'
import { sourceTurns, turnFiles } from './modules/diff/turns.ts'
import { INDEX_KEY, entryOf, evict, hasTurn, lastAt, normalizeIndex, normalizeSession, prune, sessionKey, sizeOf, storeIds, unlisted, upsertIndex } from './modules/activity/store.ts'
import { fileIds, recordPath, sessionsDir, validId } from './modules/activity/paths.ts'
import { callEnded, callStarted, callSummary, emptyLive, endRunning, newTurn, outcomeOf, tallyAsk, tallyCheck, tallyGuard, type Live } from './modules/flow/live.ts'
import { flowView, moving, runningAgentIds, runningAgents } from './modules/flow/model.ts'
import { flowLines } from './modules/flow/layout.ts'
import { SYM } from './modules/ui/theme.ts'
import { HAND_BACK, agentRows, buildTree, findNode, flatten, openByDefault, sessionOptions, toggledOpen, treeRow } from './modules/activity/tree.ts'
import { API, emptyRegistry, layoutTab, pickForm, pluginsIn, guardSourceOf, segmentGroup, setAttention, setButton, setGuardSource, setLine, setSegment, setSetting, setTab, tabKey, toNodes, type ExtResult, type Registry } from './modules/ext/ext.ts'
import { compactHeading, compactRows, compactView, foreignIds, grepBoundaries, grepSessionIds, lineage, parseBoundaries, transcriptPath, type FileHistory } from './modules/compact/history.ts'
import { BUDGET, LINE_KEY, MAX_LIST, budget, card, charsOf, cutEnd, dated, flat, heading, layoutRows, padEnd, rule, when, type Span } from './modules/ui/cols.ts'
import { diffFileRow, guardLines, guardRecords, guardSummary, permLines, ruleLabel, sessionLines } from './modules/ui/pages.ts'
import { titleLine } from './modules/ui/header.ts'
import { timeline } from './modules/activity/timeline.ts'
import { MODEL_KEYS, failText, findRow, type BareCommand, type ConfigRowLike } from './modules/ui/switcher.ts'
import { CHUNK, FIRST_WINDOW, entriesOf, keepNewest, normalize, readArgv, sizeLabel, splitChunk, type SearchEntry } from './modules/search/transcript.ts'
import { DEBOUNCE_MS, MAX_QUERY, MAX_RESULTS, MIN_QUERY, SEARCH_MS, SEARCH_ON_TYPE, resultLine, scan, stoppedNote, toView, type HitView } from './modules/search/fuzzy.ts'

const settings = atom({ plugin: 'binnacle', key: 'settings' } as const, DEFAULT_SETTINGS)
const snapshot = atom({ plugin: 'binnacle', key: 'snapshot' } as const, null)
const effort = atom({ plugin: 'binnacle', key: 'effort' } as const, null)
const breakdown = atom({ plugin: 'binnacle', key: 'breakdown' } as const, null)
const perm = atom({ plugin: 'binnacle', key: 'perm' } as const, EMPTY_STATS)
const extRules = atom({ plugin: 'binnacle', key: 'extRules' } as const, [])
const tab = atom({ plugin: 'binnacle', key: 'tab' } as const, 'overview' as BinnacleTab)
/**
 * The held session record lives in this module, not in `$.state`: a state write copies the whole value, and the record
 * changes on every tool call (a 2 MiB record cost each call about 50 ms). `activity` counts the changes so the drawings
 * that read it draw again. A reload of this code starts with none and reads the record back from its file.
 */
let heldRecord: BinnacleActivitySession | null = null
const activity = atom({ plugin: 'binnacle', key: 'activity' } as const, 0)

/** The held record; read while drawing, it draws again when the record changes. */
async function readHeld($: EngineInterface): Promise<BinnacleActivitySession | null> {
  await read($, activity)
  return heldRecord
}

/** Changes the held record and has the drawings draw again. */
async function updateHeld($: EngineInterface, fn: (s: BinnacleActivitySession | null) => BinnacleActivitySession | null): Promise<BinnacleActivitySession | null> {
  heldRecord = fn(heldRecord)
  const s = heldRecord
  await update($, activity, n => n + 1)
  return s
}

/** The Flow tab's live calls and tally (Flow spec §3): in this module, never saved; `flow` counts changes so its drawing draws again. */
let flowLive: Live = emptyLive()
/**
 * Whether the session is in auto mode, as far as binnacle can tell: no API gives the permission mode (the footer's mode
 * labels and classic hooks do not carry it, checked on 2.1.300), so the transcript's latest settled ask says it. There
 * the classifier settles an ask within seconds, so one long open is a call running, not one waiting (awaitsApproval).
 */
const autoModeNow = async ($: EngineInterface): Promise<boolean> => {
  const s = await readHeld($)
  return s !== null && decisionView?.sessionId === s.sessionId && decisionView.d.lastAsk === 'auto'
}
let callSeq = 0
const flow = atom({ plugin: 'binnacle', key: 'flow' } as const, 0)

/** `redraw` false for a change the next one draws anyway (a check's tally: its call ends right after). */
async function changeLive($: EngineInterface, fn: (l: Live) => Live, redraw = true): Promise<void> {
  flowLive = fn(flowLive)
  if (redraw) await update($, flow, n => n + 1).catch(() => undefined)
}
const pending = atom({ plugin: 'binnacle', key: 'pending' } as const, [])
const patches = atom({ plugin: 'binnacle', key: 'patches' } as const, [])
const viewSession = atom({ plugin: 'binnacle', key: 'viewSession' } as const, null)
const treeOpen = atom({ plugin: 'binnacle', key: 'treeOpen' } as const, [])
const treeSelected = atom({ plugin: 'binnacle', key: 'treeSelected' } as const, null)
const agentSelected = atom({ plugin: 'binnacle', key: 'agentSelected' } as const, null)
const diffSource = atom({ plugin: 'binnacle', key: 'diffSource' } as const, 'workspace')
const diffFile = atom({ plugin: 'binnacle', key: 'diffFile' } as const, null)
const workspace = atom({ plugin: 'binnacle', key: 'workspace' } as const, null)
const diffLoading = atom({ plugin: 'binnacle', key: 'diffLoading' } as const, false)
const extOpen = atom({ plugin: 'binnacle', key: 'extOpen' } as const, [])
const extRev = atom({ plugin: 'binnacle', key: 'ext' } as const, 0)
const compactions = atom({ plugin: 'binnacle', key: 'compactions' } as const, null)
const searchQuery = atom({ plugin: 'binnacle', key: 'searchQuery' } as const, '')
const searchSession = atom({ plugin: 'binnacle', key: 'searchSession' } as const, null)
const searchOpen = atom({ plugin: 'binnacle', key: 'searchOpen' } as const, null)

/**
 * The one way a string that is not a literal gets drawn: the host refuses a whole tree over one control character,
 * and saved records may hold them raw. Control characters become visible stand-ins first, then the text is cut to `max`.
 */
const printable = (text: string, max = Infinity): string => clip(visible(text), max)

// ── status ──
const TICK_MS = 15_000
const PREFIX_COLUMNS = 22 // room the engine keeps at the start of the line for "▶▶ auto mode on · "
const NOTICE_KEY = 'statusLineNoticeShown'

async function refresh($: EngineInterface, turnCostUsd?: number | null): Promise<void> {
  const u = await $.session.usage().catch(() => null)
  if (!u) return
  const prev = await read($, snapshot)
  const model = await $.session.model().catch(() => prev?.model ?? '')
  const cwd = await $.session.cwd().catch(() => prev?.cwd ?? '')
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const eff = await read($, effort)
  const turn = turnCostUsd === undefined ? prev?.turnCostUsd ?? null : turnCostUsd
  await update($, snapshot, () => toSnapshot(u, model, eff, cwd, home, turn))
  await announce($)
}

async function refreshBreakdown($: EngineInterface): Promise<void> {
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (u) await update($, breakdown, () => toBreakdown(u.context.breakdown))
}

// ── alerts (toasts; user, 2026-10-13: the line under the status line sat oddly indented) ──
const ALERT_MS = 10_000
/** The alerts that were on at the last check: one is toasted when it comes on, and again only after it went off. */
let alertsOn = new Set<string>()

async function announce($: EngineInterface): Promise<void> {
  const list = alerts(await read($, snapshot), await read($, breakdown), await $.clock.now())
  for (const a of list) if (!alertsOn.has(a.key)) $.ui.toast(printable(a.text), { timeoutMs: ALERT_MS })
  alertsOn = new Set(list.map(a => a.key))
}

// ── model and effort (spec §4.13, revised: buttons on the status line that open Claude Code's own pickers) ──
/** The /config rows; only whether the model row is locked is used. Loaded at session.start, never while drawing. */
let configRows: ConfigRowLike[] = []

async function loadSwitchRows($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  configRows = rows.map(r => ({ key: r.key, kind: r.kind, value: r.value, options: r.options, isLocked: r.isLocked }))
}

/**
 * A press on the status line's model or effort: the command with no argument, run from
 * this UI handler (a command.run hook may not run a command, P1 #13). `/model` and `/effort` open Claude Code's own
 * picker (P2-2), which saves a pick as the default on Enter and for this session only on `s`; an effort picked there
 * shows once the next turn reports it.
 */
const panelUp = async ($: EngineInterface): Promise<boolean> => (await $.ui.panes().catch(() => [])).some(p => p.id === PANE_ID)

/** The footer's `☰ binnacle`: the panel opens as `/binnacle` opens it, or closes when it is already up. */
async function togglePanel($: EngineInterface): Promise<void> {
  if (await panelUp($)) await $.ui.close({ id: PANE_ID })
  else await $.ui.open({ id: PANE_ID, title: 'binnacle', focus: true, closeOnEscape: true })
}

/** The footer's `☰ binnacle ●N`: the panel on Flow, where the running agents are drawn; pressed on Flow, it closes. */
async function openFlowTab($: EngineInterface): Promise<void> {
  if ((await panelUp($)) && (await read($, tab)) === 'flow') {
    await $.ui.close({ id: PANE_ID })
    return
  }
  await openTab($, 'flow')
  if (!(await panelUp($))) await $.ui.open({ id: PANE_ID, title: 'binnacle', focus: true, closeOnEscape: true })
}

/** The footer's `⚑ guard N`: the panel on Permissions, where the guard's refusals are listed. */
async function openGuardTab($: EngineInterface): Promise<void> {
  await openTab($, 'perm')
  if (!(await panelUp($))) await $.ui.open({ id: PANE_ID, title: 'binnacle', focus: true, closeOnEscape: true })
}

async function openPicker($: EngineInterface, kind: BareCommand): Promise<void> {
  try {
    // Resolves once the picker closes (P2-2): the line is read again so a new model shows at once.
    await $.command.run({ command: kind, args: '' })
    await refresh($)
  } catch (err) {
    $.ui.toast(failText(kind, err))
  }
}

// ── activity ──
let activityLogged = false

function logOnce($: EngineInterface, err: unknown): void {
  if (activityLogged) return
  activityLogged = true
  $.ui.log(`binnacle: activity recording failed (${String(err)}); tool calls are not affected.`)
}

/** The actions a rule from another plugin may have (BinnacleRuleMeta). */
const RULE_ACTIONS = new Set<string>(['deny', 'ask', 'rewrite'])
let ruleRefusedLogged = false

/** A rule registered with an action binnacle does not know is dropped; the first one is logged, as logOnce does. */
function ruleRefusedOnce($: EngineInterface, plugin: string, id: string): void {
  if (ruleRefusedLogged) return
  ruleRefusedLogged = true
  $.ui.log(`binnacle: ${visible(plugin)} registered rule ${visible(id)} with an action other than deny, ask or rewrite; it was not added.`)
}

const STORE_FAILED = "binnacle could not save this session's activity (the plugin data directory is not writable). It keeps recording in memory until the session ends; /binnacle activity clear deletes the saved history."
let storeWarned = false

/** HOME, under which the plugin data directory is; '' when unknown. */
const homeDir = async ($: EngineInterface): Promise<string> => (await $.env.get('HOME').catch(() => undefined)) ?? ''

/**
 * A saved session as written: its file in the plugin data directory, else the store key it was saved under before
 * 0.4.0 (until it is moved). Undefined when neither is there; a file that is not JSON is its text.
 */
async function readSaved($: EngineInterface, home: string, id: string): Promise<unknown> {
  const path = recordPath(home, id)
  const text = path === null ? undefined : await $.fs.read(path).catch(() => undefined)
  if (typeof text === 'string') {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }
  return $.store.get(sessionKey(id)).catch(() => undefined)
}

/** A saved session, read back; null when it is missing or unreadable. */
async function loadSaved($: EngineInterface, id: string): Promise<BinnacleActivitySession | null> {
  return normalizeSession(await readSaved($, await homeDir($), id))
}

/**
 * Deletes one saved session: its file, with `rm -f` on that one path (`$.fs` has no delete), and its store key when it
 * still has one. An id a path cannot be built from has no file and is never passed to rm. True when all of it went.
 */
async function removeSaved($: EngineInterface, home: string, id: string, inStore: boolean): Promise<boolean> {
  let ok = true
  if (validId(id)) {
    const path = recordPath(home, id)
    ok = path !== null && (await $.process.run(['rm', '-f', path], { timeoutMs: 10_000 }).then(r => r.exitCode === 0, () => false))
  }
  if (inStore) ok = (await $.store.delete(sessionKey(id)).then(() => true, () => false)) && ok
  return ok
}

/**
 * The index, with saved sessions it lost listed again so they count against the caps and age out: the session files
 * it does not list, and records still in the store from before 0.4.0. `stored`: the ids that have a store key.
 */
async function readIndex($: EngineInterface, home: string, currentId: string): Promise<{ index: BinnacleActivityIndexEntry[]; stored: Set<string> }> {
  let index = normalizeIndex(await $.store.get(INDEX_KEY))
  const files = home === '' ? [] : fileIds(await $.fs.list(sessionsDir(home)).catch(() => []))
  const stored = new Set(storeIds(await $.store.keys().catch(() => [] as string[])))
  for (const sessionId of unlisted([...files, ...stored], index, currentId)) {
    const raw = await readSaved($, home, sessionId)
    if (raw === undefined) continue
    const lost = normalizeSession(raw)
    // An unreadable one is listed as the oldest, so it goes first.
    const entry = lost ? entryOf(lost, sizeOf(raw)) : { sessionId, startedAt: 0, endedAt: null, cwd: '', firstPrompt: '', bytes: sizeOf(raw) }
    index = upsertIndex(index, { ...entry, sessionId })
  }
  return { index, stored }
}

/**
 * Writes one session's file and the index, dropping sessions past the caps (90 days, 500 sessions). A session with no
 * turn is not saved. Evicted sessions are deleted only once this session and the index are written. Never throws:
 * with HOME unknown or a write refused, it says so once and the session goes on recording in memory.
 */
async function save($: EngineInterface, s: BinnacleActivitySession): Promise<void> {
  if (!hasTurn(s)) return
  try {
    const home = await homeDir($)
    const path = recordPath(home, s.sessionId)
    if (path === null) throw new Error('no plugin data directory')
    const now = await $.clock.now().catch(() => 0)
    const { index: listed, stored } = await readIndex($, home, s.sessionId)
    const { keep, drop } = evict(upsertIndex(listed, entryOf(s, sizeOf(s))), s.sessionId, now)
    await $.fs.write(path, JSON.stringify(s))
    await $.store.set(INDEX_KEY, keep)
    // One that fails to go is no longer listed: the next save finds its file again, and it ages out again.
    for (const id of drop) await removeSaved($, home, id, stored.has(id))
  } catch {
    if (!storeWarned) {
      storeWarned = true
      $.ui.toast(STORE_FAILED)
    }
  }
}

/** Moves the saved sessions once a process, just after session.start, never holding it up. */
let moveStarted = false

function soonMove($: EngineInterface): void {
  if (moveStarted) return
  moveStarted = true
  try {
    $.clock.after(0, () => void moveToFiles($))
  } catch {
    void moveToFiles($)
  }
}

/**
 * Before 0.4.0 each saved session was an `activity:<id>` key in the store, which the host caps at 4 MiB in all. Each
 * one is written to its file, then its key deleted; one that fails stays in the store, is still read from there, and
 * is tried again at the next start. A file already there is newer (0.4.0 writes only files), so it is kept. The session
 * held now writes its own file: an older copy must not land over it. Never throws.
 */
async function moveToFiles($: EngineInterface): Promise<void> {
  const home = await homeDir($)
  if (home === '') return
  const keys = await $.store.keys().catch(() => [] as string[])
  for (const id of storeIds(keys)) {
    try {
      const path = recordPath(home, id)
      if (path === null) continue
      if ((await readHeld($))?.sessionId === id) continue
      const raw = await $.store.get(sessionKey(id))
      if (raw === undefined) continue
      // A file already there wins, unless the store copy is newer: an older binnacle in another terminal may still
      // save this session to the store until it restarts.
      const onDisk = (await $.fs.exists(path)) ? await $.fs.read(path).then(t => JSON.parse(String(t)) as unknown, () => null) : null
      if (onDisk === null || lastAt(raw) > lastAt(onDisk)) await $.fs.write(path, JSON.stringify(raw))
      await $.store.delete(sessionKey(id))
    } catch {
      // Left in the store for the next start.
    }
  }
}

/** Saves the held session record, pruned, and closed with `endedAt` when the session ends. Never throws. */
async function persist($: EngineInterface, end = false): Promise<void> {
  try {
    const at = await $.clock.now()
    const s = await updateHeld($, cur => (cur ? prune({ ...cur, endedAt: end ? (cur.endedAt ?? at) : cur.endedAt }) : cur))
    if (s) await save($, s)
  } catch (err) {
    logOnce($, err)
  }
}

/** The session record: kept, or the previous one saved and this id's loaded (resume) or started (new, fork, /clear). */
async function ensureSession($: EngineInterface): Promise<BinnacleActivitySession> {
  const id = await $.session.id().catch(() => 'unknown')
  const cur = await readHeld($)
  if (cur && cur.sessionId === id) {
    if (cur.endedAt === null) return cur
    // The session went on after an end (a /clear that kept its id, a resume in place): it is open again.
    return (await updateHeld($, c => (c && c.sessionId === id ? { ...c, endedAt: null } : c))) ?? cur
  }
  // `/clear` gives a new id without session.start: the old record is closed when its session.end came, else now.
  if (cur) await save($, prune({ ...cur, endedAt: cur.endedAt ?? (await $.clock.now()) }))
  const saved = await loadSaved($, id)
  const startedAt = (await $.session.usage().catch(() => null))?.startedAt ?? (await $.clock.now())
  const cwd = (await $.session.cwd().catch(() => '')) || ''
  const fresh = saved ? { ...saved, endedAt: null } : newSession(id, startedAt, cwd)
  // A call running alongside may have started this id's record already: keep it rather than overwrite its events.
  let replaced = false
  const s = await updateHeld($, c => {
    replaced = c === null || c.sessionId !== id
    return replaced ? fresh : c
  })
  if (cur && replaced) {
    await update($, patches, () => [])
    // Another session: the Flow tab's calls and tally were the old one's.
    await changeLive($, emptyLive)
  }
  return s ?? fresh
}

/** Applies one change to the session record. Errors reach the caller: the guard relies on this to fail closed. */
async function change($: EngineInterface, fn: (s: BinnacleActivitySession, at: number) => BinnacleActivitySession): Promise<void> {
  const at = await $.clock.now()
  // Another id means `$.state` started over (/clear, /resume) while this module kept the record it had.
  const id = await $.session.id().catch(() => 'unknown')
  if (heldRecord === null || heldRecord.sessionId !== id) await ensureSession($)
  await updateHeld($, s => (s ? fn(s, at) : s))
}

/** The same for everything outside the guard: a failure is logged once and never reaches the host's event chain. */
async function track($: EngineInterface, fn: (s: BinnacleActivitySession, at: number) => BinnacleActivitySession): Promise<void> {
  try {
    await change($, fn)
  } catch (err) {
    logOnce($, err)
  }
}

/**
 * Submissions under way and how each began: `turn.start` carries no origin, `prompt.submit` does and starts the
 * turn inside its `next`. Two can overlap (a hand-back while you type), so a turn takes the one with its text, or
 * the only one when a hook beneath rewrote the text.
 */
const submitting: { text: string; via: BinnacleTurnVia | null }[] = []

/**
 * Prompts of agents just spawned. On Claude Code 2.1.299 and 2.1.300 a subagent's own loop fires turn.start with its prompt as
 * the text and no agent id (binnacle records 2026-10-14 on): that turn is the agent's, not a turn of main.
 */
let spawned: { text: string; at: number }[] = []
const SPAWNED_MS = 60_000

function takeSpawned(text: string, now: number): boolean {
  spawned = spawned.filter(x => now - x.at < SPAWNED_MS)
  const i = spawned.findIndex(x => x.text === text)
  if (i < 0) return false
  spawned.splice(i, 1)
  return true
}

function takeSubmission(text: string): { via: BinnacleTurnVia | null } | null {
  const hit = submitting.find(x => x.text === text) ?? (submitting.length === 1 ? submitting[0] : undefined)
  if (hit === undefined) return null
  submitting.splice(submitting.indexOf(hit), 1)
  return { via: hit.via }
}

/**
 * How this turn began. A turn whose text is a hand-back is one (§7.1) unless a submission has exactly its text: a
 * background agent finishing while the session is busy may have its prompt.submit end before its turn.start, and it
 * must not take the one submission of the person's own prompt under way.
 */
function turnVia(text: string): BinnacleTurnVia | null {
  if (HAND_BACK.test(text) && !submitting.some(x => x.text === text)) return 'hand-back'
  return takeSubmission(text)?.via ?? null
}

async function startTurn($: EngineInterface, turnId: string, text: string, via: BinnacleTurnVia | null): Promise<void> {
  try {
    await ensureSession($)
    if (via !== 'hand-back') {
      const keep = runningAgentIds(heldRecord, liveSince)
      await changeLive($, l => newTurn(l, keep))
    }
    await change($, (s, at) => append(s, { at, turnId, agentId: null, kind: 'turn-start', prompt: brief(text), ...(via ? { auto: true as const, via } : {}) }))
  } catch (err) {
    logOnce($, err)
  }
}

/** A real call put to the decider (ask) or refused (deny) waits here until its tool.call settles. */
async function noteCheck($: EngineInterface, e: Frozen<Args<'tool.check'>>, v: EventResult<'tool.check'>): Promise<void> {
  try {
    if (e.tool_use_id === undefined || v.decision === 'allow') return
    const item: BinnaclePendingCheck = {
      toolUseId: e.tool_use_id,
      agentId: e.agentId ?? null,
      tool: e.tool,
      summary: brief(summarize(e.tool, e.input as Record<string, unknown>)),
      decision: v.decision,
      decider: v.rule !== undefined ? 'rule' : v.hook !== undefined ? 'hook' : 'unknown',
      // A denial's reason is what the model read, behind the host's `PreToolUse:Bash hook error: ` (P1 #1); an
      // external guard's is kept from its registered `<prefix><rule> · ` on, as fromText does.
      ...(v.decision === 'deny' && v.reason ? { reason: guardSourceOf(reg.guards, v.reason)?.reason ?? brief(v.reason) } : {}),
      at: await $.clock.now(),
    }
    await update($, pending, list => [...list.filter(x => x.toolUseId !== item.toolUseId), item].slice(-50))
  } catch (err) {
    logOnce($, err)
  }
}

type CallResult = { deny?: string; isError?: true; text?: string; result?: unknown }

/** The Flow tab's record of a call starting: its id, or null. Never throws, so it never refuses or reruns the call. */
async function flowCallStart($: EngineInterface, e: Frozen<Args<'tool.call'>>): Promise<string | null> {
  try {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const id = typeof input.tool_use_id === 'string' && input.tool_use_id !== '' ? input.tool_use_id : `call-${++callSeq}`
    const startedAt = await $.clock.now()
    await changeLive($, l => callStarted(l, { id, agentId: e.agentId ?? null, tool, summary: callSummary(tool, brief(summarize(tool, input))), startedAt }))
    return id
  } catch (err) {
    logOnce($, err)
    return null
  }
}

/**
 * How the call ended, for the Flow tab. Whether it was asked is read here, after `next`: tool.check fires inside the
 * call's `next` (host docs), and noteCall drops the pending check only after this. Never throws.
 */
async function flowCallEnd($: EngineInterface, id: string | null, r: CallResult): Promise<void> {
  if (id === null) return
  try {
    const asked = (await read($, pending)).some(x => x.toolUseId === id && x.decision === 'ask')
    const outcome = outcomeOf(r, asked)
    const at = await $.clock.now()
    await changeLive($, l => {
      let out = callEnded(l, id, at, outcome, outcome === 'error' ? firstLine(r.text ?? '') : undefined)
      if (asked) out = tallyAsk(out, askOutcome(r))
      else if (r.deny !== undefined && r.deny.startsWith('binnacle:')) out = tallyGuard(out)
      return out
    })
  } catch (err) {
    logOnce($, err)
  }
}

/** What 2.1.296's background-agent summary loop answers every tool call with (probe 2026-10-12). */
const SUMMARY_REFUSAL = 'No tools needed for summary'

/** How a call ended: a permission outcome, an error, an edit, or one more count. */
async function noteCall($: EngineInterface, e: Frozen<Args<'tool.call'>>, r: CallResult): Promise<void> {
  try {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const id = typeof input.tool_use_id === 'string' ? input.tool_use_id : ''
    const check = id === '' ? undefined : (await read($, pending)).find(x => x.toolUseId === id)
    if (check) await update($, pending, list => list.filter(x => x.toolUseId !== id))
    const ok = r.deny === undefined && r.isError !== true
    const patch = ok ? patchOf(tool, r.result) : null
    // No check was seen (the host gave the settings hook's denial only as the tool's error text): the prefix still tells.
    const fromText = check === undefined && r.isError === true ? guardSourceOf(reg.guards, r.text) : null
    const agentId = e.agentId
    await change($, (s, at) => {
      const who = attribute(s, agentId)
      let out = s
      let refused = false
      if (check) {
        const outcome = check.decision === 'ask' ? askOutcome(r) : null
        refused = outcome === null || outcome.startsWith('denied')
        // External guards only deny: an ask is never labelled as theirs. A deny check that carried no reason: the tool's
        // error text has what the model read.
        const fromReason = check.decision === 'deny' ? guardSourceOf(reg.guards, check.reason) : null
        const guard = fromReason ?? (check.decision === 'deny' && r.isError === true ? guardSourceOf(reg.guards, r.text) : null)
        // A guard that refused the call logged it already: one refused call is one denial.
        if (r.deny === undefined || !guardRefused(out, who.turnId, check.summary, check.at)) {
          out = append(out, {
            at, ...who, kind: 'perm', tool, summary: check.summary, decision: check.decision,
            decider: outcome === null ? check.decider : deciderOf(outcome), outcome,
            ...(check.reason ? { reason: check.reason } : guard ? { reason: guard.reason } : {}),
            ...(guard ? { source: guard.source, ruleId: guard.ruleId } : {}),
          })
        }
      } else if (fromText) {
        refused = true
        out = append(out, {
          at, ...who, kind: 'perm', tool, summary: brief(summarize(tool, input)), decision: 'deny', decider: 'hook', outcome: null,
          reason: fromText.reason, source: fromText.source, ruleId: fromText.ruleId,
        })
      }
      // 2.1.296 summarises a background agent in a loop no agent-start names, which refuses every tool with this text:
      // that refusal is Claude Code's own, not an error. Any other failure of an unnamed loop is kept.
      const summaryLoop = agentId !== undefined && who.agentId === null && r.text === SUMMARY_REFUSAL
      if (r.isError === true && !refused && !summaryLoop) out = append(out, { at, ...who, kind: 'error', tool, summary: brief(summarize(tool, input)), message: firstLine(r.text ?? '') })
      if (ok) out = bump(out, who.turnId, who.agentId, tool)
      if (patch) out = append(out, { at, ...who, kind: 'edit', tool, file: patch.file, added: patch.added, removed: patch.removed })
      return out
    })
    // One patch body is capped to what a drawing can show, so a single huge Write cannot outgrow the patch budget.
    const source = patch ? capHunks(patch.hunks, MAX_SOURCE).source : ''
    if (patch && source !== '') {
      const s = await readHeld($)
      const turnId = s ? attribute(s, agentId).turnId : ''
      await update($, patches, list => keepPatches(list, { turnId, file: patch.file, source }))
    }
  } catch (err) {
    logOnce($, err)
  }
}

/** When this process's session began: agents started earlier are history, not running. */
let liveSince = 0

const AGENTS_TICK_MS = 1_000
let agentsTick: { timer: { cancel: () => void }; at: number } | undefined

/**
 * The Agents tab's clocks move while it is drawn with a moving live row: each such draw asks for the next one a second
 * later. A closed pane, another tab or a still tab draws none, so the redraws stop by themselves. A wait a hook refused
 * never runs and says nothing, so one still pending well past its second is asked for again.
 */
function armAgentsTick($: EngineInterface, now: number): void {
  if (agentsTick && now - agentsTick.at < 2 * AGENTS_TICK_MS) return
  agentsTick?.timer.cancel()
  agentsTick = {
    at: now,
    timer: $.clock.after(AGENTS_TICK_MS, () => {
      agentsTick = undefined
      $.ui.invalidate('ui.render')
    }),
  }
}

// ── transcript (compaction history, search) ──
/** Transcript paths found, by session id: the slug rule is undocumented (probe M2), so a hit is kept. */
const transcripts = new Map<string, string>()

/** Where this session's transcript is: under the cwd's slug, else any project directory holding `<id>.jsonl`. */
async function locateTranscript($: EngineInterface, sessionId: string, cwd: string): Promise<string | null> {
  const known = transcripts.get(sessionId)
  if (known !== undefined) return known
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  if (home === '' || sessionId === '') return null
  const real = cwd === '' ? '' : (await $.fs.stat(cwd, { resolve: true }).catch(() => null))?.realPath ?? cwd
  const candidates = real === '' ? [] : [transcriptPath(home, real, sessionId)]
  for (const entry of await $.fs.list(`${home}/.claude/projects`).catch(() => [])) {
    if (entry.kind === 'dir') candidates.push(`${home}/.claude/projects/${entry.name}/${sessionId}.jsonl`)
  }
  for (const path of candidates) {
    if (await $.fs.exists(path).catch(() => false)) {
      transcripts.set(sessionId, path)
      return path
    }
  }
  return null
}

/** One transcript's boundaries and back-links, by grep with fixed arguments (SECURITY.md). Null when grep could not run. */
async function fileHistory($: EngineInterface, path: string, selfId: string): Promise<FileHistory | null> {
  try {
    const b = await $.process.run(grepBoundaries(path), { timeoutMs: 10_000 })
    if (b.exitCode > 1) return null
    const ids = await $.process.run(grepSessionIds(path), { timeoutMs: 10_000 }).catch(() => null)
    return { boundaries: parseBoundaries(b.stdout), predecessors: ids ? foreignIds(ids.stdout, selfId) : [] }
  } catch {
    return null
  }
}

/** loadCompactions just after the hook that asks for it: the hook never waits on grep, and a test clock settles it. */
function soonCompactions($: EngineInterface): void {
  try {
    $.clock.after(0, () => void loadCompactions($))
  } catch {
    void loadCompactions($)
  }
}

/** Reads this session's compaction history in the background: at session start, after each compaction, after /clear. */
async function loadCompactions($: EngineInterface): Promise<void> {
  try {
    const s = await readHeld($)
    if (!s) return
    const path = await locateTranscript($, s.sessionId, s.cwd)
    const file = path ? await fileHistory($, path, s.sessionId) : null
    // The fork chain only when the setting is on: it reads the earlier sessions' transcripts (§5.3).
    const chain = file !== null && (await read($, settings)).history.lineage
      ? await lineage(s.sessionId, async id => {
          // This session's file was just read.
          if (id === s.sessionId) return file
          const p = await locateTranscript($, id, s.cwd)
          return p ? fileHistory($, p, id) : null
        })
      : null
    const value = { sessionId: s.sessionId, found: file !== null, file: file?.boundaries ?? [], copied: (file?.predecessors.length ?? 0) > 0, lineage: chain }
    await update($, compactions, () => value)
    $.ui.invalidate('ui.render')
  } catch (err) {
    logOnce($, err)
  }
}

// ── who decided (P2-6: read from the transcript's `permissionDecision` objects, so it lasts and covers the past) ──
let decisionView: { sessionId: string; found: boolean; d: Decisions } | null = null
/** The session a drawing already asked for: a failed read is not tried again on every draw, only at the next turn or tab open. */
let decisionsAskedFor: string | null = null

function soonDecisions($: EngineInterface): void {
  try {
    $.clock.after(0, () => void loadDecisions($))
  } catch {
    void loadDecisions($)
  }
}

async function loadDecisions($: EngineInterface): Promise<void> {
  try {
    const s = await readHeld($)
    if (!s) return
    const path = await locateTranscript($, s.sessionId, s.cwd)
    if (!path) {
      decisionView = { sessionId: s.sessionId, found: false, d: NO_DECISIONS }
    } else {
      const r = await $.process.run(grepDecisions(path), { timeoutMs: 10_000 })
      // grep exits 1 when nothing matched: no decision yet.
      if (r.exitCode > 1) return
      decisionView = { sessionId: s.sessionId, found: true, d: parseDecisions(r.stdout) }
    }
    $.ui.invalidate('ui.render')
  } catch (err) {
    logOnce($, err)
  }
}

// ── search (§6: the index lives in this module only; never $.store, never a file) ──
/**
 * `failed`: the last read stopped on an error (a timeout); what was read is kept and the rest is tried at the next
 * search. `skip`: `offset` is inside a line (the first window's start, or past a line too long to index), so the next
 * read drops up to its first line break, as the one that failed would have.
 */
type SearchIndex = { sessionId: string; path: string; size: number; mtime: number; start: number; offset: number; skip: boolean; entries: SearchEntry[]; skipped: number; stale: boolean; failed: boolean }
/** At most two sessions' indexes, the most recent last. */
const indexes = new Map<string, SearchIndex>()
/** The Search tab was drawn since the end of a turn last re-ran its query (the turn.complete hook clears it). */
let searchDrawn = false
let searchView: { sessionId: string; query: string; hits: HitView[]; total: number; info: string } | null = null
let searchTimer: { cancel: () => void } | undefined
/** The latest runQuery: an earlier one still reading (another query, another session) never writes the view. */
let searchGen = 0

/**
 * Brings one session's index up to date: the newest FIRST_WINDOW bytes the first time, then on from where it stopped,
 * in CHUNK reads that end at a line break; a file that shrank is read again from its window. Kept until the file
 * changes or a turn marks it stale. Never called while drawing.
 */
async function buildIndex($: EngineInterface, sessionId: string, cwd: string): Promise<SearchIndex | null> {
  const path = await locateTranscript($, sessionId, cwd)
  if (path === null) return null
  const st = await $.fs.stat(path).catch(() => null)
  if (!st || st.kind !== 'file') return null
  let ix = indexes.get(sessionId)
  if (ix && (st.size < ix.offset || ix.path !== path)) ix = undefined
  if (ix && !ix.stale && !ix.failed && ix.mtime === st.mtimeMs && ix.size === st.size) {
    // Used again: last in the map, so the eviction below drops the least recently used.
    indexes.delete(sessionId)
    indexes.set(sessionId, ix)
    return ix
  }
  const start = ix ? ix.start : Math.max(0, st.size - FIRST_WINDOW)
  let offset = ix ? ix.offset : start
  let skip = ix ? ix.skip : start > 0
  let entries = ix ? ix.entries : []
  let skipped = ix ? ix.skipped : 0
  let failed = false
  while (offset < st.size) {
    const length = Math.min(CHUNK, st.size - offset)
    // A read that times out or cannot start ends this build; the chunks before it are kept.
    const r = await $.process.run(readArgv(path, offset, length), { timeoutMs: 10_000 }).catch(() => null)
    if (r === null || r.exitCode !== 0) {
      failed = true
      break
    }
    if (r.stdout === '') break
    const part = splitChunk(r.stdout, skip)
    if (part.noBreak) {
      // The file's end: a line still being written waits for the next read. A whole chunk: one line too long to index.
      if (length < CHUNK) break
      if (!skip) skipped++
      offset += length
      skip = true
      continue
    }
    skip = false
    entries = keepNewest(entries, part.lines.flatMap(entriesOf))
    offset += part.consumed
  }
  const next: SearchIndex = { sessionId, path, size: st.size, mtime: st.mtimeMs, start, offset, skip, entries, skipped, stale: false, failed }
  indexes.delete(sessionId)
  indexes.set(sessionId, next)
  while (indexes.size > 2) indexes.delete(indexes.keys().next().value as string)
  return next
}

/** The session the Search tab looks in: this one, or the saved one picked in its Session list. */
async function searchTarget($: EngineInterface): Promise<{ sessionId: string; cwd: string; record: BinnacleActivitySession | null } | null> {
  const picked = await read($, searchSession)
  if (picked === null) {
    const live = await readHeld($)
    return live ? { sessionId: live.sessionId, cwd: live.cwd, record: live } : null
  }
  const record = await loadSaved($, picked)
  return { sessionId: picked, cwd: record?.cwd ?? '', record }
}

async function runQuery($: EngineInterface, text: string): Promise<void> {
  const gen = ++searchGen
  const query = text.slice(0, MAX_QUERY)
  try {
    searchTimer?.cancel()
    await update($, searchQuery, () => query)
    const target = await searchTarget($)
    if (gen !== searchGen) return
    if (target === null || normalize(query).length < MIN_QUERY) {
      searchView = null
      $.ui.invalidate('ui.render')
      return
    }
    const ix = await buildIndex($, target.sessionId, target.cwd)
    // A newer search (another query, another session) owns the view.
    if (gen !== searchGen) return
    if (ix === null) {
      searchView = { sessionId: target.sessionId, query, hits: [], total: 0, info: 'transcript not found' }
      $.ui.invalidate('ui.render')
      return
    }
    // The plugin's own synchronous clock: $.clock.now() is a promise, and the scan reads the time between entries.
    const began = performance.now()
    const { hits, cut } = scan(ix.entries, query, { now: () => performance.now(), until: began + SEARCH_MS })
    const stopped = stoppedNote(cut)
    const turns = target.record ? target.record.events.filter(ev => ev.kind === 'turn-start').length : 0
    const info = [
      `${ix.entries.length.toLocaleString('en-US')} rows`,
      ...(ix.start > 0 ? [`last ${sizeLabel(ix.size - ix.start)} of ${sizeLabel(ix.size)}`] : []),
      ...(turns ? [`indexed after turn #${turns}`] : []),
      ...(ix.skipped ? [`${ix.skipped} long line${ix.skipped === 1 ? '' : 's'} skipped`] : []),
      ...(ix.failed ? ['transcript could not be read'] : []),
      ...(stopped ? [stopped] : []),
    ].join(' · ')
    searchView = { sessionId: target.sessionId, query, hits: hits.slice(0, MAX_RESULTS).map(h => toView(h, target.record)), total: hits.length, info }
    $.ui.invalidate('ui.render')
  } catch (err) {
    logOnce($, err)
  }
}

/** Typing: the text is kept at once, the search waits DEBOUNCE_MS (or for Enter when searching is slow, P1 #7). */
/**
 * Enter in the Find field: Claude Code empties the field on Enter and does not draw the same value into it again
 * (P2-5), so each Enter gives the field a new key; it is drawn afresh with the query, the focus still on it.
 */
let searchSubmits = 0
async function submitQuery($: EngineInterface, text: string): Promise<void> {
  searchSubmits += 1
  await runQuery($, text)
}

async function typeQuery($: EngineInterface, text: string): Promise<void> {
  const query = text.slice(0, MAX_QUERY)
  searchTimer?.cancel()
  await update($, searchQuery, () => query)
  if (SEARCH_ON_TYPE) searchTimer = $.clock.after(DEBOUNCE_MS, () => void runQuery($, query))
}

async function pickSearchSession($: EngineInterface, value: string): Promise<void> {
  await update($, searchSession, () => (value === 'current' ? null : value))
  await runQuery($, await read($, searchQuery))
}

/** Enter on a result: the whole message opens under its row, or closes when it is the open one. */
async function toggleHit($: EngineInterface, i: number): Promise<void> {
  const v = searchView
  if (!v) return
  await update($, searchOpen, c => (c && c.sessionId === v.sessionId && c.query === v.query && c.i === i ? null : { sessionId: v.sessionId, query: v.query, i }))
}

/** The button under an open result: the Activity tab, on the same session, with that turn open and selected. */
async function jumpTo($: EngineInterface, i: number): Promise<void> {
  const h = searchView?.hits[i]
  if (!h || h.turnId === null) return
  const picked = await read($, searchSession)
  await pickSession($, picked ?? 'current')
  const s = picked === null ? await readHeld($) : await loadSaved($, picked)
  const key = `turn:${h.turnId}`
  const defaults = s ? openByDefault(s) : []
  await update($, treeOpen, () => (defaults.includes(key) ? [] : [key]))
  await update($, treeSelected, () => key)
  await update($, tab, () => 'activity')
}

// ── guard ──
const CHECK_FAILED = 'binnacle: the guard failed while checking this call, so it was blocked. Turn the guard off in /config if this keeps happening.'

/** Asks in the engine's own dialog. A dismissed dialog or a run with no one to ask (-p) counts as a refusal. */
export async function askUser($: EngineInterface, title: string, reason: string, preview: string[]): Promise<AskResult> {
  try {
    return interpret(await $.ui.ask(question(title, reason, preview), { options: [ALLOW, DENY], header: 'binnacle' }))
  } catch {
    return interpret(null)
  }
}

async function record($: EngineInterface, ruleId: string, action: BinnacleGuardAction, summary: string, agentId?: string): Promise<void> {
  await change($, (s, at) => append(s, { at, ...attribute(s, agentId), kind: 'guard', ruleId, action, summary: brief(summary) }))
}

/** The guard's tool.call body: rules, rewrite, ask. */
async function guardToolCall($: EngineInterface, e: Frozen<Args<'tool.call'>>, next: Next<'tool.call'>): Promise<EventResult<'tool.call'>> {
  const input = e as unknown as Record<string, unknown>
  const s = await read($, settings)
  const cwd = (await $.session.cwd().catch(() => null)) || null
  const home = (await $.env.get('HOME').catch(() => null)) || null
  const hit = evaluate(BUILTIN_RULES, (id, def) => ruleEnabled(s, id, def), String(e.tool), input, { cwd, home })
  if (hit === null) return next(e)
  const { rule, verdict } = hit
  const summary = summarize(String(e.tool), input)

  if (verdict.kind === 'deny') {
    await record($, rule.id, 'deny', summary, e.agentId)
    return { deny: denyMessage(verdict.reason) }
  }

  if (verdict.kind === 'rewrite') {
    const r = await next({ ...e, ...verdict.input } as typeof e)
    await record($, rule.id, 'rewrite', summary, e.agentId)
    return r.deny !== undefined ? r : { ...r, context: [...(r.context ?? []), `binnacle: ${verdict.note}`] }
  }

  const preview = verdict.preview === null ? null : await runPreview(verdict.preview, argv => $.process.run(argv, { cwd: cwd ?? undefined, timeoutMs: 10_000 }))
  // The preview covers one command; a line holding others always asks.
  if (preview?.nothingLost && bashCommands(input).length === 1) {
    await record($, rule.id, 'auto-allow', summary, e.agentId)
    return next(e)
  }
  const answer = await askUser($, rule.title, verdict.reason, preview?.lines ?? [])
  if (answer.ok) {
    await record($, rule.id, 'ask-allow', summary, e.agentId)
    return next(e)
  }
  await record($, rule.id, 'ask-deny', summary, e.agentId)
  const said = answer.note ? ` They said: "${answer.note}"` : ''
  return { deny: denyMessage(`The user declined: ${verdict.reason}${said}`) }
}

// ── diff ──
/** Reads the working tree: read-only git with fixed arguments in the session directory (SECURITY.md). */
async function loadWorkspace($: EngineInterface): Promise<void> {
  await update($, diffLoading, () => true)
  const cwd = (await $.session.cwd().catch(() => null)) || undefined
  let value: BinnacleWorkspaceDiff
  try {
    const diff = await $.process.run(GIT_DIFF, { cwd, timeoutMs: 10_000 })
    const status = await $.process.run(GIT_STATUS, { cwd, timeoutMs: 10_000 }).catch(() => null)
    value = workspaceDiff(diff, status)
  } catch (err) {
    // process.run rejects when git cannot start or outlasts its timeout.
    value = { kind: 'error', message: `git could not run: ${String(err).split('\n')[0] ?? ''}` }
  }
  await update($, workspace, () => value)
  await update($, diffLoading, () => false)
}

/** The chosen source while it is still listed: a turn gone with its session (`/clear`) or past the list's 63 falls back to Workspace. */
async function effectiveSource($: EngineInterface): Promise<string> {
  const src = await read($, diffSource)
  if (src === 'workspace') return src
  const s = await readHeld($)
  return s && sourceTurns(s).some(t => t.turnId === src) ? src : 'workspace'
}

async function openTab($: EngineInterface, id: BinnacleTab): Promise<void> {
  await update($, tab, () => id)
  if (id === 'diff' && (await effectiveSource($)) === 'workspace') await loadWorkspace($)
  if (id === 'search') await runQuery($, await read($, searchQuery))
  if (id === 'perm') soonDecisions($)
  if (id.startsWith('ext:')) {
    const t = reg.tabs.find(x => tabKey(x) === id)
    if (t) notify($, { plugin: t.plugin, kind: 'open', id: t.id })
  }

}

async function pickSource($: EngineInterface, value: string): Promise<void> {
  await update($, diffSource, () => value)
  await update($, diffFile, () => null)
  if (value === 'workspace') await loadWorkspace($)
}

// ── plugins (spec 2026-10-16 §4) ──
/**
 * What other plugins registered, held by this module for the process: `/clear` and `/resume` start `$.state` over
 * with no session.start after them (spec F21), so nothing here is cleared when a session ends.
 */
let reg: Registry = emptyRegistry()

async function changeReg($: EngineInterface, fn: (r: Registry) => Registry): Promise<void> {
  reg = fn(reg)
  await update($, extRev, n => n + 1)
  $.ui.invalidate('ui.render')
}

/** A registration call's answer: refused with binnacle's reason, or held and drawn. */
async function applyReg<T>($: EngineInterface, r: ExtResult<T>, put: (g: Registry, list: T[]) => Registry): Promise<{ deny: string } | { value: { ok: true } }> {
  if (!r.ok) return { deny: r.reason }
  const list = r.list
  await changeReg($, g => put(g, list))
  return { value: { ok: true as const } }
}

/**
 * Tells a plugin that the person used something it registered: never awaited by the press. A subscriber that throws
 * is skipped by the engine, which shows a line for it (spec F26); a failure of the call itself is logged here.
 */
function notify($: EngineInterface, e: BinnacleNotify): void {
  void $.binnacle.notify(e).catch((err: unknown) => $.ui.log(`binnacle: telling ${e.plugin} about ${e.kind} ${e.id} failed: ${firstLine(String(err))}`))
}

// ── panel ──
const PANE_ID = 'binnacle'

/**
 * Changes the stored settings and holds the result. `$.state` starts over at `/clear` and an in-process `/resume`,
 * so the held copy may be the defaults: the change is made on what the store has. An unreadable store is left alone
 * and a full one keeps the change for this session only; neither breaks the command or the button.
 */
async function changeStored($: EngineInterface, fn: (s: BinnacleSettings) => BinnacleSettings): Promise<BinnacleSettings> {
  const stored = await $.store.get(STORE_KEY).then(normalizeSettings, () => null)
  const next = fn(stored ?? (await read($, settings)))
  if (stored) await $.store.set(STORE_KEY, next).catch(() => undefined)
  await update($, settings, () => next)
  return next
}

/** The changes of this process, one after another: a button press is not awaited, so two could read the same store. */
let settingsQueue: Promise<unknown> = Promise.resolve()

async function changeSettings($: EngineInterface, fn: (s: BinnacleSettings) => BinnacleSettings): Promise<BinnacleSettings> {
  const run = settingsQueue.then(() => changeStored($, fn))
  settingsQueue = run.catch(() => undefined)
  return run
}

async function toggleItem($: EngineInterface, item: BinnacleItem, enabled?: boolean): Promise<boolean> {
  const next = await changeSettings($, s => setItem(s, item, enabled ?? !s.status[item]))
  return next.status[item]
}

async function toggleRule($: EngineInterface, id: string, def: boolean, enabled?: boolean): Promise<boolean> {
  const next = await changeSettings($, s => setRule(s, id, enabled ?? !ruleEnabled(s, id, def)))
  return ruleEnabled(next, id, def)
}

async function togglePlugin($: EngineInterface, name: string): Promise<void> {
  await changeSettings($, x => setPlugin(x, name, !pluginEnabled(x, name)))
  $.ui.invalidate('ui.render')
}

/** A plugin setting in Settings: stored with binnacle's settings, then the plugin is told its new value. */
async function togglePluginSetting($: EngineInterface, item: BinnacleSettingItem): Promise<void> {
  const next = await changeSettings($, s => setPluginSetting(s, item.plugin, item.id, !pluginSetting(s, item.plugin, item.id, item.def)))
  $.ui.invalidate('ui.render')
  notify($, { plugin: item.plugin, kind: 'setting', id: item.id, value: pluginSetting(next, item.plugin, item.id, item.def) })
}

async function toggleLineage($: EngineInterface): Promise<void> {
  await changeSettings($, s => setLineage(s, !s.history.lineage))
  await loadCompactions($)
}

async function pressNode($: EngineInterface, key: string, hasChildren: boolean): Promise<void> {
  await update($, treeSelected, () => key)
  if (hasChildren) await update($, treeOpen, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
}

/** Plugin tabs keep their own open rows: picking a session empties the Activity tree's. */
async function pressExtNode($: EngineInterface, key: string): Promise<void> {
  await update($, extOpen, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
}

async function pickSession($: EngineInterface, value: string): Promise<void> {
  await update($, viewSession, () => (value === 'current' ? null : value))
  await update($, treeSelected, () => null)
  await update($, treeOpen, () => [])
  await update($, agentSelected, () => null)
}

async function deleteSaved($: EngineInterface, id: string): Promise<void> {
  await removeSaved($, await homeDir($), id, true)
  const index = normalizeIndex(await $.store.get(INDEX_KEY).catch(() => undefined))
  await $.store.set(INDEX_KEY, index.filter(x => x.sessionId !== id)).catch(() => undefined)
  await update($, viewSession, () => null)
}

/**
 * `/binnacle activity clear`: deletes every saved session but this one, after asking. The current session is
 * known from its record or the host; when neither knows it, or no one can be asked (-p), nothing is deleted.
 */
async function clearHistory($: EngineInterface): Promise<string> {
  const keep = new Set([(await readHeld($))?.sessionId, await $.session.id().catch(() => undefined)].filter((id): id is string => typeof id === 'string' && id !== ''))
  if (keep.size === 0) return 'nothing deleted.'
  const home = await homeDir($)
  const index = normalizeIndex(await $.store.get(INDEX_KEY).catch(() => undefined))
  const stored = new Set(storeIds(await $.store.keys().catch(() => [] as string[])))
  const files = home === '' ? [] : fileIds(await $.fs.list(sessionsDir(home)).catch(() => []))
  // Saved sessions the index lost (a write that failed half way) are swept too, and records not yet moved to files.
  const targets = [...new Set([...index.map(x => x.sessionId), ...files, ...stored])].filter(id => !keep.has(id))
  if (targets.length === 0) return 'no saved sessions besides this one.'
  const question = `This session is kept. Delete ${targets.length} saved session(s) from binnacle's activity history?`
  // Cancel first: the dialog's cursor starts on the first option (e2e 24), so a stray Enter deletes nothing.
  const answer = await $.ui.ask(question, { options: ['Cancel', 'Delete'], header: 'binnacle' }).catch(() => null)
  if (answer !== 'Delete') return 'nothing deleted.'
  const deleted = new Set<string>()
  for (const id of targets) {
    if (await removeSaved($, home, id, stored.has(id))) deleted.add(id)
  }
  // Read again: a session saved while the question was open is not one the person agreed to delete.
  const fresh = await $.store.get(INDEX_KEY).then(normalizeIndex, () => index)
  await $.store.set(INDEX_KEY, fresh.filter(x => !deleted.has(x.sessionId))).catch(() => undefined)
  await update($, viewSession, () => null)
  $.ui.invalidate('ui.render')
  return `deleted ${deleted.size} saved session(s).`
}

// ── across /clear and /resume ──
// `/clear` and an in-process `/resume <id>` start `$.state` over under the new session id, and no session.start
// follows: session.end comes first, with the old values still held (probed on 2.1.296). What has to outlive that is
// loaded back by `hydrate`: the stored settings, this id's record, the status figures, and what this process keeps.

/** The session the process just left by `/clear` or `/resume`: until the id moves on, there is nothing to load. */
let leaving: string | null = null
/** The id last loaded back, so one session is loaded at most once by the drawings and the tick. */
let hydratedFor: string | null = null
let lastEffort: string | null = null
/** Rules other plugins registered: they register once per process, at their session.start. */
let extRuleList: BinnacleRuleMeta[] = []
/** Permission checks since Claude Code started; `perm` holds a copy for the drawing. */
let permTotal: BinnaclePermStats = EMPTY_STATS

async function countCheck($: EngineInterface, tool: string, decision: 'allow' | 'ask' | 'deny'): Promise<void> {
  permTotal = tally(permTotal, tool, decision)
  // Read at write time: two checks settling out of order must not let the older tally land last.
  await update($, perm, () => permTotal)
}

/** The registered rules, with any `$.state` holds that this module does not (one held before a reload). */
async function withHeldRules($: EngineInterface): Promise<BinnacleRuleMeta[]> {
  const held = await read($, extRules)
  return [...held.filter(h => !extRuleList.some(r => r.id === h.id)), ...extRuleList]
}

/**
 * session.start fires again when this code is reloaded or its worker respawns: `$.state` is kept, this module starts
 * empty. What the module keeps for the process is taken from what is held.
 */
async function adopt($: EngineInterface): Promise<void> {
  permTotal = await read($, perm)
  extRuleList = await withHeldRules($)
  lastEffort = (await read($, effort)) ?? lastEffort
}

async function loadSettings($: EngineInterface): Promise<void> {
  const raw = await $.store.get(STORE_KEY).catch(() => undefined)
  await update($, settings, () => normalizeSettings(raw))
}

/** Loads back what `$.state` lost. Never throws. */
async function hydrate($: EngineInterface, statusOn: boolean): Promise<void> {
  try {
    hydratedFor = await $.session.id().catch(() => 'unknown')
    await loadSettings($)
    const rules = extRuleList
    await update($, extRules, () => rules)
    const p = permTotal
    await update($, perm, () => p)
    await ensureSession($)
    if (statusOn) {
      const eff = lastEffort
      if (eff !== null) await update($, effort, () => eff)
      await refresh($, null)
      await refreshBreakdown($)
    }
    soonCompactions($)
  } catch (err) {
    logOnce($, err)
  }
}

/**
 * Run by the drawings and the tick: a held record that is not this session's means `$.state` started over. A drawing
 * cannot write, so the load runs just after it, and the values it wrote draw again.
 */
async function heal($: EngineInterface, statusOn: boolean, held: BinnacleActivitySession | null): Promise<void> {
  const id = await $.session.id().catch(() => 'unknown')
  if (held?.sessionId === id || id === leaving || id === hydratedFor) return
  hydratedFor = id
  try {
    $.clock.after(0, () => void hydrate($, statusOn))
  } catch {
    hydratedFor = null
  }
}

/** A prompt runs in the session it was typed in: load it first if nothing drew since the switch. */
async function catchUp($: EngineInterface, statusOn: boolean): Promise<void> {
  const id = await $.session.id().catch(() => 'unknown')
  if ((await readHeld($))?.sessionId !== id) await hydrate($, statusOn)
}

let timer: { cancel: () => void } | undefined
let costAtTurnStart: number | null = null
let receiptCostAtStart: number | null = null

export const register: Register = (on, options) => {
  const statusOn = options.status_enabled !== false
  const guardOn = options.guard_enabled !== false

  // ── noun ──
  // Methods are stubs: each call is the `binnacle.<method>` event, answered by the hooks below.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return {
      ...built,
      binnacle: {
        version: async () => ({ api: API, binnacle: VERSION }),
        register: async () => ({ ok: true as const }),
        enabled: async () => false,
        ask: async () => 'deny' as const,
        record: async () => ({ ok: true as const }),
        shell: async () => ({ segments: [] }),
        attention: async () => ({ ok: true as const }),
        tab: async () => ({ ok: true as const }),
        button: async () => ({ ok: true as const }),
        segment: async () => ({ ok: true as const }),
        line: async () => ({ ok: true as const }),
        setting: async () => ({ ok: true as const, value: false }),
        guardSource: async () => ({ ok: true as const }),
        notify: async () => ({ handled: false }),
      },
    }
  })

  on('binnacle.register', async ($, e, next) => {
    // Settings draws the action: only the three binnacle knows (a control character in it would get the tab refused).
    if (!RULE_ACTIONS.has(e.action)) {
      ruleRefusedOnce($, next.origin.plugin, e.id)
      return { value: { ok: true as const } }
    }
    const meta = { id: e.id, pack: e.pack, title: e.title, action: e.action }
    extRuleList = [...(await withHeldRules($)).filter(r => r.id !== meta.id), meta]
    const rules = extRuleList
    await update($, extRules, () => rules)
    return { value: { ok: true as const } }
  })

  on('binnacle.enabled', async ($, e) => ({ value: guardOn && ruleEnabled(await read($, settings), e.id, true) }))

  on('binnacle.ask', async ($, e) => {
    const meta = (await read($, extRules)).find(r => r.id === e.ruleId)
    const r = await askUser($, meta?.title ?? e.ruleId, e.reason, e.preview)
    return { value: r.ok ? ('allow' as const) : ('deny' as const) }
  })

  on('binnacle.record', async ($, e) => {
    await record($, visible(e.ruleId), e.action, e.summary)
    return { value: { ok: true as const } }
  })

  on('binnacle.shell', async ($, e) => ({ value: { segments: commands(e.command).filter(c => c.words[0] !== ASSIGNMENTS).map(c => ({ text: c.text, words: c.words })) } }))

  on('binnacle.version', async () => ({ value: { api: API, binnacle: VERSION } }))

  on('binnacle.attention', async ($, e, next) => {
    const before = reg.attention
    const r = setAttention(before, next.origin.plugin, e)
    if (!r.ok) return { deny: r.reason }
    const list = r.list
    await changeReg($, g => ({ ...g, attention: list }))
    // Shown as a toast when it is new or its text changed, under the plugin's name, while the person has it on.
    const item = list.find(x => x.plugin === next.origin.plugin && !before.some(y => y.plugin === x.plugin && y.id === x.id && y.text === x.text))
    if (item && pluginEnabled(await read($, settings), item.plugin)) $.ui.toast(printable(`${item.plugin}: ${item.text}`), { timeoutMs: ALERT_MS })
    return { value: { ok: true as const } }
  })

  on('binnacle.tab', async ($, e, next) =>
    applyReg($, setTab(reg.tabs, next.origin.plugin, e as { id: string; title: string; rows: readonly BinnacleTabRow[] }), (g, list) => ({ ...g, tabs: list })))

  on('binnacle.button', async ($, e, next) => applyReg($, setButton(reg.buttons, next.origin.plugin, e), (g, list) => ({ ...g, buttons: list })))

  on('binnacle.segment', async ($, e, next) => applyReg($, setSegment(reg.segments, next.origin.plugin, e), (g, list) => ({ ...g, segments: list })))

  on('binnacle.line', async ($, e, next) => applyReg($, setLine(reg.lines, next.origin.plugin, e), (g, list) => ({ ...g, lines: list })))

  on('binnacle.setting', async ($, e, next) => {
    const plugin = next.origin.plugin
    const r = setSetting(reg.settings, plugin, e)
    if (!r.ok) return { deny: r.reason }
    const list = r.list
    await changeReg($, g => ({ ...g, settings: list }))
    // Read from the store: `$.state` may hold the defaults after /clear until a drawing loads it back.
    const stored = normalizeSettings(await $.store.get(STORE_KEY).catch(() => undefined))
    const item = list.find(x => x.plugin === plugin && x.id === String(e.id))
    return { value: { ok: true as const, value: item ? pluginSetting(stored, plugin, item.id, item.def) : e.default === true } }
  })

  on('binnacle.guardSource', async ($, e, next) => applyReg($, setGuardSource(reg.guards, next.origin.plugin, e), (g, list) => ({ ...g, guards: list })))

  /** The bottom of the chain: a press no plugin took. */
  on('binnacle.notify', async () => ({ value: { handled: false } }))

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    alertsOn = new Set()
    await adopt($)
    await loadSettings($)
    // Ahead of the /binnacle registration, so a failure here must never stop it.
    try {
      liveSince = await $.clock.now()
    } catch (err) {
      logOnce($, err)
    }
    try {
      await ensureSession($)
    } catch (err) {
      logOnce($, err)
    }
    soonCompactions($)
    soonMove($)
    await $.command.register({
      name: 'binnacle',
      description: 'Open the binnacle panel, or: activity [clear], agents, flow, diff, search [query], status show|hide <item>, guard on|off <rule>, guard list',
      argumentHint: '[activity|agents|flow|diff|search|status|guard …]',
    }).catch(() => undefined)
    if (statusOn) {
      timer?.cancel()
      timer = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
      await refresh($, null)
      await refreshBreakdown($)
      await loadSwitchRows($)
      const user = (await $.settings.read({ source: 'user' }).catch(() => ({}))) as Record<string, unknown>
      if (user.statusLine !== undefined && (await $.store.get(NOTICE_KEY).catch(() => undefined)) !== true) {
        $.ui.toast('binnacle draws the status line below the prompt. You can remove the statusLine setting so it is not shown twice.')
        await $.store.set(NOTICE_KEY, true).catch(() => undefined)
      }
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const item = { text: e.text, via: viaOf(e.origin, e.text) }
    submitting.push(item)
    try {
      return await next(e)
    } finally {
      const i = submitting.indexOf(item)
      if (i >= 0) submitting.splice(i, 1)
    }
  })

  on('turn.start', async ($, e, next) => {
    // The person's own prompt with an agent prompt's very words is still theirs: a submission under way says so.
    if (e.text !== '' && !submitting.some(x => x.text === e.text) && takeSpawned(e.text, await $.clock.now().catch(() => 0))) return next(e)
    const via = turnVia(e.text)
    await catchUp($, statusOn)
    receiptCostAtStart = (await $.session.usage().catch(() => null))?.cost?.usd ?? null
    if (statusOn) costAtTurnStart = (await read($, snapshot))?.costUsd ?? null
    const r = await next(e)
    await startTurn($, e.turnId, e.text, via)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // Main's turn or an agent's run is over: a call of its still running was cut off.
    const endedAt = await $.clock.now().catch(() => 0)
    await changeLive($, l => endRunning(l, e.agentId ?? null, endedAt))
    if (e.agentId === undefined) {
      const cost = (await $.session.usage().catch(() => null))?.cost?.usd ?? null
      const delta = receiptCostAtStart !== null && cost !== null ? Math.max(0, cost - receiptCostAtStart) : null
      await track($, (s, at) => append(s, { at, turnId: e.turnId, agentId: null, kind: 'turn-end', durationMs: e.durationMs, costUsd: delta, aborted: e.isAborted }))
      await persist($)
      // Claude Code 2.1.300 fires no session.compact (nor a classic PostCompact) for /compact: the transcript is
      // counted again once a turn ends, so a compaction it did not report shows by the end of the next turn.
      soonCompactions($)
      // The index is rebuilt at most once a turn: marked stale here, read on at the next search (§6.2).
      const held = await readHeld($)
      const ix = held ? indexes.get(held.sessionId) : undefined
      if (ix) ix.stale = true
      // Who decided is read at every turn's end: its latest settled ask tells auto mode (autoModeNow), and the
      // Permissions tab draws it. One grep of the transcript, as the compaction count.
      soonDecisions($)
      // Only a Search tab drawn since the last re-run: with the pane closed nothing is read until it opens again.
      if (searchDrawn && (await read($, tab)) === 'search' && (await read($, searchSession)) === null) {
        searchDrawn = false
        void runQuery($, await read($, searchQuery))
      }
      } else {
      const agentId = e.agentId
      await track($, (s, at) => append(s, {
        at, turnId: agentTurn(s, agentId) ?? currentTurn(s), agentId, kind: 'agent-end',
        durationMs: e.durationMs, ...tokensOf(e.usage), aborted: e.isAborted, report: reportLines(e.answer),
      }))
    }
    if (statusOn && e.agentId === undefined) {
      const before = costAtTurnStart
      await refresh($)
      const now = await read($, snapshot)
      const delta = before !== null && now?.costUsd != null ? Math.max(0, now.costUsd - before) : null
      await update($, snapshot, s => (s ? { ...s, turnCostUsd: delta } : s))
      await refreshBreakdown($)
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const id = await flowCallStart($, e)
    const r = guardOn ? await guardToolCall($, e, next) : await next(e)
    await flowCallEnd($, id, r as CallResult)
    await noteCall($, e, r as CallResult)
    return r
  }).catch(($, e, next) => (next.called ? next(e) : { deny: CHECK_FAILED }))

  on('agent.spawn', async ($, e, next) => {
    if (e.prompt) {
      // Read the clock first: agents spawned at once must not overwrite each other's entry across the await.
      const at = await $.clock.now().catch(() => 0)
      spawned = [...spawned, { text: e.prompt, at }].slice(-20)
    }
    const r = await next(e)
    if (r.agentId !== undefined) {
      const agentId = r.agentId
      const model = r.model
      const parent = e.parentAgentId ?? null
      await track($, (s, at) => append(s, {
        at, turnId: (parent !== null ? agentTurn(s, parent) : null) ?? currentTurn(s), agentId, kind: 'agent-start',
        agentType: e.subagentType, model, task: brief(e.description || e.prompt), parentAgentId: parent, background: e.background,
        ...(e.isTeammate === true ? { teammate: true as const } : {}),
      }))
    }
    return r
  })

  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    await noteCheck($, e, v)
    if (e.tool_use_id !== undefined) {
      const by = v.rule !== undefined ? 'rule' : v.hook !== undefined ? 'hook' : 'other'
      const guard = v.decision === 'deny' && guardSourceOf(reg.guards, v.reason) !== null
      await changeLive($, l => tallyCheck(l, v.decision, by, guard), false)
    }
    if (guardOn && e.tool_use_id !== undefined) await countCheck($, e.tool, v.decision)
    return v
  })

  on('session.compact', async ($, e, next) => {
    const started = await $.clock.now().catch(() => 0)
    const trigger = e.trigger
    const agentId = e.agentId
    const r = await next(e)
    // A compaction another plugin skipped did not happen.
    if (!('skip' in r && r.skip !== undefined)) {
      const ended = await $.clock.now().catch(() => started)
      await track($, (s, at) => append(s, {
        at, ...attribute(s, agentId), kind: 'compact', trigger,
        tokensBefore: r.tokensBefore ?? null, tokensAfter: r.tokensAfter ?? null, durationMs: Math.max(0, ended - started),
      }))
    }
    if (statusOn) {
      await refresh($)
      await refreshBreakdown($)
    }
    await persist($)
    soonCompactions($)
    return r
  })

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') leaving = e.sessionId
    await persist($, true)
    await update($, extOpen, () => [])
    return r
  })

  // ── panel ──
  on('command.run', { command: 'binnacle' }, async ($, e) => {
    const cmd = parseCommand(e.args)
    // The host shows a hook's own `{ text }` under the plugin's name, so no reply text starts with `binnacle: `.
    if (cmd.kind === 'error') return { text: cmd.message }
    if (cmd.kind === 'open') {
      const t = cmd.tab
      // The pane opens first: the Diff tab shows that it is reading while git runs.
      if (cmd.query) {
        const q = cmd.query
        await update($, searchQuery, () => q)
      }
      if (t) await update($, tab, () => t)
      await $.ui.open({ id: PANE_ID, title: 'binnacle', focus: true, closeOnEscape: true, ...(t === 'diff' ? { columns: 120 } : {}) })
      if (t) await openTab($, t)
      return { text: 'panel opened (Esc closes it).' }
    }
    if (cmd.kind === 'activity-clear') return { text: await clearHistory($) }
    if (cmd.kind === 'status') {
      const shown = await toggleItem($, cmd.item, cmd.on)
      return { text: `${cmd.item} ${shown ? 'shown' : 'hidden'}.` }
    }
    if (cmd.kind === 'rule') {
      const def = BUILTIN_RULES.find(r => r.id === cmd.id)?.defaultEnabled ?? true
      const onNow = await toggleRule($, cmd.id, def, cmd.on)
      return { text: `rule ${cmd.id} turned ${onNow ? 'on' : 'off'}.` }
    }
    const s = await read($, settings)
    const rows = [
      ...BUILTIN_RULES.map(r => ({ id: r.id, action: r.action, on: ruleEnabled(s, r.id, r.defaultEnabled) })),
      ...(await read($, extRules)).map(r => ({ id: r.id, action: r.action, on: ruleEnabled(s, r.id, true) })),
    ]
    return { text: rows.map(r => `${r.on ? '✓' : '✗'} ${r.id}  (${r.action})`).join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const live = await readHeld($)
    await heal($, statusOn, live)
    const { Box, Button, Code, Input, Select, Text } = $.ui.resolve(e)
    /** The width every line of the panel is laid out in (P1 #2). */
    const W = Math.max(20, e.props.bodyColumns - 2)
    /** One drawn line: a Text per span, already made visible by the layout functions. The Box holds the key (TextProps has none). */
    const ln = (spans: Span[], key: string) => (
      <Box key={key}>
        <Text wrap="truncate-end">
          {spans.map((s, i) => <Text key={`${key}-${i}`} color={s.color} bold={s.bold} dimColor={s.dim}>{s.text}</Text>)}
        </Text>
      </Box>
    )
    /** A list row that is pressed: its spans keep their colours; the key addresses it (ButtonProps.key). */
    const rowButton = (key: string, spans: Span[], onPress: () => void) => (
      <Button key={key} plain onPress={onPress}>
        {spans.map((s, i) => <Text key={`${key}-${i}`} color={s.color} bold={s.bold} dimColor={s.dim}>{s.text}</Text>)}
      </Button>
    )
    const snap0 = await read($, snapshot)
    const current = await read($, tab)
    const now = await $.clock.now()
    const tabButton = (id: BinnacleTab, label: string, hotkey: string) => (
      <Button key={`tab-${id}`} label={printable(label)} hotkey={hotkey} variant={current === id ? 'primary' : 'secondary'} onPress={() => void openTab($, id)} />
    )
    const set0 = await read($, settings)
    await read($, extRev)
    const extList = reg.tabs.filter(t => pluginEnabled(set0, t.plugin)).slice(0, 9)
    const title = titleLine(snap0, null, W)
    const header = (
      <Box key="header" flexDirection="column">
        {ln(title, 'title')}
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {tabButton('overview', 'Overview', 'o')}
          {tabButton('perm', 'Permissions', 'p')}
          {tabButton('settings', 'Settings', 's')}
          {tabButton('activity', 'Activity', 'a')}
          {tabButton('agents', 'Agents', 'g')}
          {tabButton('flow', 'Flow', 'w')}
          {tabButton('diff', 'Diff', 'd')}
          {tabButton('search', 'Search', 'f')}
          {extList.map((t, i) => tabButton(tabKey(t), t.title, String(i + 1)))}
        </Box>
        {ln(rule(W), 'rule')}
      </Box>
    )
    /** This drawing's characters (§4.1.9): past ~100k the host cuts the tree, losing what is drawn last. */
    const draw = budget()
    draw.spend(charsOf(title) + W + ['Overview', 'Permissions', 'Settings', 'Activity', 'Agents', 'Diff', 'Search', ...extList.map(t => printable(t.title))].join('').length + 3 * LINE_KEY)
    /** What a Select adds: its label and every option's. */
    const selectChars = (label: string, options: { label: string }[]): number => label.length + options.reduce((n, o) => n + o.label.length, 0)
    /** Room held for details drawn below a list: what they need, a quarter of the budget at most. */
    const detailRoom = (lines: string[]): number => Math.min(BUDGET / 4, lines.reduce((n, l) => n + l.length + LINE_KEY, 0))

    const extTab = extList.find(t => tabKey(t) === current)
    if (extTab) {
      const { rows, hidden } = flatten(toNodes(extTab.rows, tabKey(extTab)), toggledOpen([], await read($, extOpen)))
      const width = Math.max(20, e.props.bodyColumns - 2)
      // One layout for the tab: the cols of a level line up (§4.4); every line within the pane, as many as the budget holds.
      const laid = layoutTab(rows, width)
      const { kept, dropped } = draw.take(laid, 40)
      const more = hidden + dropped
      const press = (id: string, row?: string) => notify($, { plugin: extTab.plugin, kind: 'press', id, ...(row !== undefined ? { row } : {}) })
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box flexDirection="column">
            {rows.slice(0, kept.length).map((r, i) => {
              const spans = kept[i] ?? []
              const x = r.ext
              const buttons = (x?.buttons ?? []).map(b => (
                <Button key={`ext-rb-${r.key}-${b.id}`} label={printable(b.label)} onPress={() => press(b.id, x?.id)} />
              ))
              // A row of buttons starts where a text row's text does (and moves with its indent); an empty row is a blank line.
              const lead = 5 * r.depth + (r.depth === 0 ? 2 : 0) + 2 * (x?.indent ?? 0)
              if (r.text === '' && buttons.length) return <Box key={`node-${r.key}`} flexDirection="row" columnGap={1} flexWrap="wrap" marginLeft={lead}>{buttons}</Box>
              if (r.text === '' && !buttons.length && !r.hasChildren && !r.row) return <Box key={`node-${r.key}`} height={1} />
              const id = x?.press ? x.id : undefined
              const body = r.hasChildren
                ? rowButton(`node-${r.key}`, spans, () => void pressExtNode($, r.key))
                : id !== undefined ? rowButton(`node-${r.key}`, spans, () => press(id)) : ln(spans, `node-${r.key}`)
              return buttons.length ? <Box key={`node-box-${r.key}`} flexDirection="row" columnGap={1}>{body}{buttons}</Box> : body
            })}
            {more ? <Text dimColor>… {more} more rows</Text> : null}
          </Box>
        </Box>
      )
    }

    if (current === 'search') {
      searchDrawn = true
      const query = await read($, searchQuery)
      const picked = await read($, searchSession)
      const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
      const index = normalizeIndex(await $.store.get(INDEX_KEY).catch(() => undefined))
      const options = sessionOptions(index, live?.sessionId ?? null, home).map(o => ({ ...o, label: printable(o.label) }))
      // Only the view of the query in the field: while a newer one waits for its search, nothing stale is shown.
      const view = searchView !== null && searchView.query === query && searchView.sessionId === (picked ?? live?.sessionId) ? searchView : null
      const info = view ? printable(view.info, W) : ''
      const PLACEHOLDER = 'two or more characters'
      draw.spend('Find '.length + printable(query).length + PLACEHOLDER.length + selectChars('Session ', options) + info.length + 'no matches'.length + 2 * LINE_KEY)
      // The count line after the rows is held room for.
      // The open result: the whole message (as indexed, masked), its time and turn, and for a reply the turn's prompt.
      const open = await read($, searchOpen)
      const openIndex = view && open && open.sessionId === view.sessionId && open.query === view.query ? open.i : null
      const openHit = openIndex !== null ? view?.hits[openIndex] ?? null : null
      const openMeta = openHit ? `${when(openHit.at, now)} · ${openHit.n === null ? 'no turn' : `turn #${openHit.n}`} · ${openHit.role}` : ''
      const openPrompt = openHit && openHit.role !== 'you' && openHit.prompt ? printable(`prompt: ${openHit.prompt}`) : ''
      const openLines = openHit ? draw.take(openHit.text.split('\n').map(l => printable(l)), 400) : { kept: [], dropped: 0 }
      draw.spend(openMeta.length + openPrompt.length + 40 + 4 * LINE_KEY)
      const hitsDated = view ? dated(view.hits.map(h => h.at), now) : false
      const { kept } = draw.take(view ? view.hits.map(h => [{ text: ' ' }, ...resultLine(h, W - 1, hitsDated)]) : [], 120)
      const total = view?.total ?? 0
      const more = total - kept.length
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box key="search-top" flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Input key={searchSubmits === 0 ? 'search-query' : `search-query-${searchSubmits}`} label="Find " value={printable(query)} placeholder={PLACEHOLDER} autoFocus onInput={v => void typeQuery($, v)} onSubmit={v => void submitQuery($, v)} />
            <Select key="search-session" label="Session " options={options} value={picked ?? 'current'} onSelect={v => void pickSearchSession($, v)} />
          </Box>
          {view ? <Text color="inactive">{info}</Text> : null}
          {view && total === 0 && view.info !== 'transcript not found' ? <Text color="inactive">no matches</Text> : null}
          <Box flexDirection="column">
            {kept.flatMap((l, i) => [
              rowButton(`hit-${i}`, l, () => void toggleHit($, i)),
              i === openIndex && openHit ? (
                <Box key={`hit-${i}-open`} flexDirection="column" paddingLeft={2} marginY={1}>
                  <Text color="inactive">{openMeta}</Text>
                  {openPrompt ? <Text color="inactive" wrap="wrap">{openPrompt}</Text> : null}
                  {openLines.kept.map((t, j) => <Text key={`hit-${i}-line-${j}`} wrap="wrap">{t}</Text>)}
                  {openLines.dropped ? <Text color="inactive">{`… ${openLines.dropped} more lines`}</Text> : null}
                  {openHit.turnId !== null
                    ? <Box flexDirection="row"><Button key={`hit-${i}-activity`} label="Open turn in Activity" onPress={() => void jumpTo($, i)} /></Box>
                    : <Text color="inactive">no Activity record for that time</Text>}
                </Box>
              ) : null,
            ])}
          </Box>
          {total > 0 ? (
            <Text color="inactive">{`${total} ${total === 1 ? 'match' : 'matches'}${more > 0 ? ` · ${more} more not shown` : ''} · Enter shows the whole message`}</Text>
          ) : null}
        </Box>
      )
    }

    if (current === 'activity') {
      const viewing = await read($, viewSession)
      const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
      const index = normalizeIndex(await $.store.get(INDEX_KEY).catch(() => undefined))
      const savedId = viewing === null || viewing === live?.sessionId ? null : viewing
      const s = savedId === null ? live : await loadSaved($, savedId)
      const tree = s ? buildTree(s, savedId === null ? liveSince : Number.POSITIVE_INFINITY, now) : []
      const { rows, hidden } = flatten(tree, toggledOpen(s ? openByDefault(s) : [], await read($, treeOpen)))
      const selected = await read($, treeSelected)
      const node = selected === null ? null : findNode(tree, selected)
      const turnCount = s ? s.events.filter(ev => ev.kind === 'turn-start').length : 0
      const agentCount = s ? s.events.filter(ev => ev.kind === 'agent-start').length : 0
      const options = sessionOptions(index, live?.sessionId ?? null, home).map(o => ({ ...o, label: printable(o.label) }))
      const counts = `${turnCount} ${turnCount === 1 ? 'turn' : 'turns'} · ${agentCount} ${agentCount === 1 ? 'agent' : 'agents'}`
      const resume = s !== null ? printable(`session ${s.sessionId.slice(0, 8)} · claude --resume ${s.sessionId}`) : ''
      const detail = (node?.detail ?? []).map(l => printable(l))
      draw.spend(selectChars('Session ', options) + counts.length + LINE_KEY)
      // After the rows come the "more rows" line, the details and the resume line: room is held for them.
      const tail = resume.length + 80 + 2 * LINE_KEY
      const { kept: lines, dropped } = draw.take(layoutRows(rows.map(treeRow), W), tail + detailRoom(detail))
      const shownDetail = draw.take(detail, tail)
      const more = hidden + dropped
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box key="activity-top" flexDirection="row" justifyContent="space-between" flexWrap="wrap">
            <Select key="activity-session" label="Session " options={options} value={savedId ?? 'current'} onSelect={v => void pickSession($, v)} />
            {s !== null ? <Text color="inactive">{counts}</Text> : null}
          </Box>
          {s === null && savedId !== null ? (
            <Box flexDirection="column">
              <Text color="error">unreadable</Text>
              <Button key="activity-delete" label="Delete this saved session" onPress={() => void deleteSaved($, savedId)} />
            </Box>
          ) : null}
          {s === null && savedId === null ? <Text color="inactive">No activity yet.</Text> : null}
          {s !== null ? (
            <Box flexDirection="column">
              {lines.map((l, i) => rowButton(`node-${rows[i]?.key}`, l, () => void pressNode($, rows[i]?.key ?? '', rows[i]?.hasChildren ?? false)))}
              {more ? <Text color="inactive">… {more} more rows (collapse a turn to see them)</Text> : null}
            </Box>
          ) : null}
          {detail.length ? (
            <Box flexDirection="column" paddingLeft={2}>
              {shownDetail.kept.map((l, i) => <Text key={`detail-${i}`} wrap="wrap">{l}</Text>)}
              {shownDetail.dropped ? <Text color="inactive">{`… ${shownDetail.dropped} more lines`}</Text> : null}
            </Box>
          ) : null}
          {s !== null ? <Text color="inactive">{resume}</Text> : null}
        </Box>
      )
    }

    if (current === 'flow') {
      await read($, flow)
      const held = await readHeld($)
      // After /clear or /resume, until the new session's record loads, what is held is the old session's.
      const sid = await $.session.id().catch(() => null)
      const same = held !== null && held.sessionId === sid
      const checks = await read($, pending)
      const v = flowView(same ? held : null, same ? flowLive : emptyLive(), checks, now, liveSince, snap0?.contextPercent ?? null, await autoModeNow($))
      const head = { model: snap0 ? modelLabel(snap0.model) : '', effort: snap0 ? effortLabel(snap0.effort) : '' }
      if (moving(v)) armAgentsTick($, now)
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box key="flow-body" flexDirection="column">
            {flowLines(v, head, W, now).map((l, i) => ln(l, `flow-${i}`))}
          </Box>
        </Box>
      )
    }
    if (current === 'agents') {
      const viewing = await read($, viewSession)
      const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
      const index = normalizeIndex(await $.store.get(INDEX_KEY).catch(() => undefined))
      const savedId = viewing === null || viewing === live?.sessionId ? null : viewing
      const s = savedId === null ? live : await loadSaved($, savedId)
      const since = savedId === null ? liveSince : Number.POSITIVE_INFINITY
      const checks = await read($, pending)
      // The heading counts every live agent; the rows stop at 20, the last saying how many more.
      const allLive = savedId === null ? liveRows(live, checks, now, liveSince, Number.POSITIVE_INFINITY, await autoModeNow($)) : []
      const liveNow = savedId === null ? liveRows(live, checks, now, liveSince, 20, await autoModeNow($)) : []
      const rows = s ? agentRows(s, since, now) : []
      const selected = await read($, agentSelected)
      const picked = rows.find(r => r.key === selected)
      // A saved session's timeline ends at its last event: it does not move, and asks for no redraw.
      const tl = s ? timeline(s, since, savedId === null ? now : s.events.at(-1)?.at ?? now, W, now) : null
      const running = allLive.filter(r => r.text.startsWith('●')).length
      const waiting = allLive.filter(r => r.text.startsWith('⏸')).length
      const options = sessionOptions(index, live?.sessionId ?? null, home).map(o => ({ ...o, label: printable(o.label) }))
      const liveLines = layoutRows(liveNow.map(r => r.row), W - 1).map(l => [{ text: ' ' }, ...l])
      const tlLines = tl ? [heading('Timeline', tl.summary, W), tl.marks, ...tl.lanes, tl.axis] : []
      const detail = (picked?.detail ?? []).map(l => printable(l))
      // The session picker, the headings, the live rows and the timeline first; the history takes what is left.
      draw.spend(selectChars('Session ', options) + 3 * (W + LINE_KEY) + 40 + [...liveLines, ...tlLines].reduce((n, l) => n + charsOf(l) + LINE_KEY, 0))
      const tail = 40 + LINE_KEY
      const { kept: histLines } = draw.take(layoutRows(rows.slice(0, MAX_LIST).map(r => r.row), W - 1).map(l => [{ text: ' ' }, ...l]), tail + detailRoom(detail))
      const shown = rows.slice(0, histLines.length)
      const shownDetail = draw.take(detail, tail)
      // liveNow is empty for a saved session: only this session's live rows ever ask for a redraw.
      if (liveNow.some(moves)) armAgentsTick($, now)
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Select key="agents-session" label="Session " options={options} value={savedId ?? 'current'} onSelect={v => void pickSession($, v)} />
          {savedId === null ? (
            <Box key="agents-now" flexDirection="column">
              {ln(heading('Now', `${running} running · ${waiting} waiting`, W), 'now-head')}
              {liveNow.length === 0 ? <Text color="inactive">no agents running</Text> : null}
              {liveLines.map((l, i) => ln(l, `live-${i}`))}
            </Box>
          ) : null}
          {tl ? (
            <Box key="agents-timeline" flexDirection="column">
              {ln(heading('Timeline', tl.summary, W), 'tl-head')}
              {ln(tl.marks, 'tl-marks')}
              {tl.lanes.map((l, i) => ln(l, `lane-${i}`))}
              {ln(tl.axis, 'tl-axis')}
            </Box>
          ) : null}
          {s === null && savedId !== null ? <Text color="error">unreadable</Text> : null}
          {s !== null && rows.length === 0 ? <Text color="inactive">No agents in this session.</Text> : null}
          {rows.length ? (
            <Box key="agents-history" flexDirection="column">
              {ln(heading('History', `${rows.length} ${rows.length === 1 ? 'agent' : 'agents'}`, W), 'hist-head')}
              {histLines.map((l, i) => rowButton(`agent-${shown[i]?.key ?? i}`, l, () => void update($, agentSelected, () => shown[i]?.key ?? null)))}
              {rows.length > shown.length ? <Text color="inactive">… and {rows.length - shown.length} more</Text> : null}
            </Box>
          ) : null}
          {picked ? (
            <Box flexDirection="column" paddingLeft={2}>
              {shownDetail.kept.map((l, i) => <Text key={`agent-detail-${i}`} wrap="wrap">{l}</Text>)}
              {shownDetail.dropped ? <Text color="inactive">{`… ${shownDetail.dropped} more lines`}</Text> : null}
            </Box>
          ) : null}
        </Box>
      )
    }

    if (current === 'diff') {
      const src = await effectiveSource($)
      const s = live
      const turns = s ? sourceTurns(s) : []
      const options = [{ value: 'workspace', label: 'Workspace' }, ...turns.map(t => ({ value: t.turnId, label: `Turn #${t.n}` }))]
      let files: BinnacleDiffFile[] = []
      let note: string | null = null
      if (src === 'workspace') {
        const w = await read($, workspace)
        if (await read($, diffLoading)) note = 'reading the working tree…'
        else if (w === null) note = 'Press r to read the working tree.'
        else if (w.kind === 'not-repo') note = 'not a git repository'
        else if (w.kind === 'error') note = w.message
        else {
          files = w.files
          note = w.note ?? (files.length ? null : 'no changes against HEAD')
        }
      } else {
        files = s ? turnFiles(s, src, await read($, patches)) : []
        // Patch bodies live only in this process: a turn from before it (resume) never had them here.
        const began = s?.events.find(ev => ev.kind === 'turn-start' && ev.turnId === src)?.at ?? 0
        if (files.length && files.every(f => f.hunks.length === 0) && began < liveSince) note = 'diff not kept after resume — use Workspace'
      }
      const picked = await read($, diffFile)
      const sel = files.find(f => f.path === picked) ?? files[0] ?? null
      const narrowHint = e.props.placement === 'dock' && e.props.bodyColumns < 100
      draw.spend(selectChars('Source ', options) + 'Refresh(Tab, then r)ctrl+x ← widens this pane'.length + (note ? printable(note).length : 0))
      // The code keeps what it needs, at most half of what is left; the file list takes the rest, the selected row
      // always drawn.
      const fileLines = layoutRows(files.map(f => diffFileRow(f, f === sel)), W)
      const selAt = sel ? files.indexOf(sel) : -1
      const selChars = selAt >= 0 ? charsOf(fileLines[selAt] ?? []) + LINE_KEY : 0
      // The lines that may follow the code (a "more" line, a note) and the Code's path.
      const after = 120 + (sel?.path.length ?? 0)
      const coded = sel !== null && !sel.binary && sel.status !== '?'
      const need = (coded ? capHunks(sel.hunks).source.length : 0) + after
      const listed = draw.take(fileLines, Math.min(Math.ceil(draw.left() / 2), need) + selChars).kept.map((_, i) => i)
      if (selAt >= listed.length) {
        listed.push(selAt)
        draw.spend(selChars)
      }
      const moreFiles = files.length - listed.length
      const shown = coded ? capHunks(sel.hunks, Math.min(MAX_SOURCE, draw.left() - after)) : null
      const tooBig = shown !== null && shown.source === '' && shown.omitted > 0
      const more = shown === null ? 0 : shown.omitted - (tooBig ? 1 : 0)
      // A rename, a mode change or an empty new file: git lists it with no hunks.
      const bare = src === 'workspace' && shown !== null && sel !== null && sel.hunks.length === 0
      // An edit of this process whose body was over the drawing cap, or dropped from the patch budget.
      const dropped = src !== 'workspace' && note === null && sel !== null && sel.hunks.length === 0 && sel.added + sel.removed > 0
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Select key="diff-source" label="Source " options={options} value={src} onSelect={v => void pickSource($, v)} />
            {src === 'workspace' ? <Button key="diff-refresh" label="Refresh" hotkey="r" onPress={() => void loadWorkspace($)} /> : null}
            {/* A focused Select takes the keys itself (host SelectProps), so the Refresh hotkey waits for Tab. */}
            {src === 'workspace' ? <Text color="inactive">(Tab, then r)</Text> : null}
          </Box>
          {narrowHint ? <Text color="inactive">ctrl+x ← widens this pane</Text> : null}
          {note ? <Text color="inactive">{printable(note)}</Text> : null}
          <Box flexDirection="column">
            {listed.map(i => rowButton(`file-${i}`, fileLines[i] ?? [], () => void update($, diffFile, () => files[i]?.path ?? null)))}
            {moreFiles > 0 ? <Text color="inactive">{`… ${moreFiles} more files`}</Text> : null}
          </Box>
          {sel?.binary ? <Text color="inactive">binary file</Text> : null}
          {sel?.status === '?' ? <Text color="inactive">untracked file (contents not shown)</Text> : null}
          {dropped ? <Text color="inactive">patch too large to keep</Text> : null}
          {bare ? <Text color="inactive">no content changes</Text> : null}
          {tooBig ? <Text color="inactive">hunk too large to draw</Text> : null}
          {sel && shown && shown.source ? <Code key="diff-code" source={printable(shown.source)} format="diff" path={printable(sel.path)} /> : null}
          {more > 0 ? <Text color="inactive">{`… ${more} more ${more === 1 ? 'hunk' : 'hunks'}`}</Text> : null}
        </Box>
      )
    }

    if (current === 'settings') {
      const s = await read($, settings)
      const ext = await read($, extRules)
      const known = pluginsIn(reg)
      const rules = [
        ...BUILTIN_RULES.map(r => ({ id: r.id, title: `${r.pack} · ${r.title}`, summary: r.summary, action: r.action, def: r.defaultEnabled })),
        ...ext.map(r => ({ id: r.id, title: `${r.pack} · ${r.title}`, summary: undefined as string | undefined, action: r.action, def: true })),
      ]
      const itemW = Math.max(...ITEMS.map(i => i.length)) + 6
      const pluginLabels = known.map(name => cutEnd(flat(`[${pluginEnabled(s, name) ? '✓' : ' '}] ${name} · what it adds to binnacle`), W))
      const settingLabels = known.map(name => reg.settings.filter(x => x.plugin === name).map(x => ({
        x, label: cutEnd(flat(`    [${pluginSetting(s, name, x.id, x.def) ? '✓' : ' '}] ${x.title}`), W),
      })))
      const ruleLines = rules.map(r => ({
        r,
        label: ruleLabel(ruleEnabled(s, r.id, r.def), r.title, r.action, W),
        summary: r.summary ? cutEnd(flat(`    ${r.summary}`), W) : '',
      }))
      const historyLabel = cutEnd(flat(`[${s.history.lineage ? '✓' : ' '}] count compactions across forks (reads the earlier sessions' files)`), W)
      draw.spend(ITEMS.length * itemW + 2 * (W + LINE_KEY) + 2 * LINE_KEY + historyLabel.length + 3 * LINE_KEY)
      // Each rule is a keyed Box (its key is counted) holding the toggle and the summary; the plugins come after them.
      const pluginRoom = [...pluginLabels, ...settingLabels.flat().map(y => y.label)].reduce((n, l) => n + l.length + LINE_KEY, 0) + 2 * LINE_KEY + 40
      const { kept: shownRules, dropped: moreRules } = draw.take(ruleLines.map(x => `rule-box-${x.r.id}${x.label}${x.summary}`), pluginRoom)
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box key="set-status" flexDirection="column">
            {ln([{ text: 'Status line', bold: true }], 'set-status-head')}
            <Box flexDirection="row" flexWrap="wrap">
              {ITEMS.map(item => (
                <Button key={`item-${item}`} plain label={padEnd(`[${s.status[item] ? '✓' : ' '}] ${item}`, itemW)} onPress={() => void toggleItem($, item)} />
              ))}
            </Box>
          </Box>
          <Box key="set-rules" flexDirection="column">
            {ln(heading('Guard rules', 'deny refuses · ask asks unless nothing is lost', W), 'set-rules-head')}
            {ruleLines.slice(0, shownRules.length).map(({ r, label, summary }) => (
              <Box key={`rule-box-${r.id}`} flexDirection="column">
                <Button key={`rule-${r.id}`} plain label={label} onPress={() => void toggleRule($, r.id, r.def)} />
                {summary ? <Text dimColor wrap="truncate-end">{summary}</Text> : null}
              </Box>
            ))}
            {moreRules ? <Text color="inactive">{`… ${moreRules} more rules`}</Text> : null}
          </Box>
          <Box key="set-history" flexDirection="column">
            {ln([{ text: 'History', bold: true }], 'set-history-head')}
            <Button key="history-lineage" plain label={historyLabel} onPress={() => void toggleLineage($)} />
          </Box>
          {known.length ? (
            <Box key="set-plugins" flexDirection="column">
              {ln([{ text: 'Plugins', bold: true }], 'set-plugins-head')}
              {known.map((name, i) => (
                <Box key={`plugin-box-${name}`} flexDirection="column">
                  <Button key={`plugin-${name}`} plain label={pluginLabels[i]} onPress={() => void togglePlugin($, name)} />
                  {(settingLabels[i] ?? []).map(({ x, label }) => (
                    <Button key={`pset-${name}-${x.id}`} plain label={label} onPress={() => void togglePluginSetting($, x)} />
                  ))}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    }

    if (current === 'perm') {
      const p = await read($, perm)
      const ext = await read($, extRules)
      // binnacle's own rules, a rule pack's by its pack name, external guards' denials by their own source.
      const sourceOf = (id: string): string => (BUILTIN_RULES.some(r => r.id === id) ? 'binnacle' : ext.find(r => r.id === id)?.pack ?? 'plugin')
      const all = guardRecords(live, sourceOf, 1_000)
      const decided = decisionView && decisionView.sessionId === live?.sessionId ? decisionView : null
      if (!decided && live && decisionsAskedFor !== live.sessionId) {
        decisionsAskedFor = live.sessionId
        soonDecisions($)
      }
      const whoNote = decided ? (decided.found ? 'this session · from the transcript' : 'transcript not found') : 'reading the transcript…'
      const whoRows = decided?.found ? decisionLines(decided.d, W) : []
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {ln([{ text: 'Permissions & guard', bold: true }], 'perm-title')}
          <Box key="perm-checks" flexDirection="column">
            {ln(heading('Permission checks', `${p.allow + p.ask + p.deny} since Claude Code started`, W), 'perm-head')}
            {permLines(p, W).map((l, i) => ln(l, `perm-${i}`))}
          </Box>
          <Box key="perm-who" flexDirection="column">
            {ln(heading('Who decided', whoNote, W), 'who-head')}
            {whoRows.length ? whoRows.map((l, i) => ln(l, `who-${i}`)) : decided && decided.found ? <Text color="inactive">no decisions yet</Text> : null}
          </Box>
          <Box key="perm-guard" flexDirection="column">
            {ln(heading('Guard in this session', guardSummary(all), W), 'guard-head')}
            {guardLines(all.slice(0, 10), W, now).map((l, i) => ln(l, `log-${i}`))}
          </Box>
        </Box>
      )
    }

    const s = await read($, snapshot)
    const b = await read($, breakdown)
    const rc = lastReceipt(live)
    const cells = b ? overviewCells(b, W) : []
    const cview = compactView(await read($, compactions), live)
    const sessionBlock: Span[][] = s
      ? card(modelEffort(s.model, s.effort), `${duration(now - s.startedAt)} session`, sessionLines(s, now, cview.list.length), W)
      : [[{ text: 'No usage data yet.', color: 'inactive' }]]
    const ctxSummary = `${s?.contextTokens != null ? `${tokens(s.contextTokens)} / ${tokens(s.contextWindow)}` : ''}${b?.compactAt != null ? ` · compacts at ${tokens(b.compactAt)}` : ''}`
    const lastTurn = rc
      ? `${elapsed(rc.durationMs)} · ${rc.agents} agent${rc.agents === 1 ? '' : 's'} · ${rc.edits} edit${rc.edits === 1 ? '' : 's'} · ${rc.errors} error${rc.errors === 1 ? '' : 's'}${rc.costDelta !== null ? ` · +${money(rc.costDelta)}` : ''}`
      : null
    // Bounded (five rows), but drawn through the render's budget like every list (§4.1.9).
    const compactLines = cview.list.length
      ? draw.take([heading('Compactions', compactHeading(cview, now), W), ...layoutRows(compactRows(cview, now), W - 1).map(l => [{ text: ' ' }, ...l])]).kept
      : []
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Box key="ov-session" flexDirection="column">
          {sessionBlock.map((l, i) => ln(l, `ov-card-${i}`))}
        </Box>
        <Box key="ov-context" flexDirection="column">
          {ln(heading('Context', ctxSummary, W), 'ov-context-head')}
          {cells.length ? <Text>{cells.map((x, i) => <Text key={`cell-${i}`} color={x.color}>{x.glyph.repeat(x.n)}</Text>)}</Text> : null}
          {legendRows(cells, W).map((row, r) => (
            <Text key={`legend-${r}`} wrap="truncate-end">
              {row.map((x, i) => (
                <Text key={`legend-${r}-${i}`}>
                  {i > 0 ? LEGEND_GAP : ''}
                  <Text color={x.color}>{x.glyph}</Text>
                  <Text dimColor> {printable(x.text)}</Text>
                </Text>
              ))}
            </Text>
          ))}
        </Box>
        {compactLines.length ? (
          <Box key="ov-compact" flexDirection="column">
            {compactLines.map((l, i) => ln(l, i === 0 ? 'ov-compact-head' : `ov-compact-${i - 1}`))}
          </Box>
        ) : null}
        {lastTurn ? ln(heading('Last turn', lastTurn, W), 'ov-last') : null}
      </Box>
    )
  })

  if (statusOn) {
    on('turn.step', async function* ($, e, next) {
      if (e.agentId === undefined && e.effort !== undefined) {
        const value = String(e.effort)
        lastEffort = value
        await update($, effort, () => value)
      }
      return yield* next(e)
    })


    on('session.measure', async ($, e, next) => {
      const r = await next(e)
      await refresh($)
      return r
    })

    on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
      const held = await readHeld($)
      await heal($, statusOn, held)
      const s = await read($, snapshot)
      if (!s) return next(e)
      const set = await read($, settings)
      const now = await $.clock.now()
      const width = Math.max(30, (e.viewport?.columns ?? 120) - PREFIX_COLUMNS)
      const b = await read($, breakdown)
      await read($, extRev)
      const pg = segmentGroup(reg.segments.filter(x => pluginEnabled(set, x.plugin)))
      const groups = [...buildGroups(s, set, now, b, { compactions: compactView(await read($, compactions), held).list.length }), ...(pg ? [pg] : [])]
      const rows = withTail(fit(groups, width), e.props.hint, width)
      const extLines = reg.lines.filter(l => pluginEnabled(set, l.plugin)).map(l => ({ l, spans: pickForm(l.forms, width) }))
      const { Box, Button, Text } = $.ui.resolve(e)
      const line = (spans: Span[], key: string, wrap?: 'truncate-end') => (
        <Text key={key} wrap={wrap}>
          {spans.map((sp, i) => (
            <Text key={`${key}-${i}`} color={sp.color} dimColor={sp.dim} bold={sp.bold}>{printable(sp.text)}</Text>
          ))}
        </Text>
      )
      // A model the organisation's policy owns: /config refuses a change, so it gets no button.
      const modelLocked = findRow(configRows, MODEL_KEYS)?.isLocked === true
      const pressable = (sp: StatusSpan): BareCommand | null => (sp.press === 'model' && modelLocked ? null : sp.press ?? null)
      // A row holding the model or the effort is a row of parts, those two plain buttons (P2-1: pressable here); the
      // rest stay one Text, as before.
      const statusRow = (spans: StatusSpan[], key: string) => {
        if (!spans.some(sp => pressable(sp) !== null || sp.ext)) return line(spans, key)
        return (
          <Box key={key} flexDirection="row">
            {spans.map((sp, i) => {
              const text = <Text key={`${key}-${i}`} color={sp.color} dimColor={sp.dim} bold={sp.bold}>{printable(sp.text)}</Text>
              if (sp.ext) {
                const x = sp.ext
                return <Button key={`status-ext-${x.plugin}-${x.id}`} plain label={printable(sp.text)} onPress={() => notify($, { plugin: x.plugin, kind: 'press', id: x.id })}>{text}</Button>
              }
              const kind = pressable(sp)
              return kind === null ? text : <Button key={`status-${kind}`} plain label={printable(sp.text)} onPress={() => void openPicker($, kind)}>{text}</Button>
            })}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          {rows.map((row, i) => statusRow(row, `row-${i}`))}
          {extLines.map(({ l, spans }) => (l.press
            ? (
              <Button key={`line-${l.plugin}-${l.id}`} plain label={printable(spans.map(sp => sp.text).join(''))} onPress={() => notify($, { plugin: l.plugin, kind: 'press', id: l.id })}>
                {spans.map((sp, i) => <Text key={`line-${l.plugin}-${l.id}-${i}`} color={sp.color} dimColor={sp.dim} bold={sp.bold}>{printable(sp.text)}</Text>)}
              </Button>
            )
            : line(spans, `line-${l.plugin}-${l.id}`, 'truncate-end')))}
        </Box>
      )
    })
  }

  // The right of the prompt footer (P2-4: its buttons can be clicked): Claude Code's own labels as it joins them, then
  // `⚑ guard N` once binnacle's guard has refused something, plugins' buttons, and `☰ binnacle`.
  if (guardOn || statusOn) {
    on('ui.render', { component: 'SessionMode' }, async ($, e) => {
      const heldNow = await readHeld($)
      // After /clear or /resume the settings read as the defaults until loaded back: with the status line off this
      // footer is the only drawing, so it loads them (a plugin turned off must stay off).
      await heal($, statusOn, heldNow)
      await read($, extRev)
      const set = await read($, settings)
      const pluginButtons = reg.buttons.filter(b => pluginEnabled(set, b.plugin))
      const blocked = guardOn ? guardEntries(heldNow).filter(x => x.action === 'deny' || x.action === 'ask-deny').length : 0
      const runningNow = runningAgents(heldNow, liveSince)
      const panelLabel = runningNow > 0 ? `☰ binnacle ${SYM.running}${runningNow}` : '☰ binnacle'
      const { Box, Button, Text } = $.ui.resolve(e)
      const own = e.props.modes.map(m => printable(m)).join(' & ')
      return (
        <Box flexDirection="row" columnGap={1}>
          {own ? <Text color="inactive">{own}</Text> : null}
          {blocked ? <Button key="mode-guard" plain label={`⚑ guard ${blocked}`} onPress={() => void openGuardTab($)}><Text color="warning">{`⚑ guard ${blocked}`}</Text></Button> : null}
          {pluginButtons.map(b => (
            <Button key={`ext-btn-${b.plugin}-${b.id}`} plain label={printable(b.label)} onPress={() => notify($, { plugin: b.plugin, kind: 'press', id: b.id })}>
              <Text color={b.color ?? 'inactive'}>{printable(b.label)}</Text>
            </Button>
          ))}
          {statusOn ? <Button key="mode-panel" plain label={panelLabel} onPress={() => void (runningNow > 0 ? openFlowTab($) : togglePanel($))}><Text color="inactive">{panelLabel}</Text></Button> : null}
        </Box>
      )
    })
  }
}
