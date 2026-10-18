import { describe, expect, mock, test } from 'claude-code/testing'
import type { BinnaclePermStats, BinnacleSnapshot } from '../types'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { textWidth } from '../hooks/core/width.ts'
import { widthOf, type Span } from '../hooks/modules/ui/cols.ts'
import { guardLines, guardRecords, guardSummary, permLines, ruleLabel, sessionLines } from '../hooks/modules/ui/pages.ts'

const text = (l: Span[]): string => l.map(s => s.text).join('')
const S: BinnacleSnapshot = {
  model: 'claude-opus-5-5', effort: 'high', contextTokens: 412_000, contextWindow: 1_000_000, contextPercent: 41,
  startedAt: 0, costUsd: 12.4, turnCostUsd: 0.41, cwd: '/r', home: '/h',
  limits: [{ kind: 'five_hour', percent: 41, resetsAt: null }, { kind: 'seven_day', percent: 85, resetsAt: null }],
}

describe('Overview card body', () => {
  test('cost and this turn, then one bar per limit, bar and percent in the limit bands', () => {
    const l = sessionLines(S, 0)
    expect(text(l[0] as Span[])).toBe('cost    $12.40     this turn  +$0.41')
    expect(text(l[1] as Span[])).toBe('5h      ████░░░░░░   41%')
    expect(l[1]?.[1]).toEqual({ text: '████', color: 'success' })
    expect(l[1]?.[2]).toEqual({ text: '░░░░░░', color: 'subtle' })
    expect(l[2]?.[1]?.color).toBe('warning')
    expect(l[2]?.[3]?.color).toBe('warning')
  })
})

describe('Settings rule rows', () => {
  test('the action is drawn visible and the row never passes the width, however long the action (final review)', () => {
    expect(ruleLabel(true, 'pack · title', 'ask', 30)).toBe('[✓] pack · title           ask')
    expect(ruleLabel(true, 't', 'ask\x1b', 30)).toMatch(/ask\^\[$/)
    const long = ruleLabel(false, 'pack · a title', 'refuse-'.repeat(30), 40)
    expect(textWidth(long)).toBeLessThanOrEqual(40)
    expect(long.startsWith('[ ] pack')).toBe(true)
  })
})

describe('Permissions', () => {
  const P: BinnaclePermStats = { allow: 180, ask: 30, deny: 4, files: 120, shell: 80, other: 14 }
  test('three counts with a bar each, only the bar coloured, every line the width', () => {
    const l = permLines(P, 78)
    // One bar split by share (the Context block's look), then the legend with counts and shares, then the kinds.
    expect(widthOf(l[0] as Span[])).toBe(77)
    expect((l[0] as Span[]).map(s => s.color)).toEqual(['success', 'permission', 'error'])
    expect(l.slice(1, -1).map(x => text(x as Span[]))).toEqual(['█ allowed by rules  180   84%   █ denied  4    2%', '█ asked              30   14%'])
    expect(text(l.at(-1) as Span[])).toBe(' files 120 · shell 80 · other 14')
  })
  test('guard records: binnacle and sextant guard together, newest first, with their source; refused rows in error', () => {
    let s = newSession('s', 0, '/r')
    s = append(s, { at: 1, turnId: 't', agentId: null, kind: 'guard', ruleId: 'git.force-push', action: 'deny', summary: 'git push --force origin main' })
    s = append(s, { at: 2, turnId: 't', agentId: null, kind: 'guard', ruleId: 'files.rm-outside', action: 'ask-allow', summary: 'rm -rf /tmp/x' })
    s = append(s, { at: 3, turnId: 't', agentId: null, kind: 'perm', tool: 'Bash', summary: 'deploy-tool confirm --id 4', decision: 'deny', decider: 'hook', outcome: null, source: 'sextant-guard', ruleId: 'release-gate' })
    const rec = guardRecords(s, id => (id.startsWith('git.') || id.startsWith('files.') ? 'binnacle' : 'pack'))
    expect(rec.map(r => [r.source, r.ruleId])).toEqual([['sextant-guard', 'release-gate'], ['binnacle', 'files.rm-outside'], ['binnacle', 'git.force-push']])
    expect(guardSummary(rec)).toBe('blocked 2 · asked 1 · auto 0')
    // An ask the person refused is one blocked call, not also one asked: the counts add up to the rows.
    const refusedAsk = [{ at: 0, action: 'ask-deny' as const, source: 'binnacle', ruleId: 'r', summary: 'x' }, { at: 0, action: 'ask-allow' as const, source: 'binnacle', ruleId: 'r', summary: 'y' }]
    expect(guardSummary(refusedAsk)).toBe('blocked 1 · asked 1 · auto 0')
    const lines = guardLines(rec, 100, 0).map(text)
    expect(lines[0]).toMatch(/⚑ deny\s+sextant-guard\s+release-gate\s+deploy-tool confirm --id 4$/)
    expect(lines[1]).toMatch(/✓ ask-allow\s+binnacle\s+files\.rm-outside\s+rm -rf \/tmp\/x$/)
    expect(guardLines(rec, 100, 0)[2]?.every(sp => sp.text.trim() === '' || sp.color === 'error')).toBe(true)
    expect(guardRecords(null, () => 'x')).toEqual([])
  })
  test('guard rows: a rule id or source with control characters is made visible before the columns are measured', () => {
    const rec = [
      { at: 0, action: 'deny' as const, source: 'pack\x1b', ruleId: 'rule\x1b', summary: 'a' },
      { at: 0, action: 'deny' as const, source: 'packs', ruleId: 'rule.x', summary: 'b' },
    ]
    const lines = guardLines(rec, 60, 0).map(text)
    expect(lines[0]).toMatch(/pack\^\[ {2}rule\^\[ {2}a$/)
    expect(lines[0]?.indexOf('rule^[')).toBe(lines[1]?.indexOf('rule.x'))
  })
})

describe('Settings', () => {
  test('a rule row with its action right-aligned; control characters visible', () => {
    expect(ruleLabel(true, 'files · rm -r outside the project', 'ask', 60)).toMatch(/^\[✓\] files · rm -r outside the project\s+ask$/)
    expect(textWidth(ruleLabel(false, 'k8s · kubectl without a namespace scope', 'deny', 40))).toBe(40)
    expect(ruleLabel(true, 'p\x1b · t', 'deny', 30)).toContain('p^[ · t')
  })
})

const PANE = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const USAGE = { value: { startedAt: 0, context: { window: 1_000_000, tokens: 412_000, percent: 41 }, rateLimits: [{ kind: 'five_hour', percentUsed: 41 }], cost: { usd: 12.4 } } }

for (const cols of [50, 80, 120]) {
  test(`Overview, Permissions and Settings fit ${cols} columns; the card has a border only from 60`, async ($, on) => {
    mock.store(on)
    mock.clock(on)
    on('session.usage', () => USAGE as never)
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(cols) })
    const w = Math.max(20, cols - 2)
    for (const t of ['overview', 'perm', 'settings']) {
      await ui.press({ key: `tab-${t}` })
      for (const el of await ui.findAll({ type: 'Text' })) expect(textWidth(el.text)).toBeLessThanOrEqual(w)
    }
    await ui.press({ key: 'tab-overview' })
    const card = await ui.find({ type: 'Text', text: /^╭ Opus 5\.5/ })
    if (w >= 60) expect(card).toBeDefined()
    else expect(card).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Context/ })).toBeDefined()
    await ui.unmount()
  })
}
