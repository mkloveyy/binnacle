import type { ThemeKey } from 'claude-code'

/**
 * Semantic roles (spec §4.2): every colour the panel draws is one of these host ThemeKeys, so light and dark themes
 * are the host's to adapt. Colour says state, never identity; the context category bar keeps its hex PALETTE.
 */
export const ROLE = {
  text: 'text',
  dim: 'inactive',
  frame: 'subtle',
  brand: 'claude',
  focus: 'suggestion',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  ask: 'permission',
  added: 'diffAdded',
  removed: 'diffRemoved',
} as const satisfies Record<string, ThemeKey>

/** One glyph per meaning, on every tab. */
export const SYM = {
  running: '●', done: '✓', failed: '✗', waiting: '⏸', stale: '⏰', handBack: '↩', guard: '⚑', compact: '⇣',
  current: '◆', todo: '○', closed: '▸', open: '▾', edit: '✎', loop: '⟳',
} as const
