import { describe, expect, mock, test } from 'claude-code/testing'
import type { BinnacleActivitySession } from '../types'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { liveRows } from '../hooks/modules/activity/derive.ts'
import { agentRows } from '../hooks/modules/activity/tree.ts'
import { timeline } from '../hooks/modules/activity/timeline.ts'
import { textWidth } from '../hooks/core/width.ts'
import { layoutRows, widthOf, type Span } from '../hooks/modules/ui/cols.ts'

const T = 1_800_000_000_000
const text = (l: Span[]): string => l.map(s => s.text).join('')

function session(): BinnacleActivitySession {
  let s = newSession('s', T, '/r')
  const add = (ev: Parameters<typeof append>[1]) => { s = append(s, ev) }
  add({ at: T, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 't1' })
  add({ at: T + 1_000, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'x', parentAgentId: null, background: true })
  add({ at: T + 63_000, turnId: 't1', agentId: 'a1', kind: 'agent-end', durationMs: 62_000, tokensIn: 1, tokensOut: 1, aborted: false, report: [] })
  add({ at: T + 100_000, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 't2' })
  add({ at: T + 101_000, turnId: 't2', agentId: 'a2', kind: 'agent-start', agentType: 'Plan', model: 'm', task: 'y', parentAgentId: null, background: true })
  add({ at: T + 150_000, turnId: 't2', agentId: 'a2', kind: 'agent-end', durationMs: 48_000, tokensIn: 1, tokensOut: 1, aborted: true, report: [] })
  add({ at: T + 160_000, turnId: 't2', agentId: 'a3', kind: 'agent-start', agentType: 'general', model: 'm', task: 'z', parentAgentId: null, background: true })
  return s
}

