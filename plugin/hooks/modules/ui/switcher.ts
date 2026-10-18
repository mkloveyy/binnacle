import { firstLine } from '../activity/events.ts'

/**
 * The model and the effort on the status line (spec §4.13, revised 2026-10-13): each a plain button that opens Claude
 * Code's own picker, `/model` or `/effort` with no argument (P2-2). A Select on the status line cannot be opened, a
 * Button can be pressed (P2-1); the picker brings the full model list and `s` for this session only, which a plugin
 * cannot (there is no model list, P1 #14). Nothing is drawn above the prompt.
 */
export type SwitchKind = 'model' | 'effort'
/** What a status-line button runs with no argument. */
export type BareCommand = SwitchKind
export type ConfigRowLike = { key: string; kind: string; value: unknown; options?: readonly string[]; isLocked: boolean }

/** The `/config` row of the model (P1 #12): a locked one (managed settings) gets no button. */
export const MODEL_KEYS: readonly string[] = ['model']

export const findRow = (rows: readonly ConfigRowLike[], keys: readonly string[]): ConfigRowLike | null =>
  rows.find(r => keys.includes(r.key)) ?? null

/** The toast for a picker command that rejected: its first line, masked, control characters made visible. */
export const failText = (kind: BareCommand, err: unknown): string => `${kind} picker did not open: ${firstLine(String(err))}`
