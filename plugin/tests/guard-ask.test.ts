import { describe, expect, test } from 'claude-code/testing'
import { ALLOW, DENY, denyMessage, interpret, question, summarize } from '../hooks/modules/guard/ask.ts'
import { EMPTY_STATS, categoryOf, tally } from '../hooks/modules/guard/stats.ts'

describe('ask helpers', () => {
  test('question carries reason and preview and ends with a question mark', () => {
    const q = question('Force push', '`git push --force` can drop commits on the remote.', ['the remote would lose 1 commit(s):', 'a1b2c3d fix'])
    expect(q).toBe('binnacle · Force push\n`git push --force` can drop commits on the remote.\n  the remote would lose 1 commit(s):\n  a1b2c3d fix\nAllow this once?')
  })
  test('interpret answers', () => {
    expect(interpret(ALLOW)).toEqual({ ok: true })
    expect(interpret(DENY)).toEqual({ ok: false, note: '' })
    expect(interpret(null)).toEqual({ ok: false, note: '' })
    expect(interpret('  use git clean -n first ')).toEqual({ ok: false, note: 'use git clean -n first' })
  })
  test('deny message tells the model not to work around it', () => {
    expect(denyMessage('No.')).toBe('binnacle: No. Do not work around this with a different command; ask the user.')
  })
  test('summaries are short', () => {
    expect(summarize('Bash', { command: 'x'.repeat(300) })).toHaveLength(120)
    expect(summarize('mcp__db__query', { sql: 'select 1' })).toBe('mcp__db__query select 1')
  })
})

describe('stats', () => {
  test('categories and tallies', () => {
    expect([categoryOf('Read'), categoryOf('Bash'), categoryOf('mcp__x__y')]).toEqual(['files', 'shell', 'other'])
    const s = tally(tally(EMPTY_STATS, 'Bash', 'allow'), 'Edit', 'ask')
    expect(s).toEqual({ allow: 1, ask: 1, deny: 0, files: 1, shell: 1, other: 0 })
  })
})