describe('timeline (§4.8)', () => {
  const tl = timeline(session(), T, T + 200_000, 80)!
  test('turn starts marked #N on the axis, one lane per agent, state and duration right-aligned', () => {
    expect(text(tl.marks)).toMatch(/^\s+#1\s+#2$/)
    expect(text(tl.lanes[0] as Span[])).toMatch(/^ Explore\s+━+\s+✓\s+1m02s$/)
    expect(text(tl.lanes[1] as Span[])).toMatch(/✗\s+48s$/)
    expect(text(tl.lanes[2] as Span[])).toMatch(/●\s+40s$/)
    for (const l of tl.lanes) expect(widthOf(l)).toBeLessThanOrEqual(80)
    expect(tl.summary).toMatch(/^\d\d:\d\d → \d\d:\d\d now$/)
  })
  test('bars coloured by state: running suggestion, done inactive, failed error; at least one cell', () => {
    expect([tl.lanes[0]?.[2]?.color, tl.lanes[1]?.[2]?.color, tl.lanes[2]?.[2]?.color]).toEqual(['inactive', 'error', 'suggestion'])
    for (const l of tl.lanes) expect((l[2]?.text ?? '').length).toBeGreaterThanOrEqual(1)
  })
  test('the newest 4 below 70 columns, none below 60', () => {
    let s = session()
    for (const id of ['a4', 'a5']) s = append(s, { at: T + 170_000, turnId: 't2', agentId: id, kind: 'agent-start', agentType: id, model: 'm', task: 'w', parentAgentId: null, background: true })
    expect(timeline(s, T, T + 200_000, 80)?.lanes).toHaveLength(5)
    const narrow = timeline(s, T, T + 200_000, 65)
    expect(narrow?.lanes).toHaveLength(4)
    // The newest four: Plan, general, a4, a5.
    expect(narrow?.lanes.map(l => (l[0]?.text ?? '').trim())).toEqual(['Plan', 'general', 'a4', 'a5'])
    expect(timeline(s, T, T + 200_000, 59)).toBeNull()
  })
})

describe('live rows keep their text and gain a laid-out row', () => {
  test('the running agent row', () => {
    const r = liveRows(session(), [], T + 200_000, T)
    const run = r.find(x => x.text.startsWith('●'))
    expect(run?.text).toBe('● general · z · 40s · 0 steps')
    expect(text(layoutRows([run!.row], 60)[0] as Span[])).toMatch(/^● general   z\s+40s {2}0 steps$/)
  })
})

describe('a CJK agent type is measured in columns, not characters', () => {
  const CJK = '代码审查代理' // 6 characters, 12 columns: wider than 'Explore' though shorter in .length
  function cjk(): BinnacleActivitySession {
    let s = session()
    s = append(s, { at: T + 170_000, turnId: 't2', agentId: 'a4', kind: 'agent-start', agentType: CJK, model: 'm', task: 'w', parentAgentId: null, background: true })
    return s
  }
  test('history rows: the tasks start in one column', () => {
    const lines = layoutRows(agentRows(cjk(), T, T + 200_000).map(r => r.row), 80)
    expect(lines).toHaveLength(4)
    // The lead (the padded type) is the first span; the task follows it.
    expect(new Set(lines.map(l => widthOf(l.slice(0, 1)))).size).toBe(1)
    expect(text(lines[0] as Span[])).toMatch(new RegExp(`^${CJK} {3}w`))
    for (const l of lines) expect(widthOf(l)).toBeLessThanOrEqual(80)
  })
  test('live rows: the tasks start in one column', () => {
    const lines = layoutRows(liveRows(cjk(), [], T + 200_000, T).map(r => r.row), 80)
    // a2 done since this turn, a3 and a4 running.
    expect(lines.map(l => text(l)[0])).toEqual(['✓', '●', '●'])
    // The lead is the symbol and the padded type.
    expect(new Set(lines.map(l => widthOf(l.slice(0, 2)))).size).toBe(1)
  })
  test('timeline lanes: the bars share one origin and no lane is wider than the pane', () => {
    for (const width of [60, 80]) {
      const tl = timeline(cjk(), T, T + 200_000, width)!
      expect(new Set(tl.lanes.map(l => widthOf([l[0] as Span]))).size).toBe(1)
      expect(widthOf(tl.lanes[0]?.slice(0, 1) ?? [])).toBe(widthOf(tl.axis.slice(0, 1)))
      for (const l of tl.lanes) expect(widthOf(l)).toBe(width)
      // The name column is 10 columns at most: the 12-column type keeps its first 5 characters.
      expect(text(tl.lanes.at(-1) as Span[])).toMatch(/^ 代码审查代 {2}/)
    }
  })
})

test('a lane name with a tab or an escape draws as one visible line', () => {
  let s = session()
  s = append(s, { at: T + 170_000, turnId: 't2', agentId: 'a5', kind: 'agent-start', agentType: 'E\tx\x1b[1m', model: 'm', task: 'w', parentAgentId: null, background: true })
  const tl = timeline(s, T, T + 200_000, 80)!
  const lane = text(tl.lanes.at(-1) as Span[])
  expect(lane).toMatch(/^ E x\^\[\[1m /)
  expect(lane).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
  expect(widthOf(tl.lanes.at(-1) as Span[])).toBe(80)
})

const PANE = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'binnacle',
  props: { title: 'binnacle', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const SPAWN = {
  tool_use_id: 'tu-agent', prompt: 'p', description: 'find store writes', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false,
}

for (const cols of [50, 80, 120]) {
  test(`the Agents tab fits ${cols} columns; the timeline only from 60`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'binnacle' } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.agent.spawn(SPAWN)
    const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE(cols) })
    await ui.press({ key: 'tab-agents' })
    const w = Math.max(20, cols - 2)
    for (const el of [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))]) {
      if (el.key?.startsWith('tab-')) continue
      expect(textWidth(el.text)).toBeLessThanOrEqual(w)
    }
    const head = await ui.find({ key: 'tl-head' })
    if (w >= 60) expect(head).toBeDefined()
    else expect(head).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Now\s+1 running · 0 waiting$/ })).toBeDefined()
    await ui.unmount()
  })
}
