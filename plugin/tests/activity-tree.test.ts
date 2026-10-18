import { describe, expect, test } from 'claude-code/testing'
import type { BinnacleActivitySession } from '../types'
import { append, bump, newSession } from '../hooks/modules/activity/events.ts'
import { agentRows, buildTree, findNode, flatten, openByDefault, rowLabel, sessionLabel, sessionOptions, toggledOpen } from '../hooks/modules/activity/tree.ts'

function sample(): BinnacleActivitySession {
  let s = newSession('s1', 0, '/repo')
  s = append(s, { at: 1_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'first' })
  s = append(s, { at: 2_000, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'claude-haiku-5-5', task: 'find store writes', parentAgentId: null, background: false })
  s = append(s, { at: 3_000, turnId: 't1', agentId: 'a2', kind: 'agent-start', agentType: 'Plan', model: 'm', task: 'plan it', parentAgentId: 'a1', background: false })
  s = append(s, { at: 3_500, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: 'rm -rf /tmp/x', decision: 'ask', decider: 'user', outcome: 'denied-by-user' })
  s = append(s, { at: 64_000, turnId: 't1', agentId: 'a1', kind: 'agent-end', durationMs: 62_000, tokensIn: 12_000, tokensOut: 3_000, aborted: false, report: ['Found it in store.ts'] })
  s = append(s, { at: 135_000, turnId: 't1', agentId: null, kind: 'turn-end', durationMs: 134_000, costUsd: 0.41, aborted: false })
  s = append(s, { at: 140_000, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'second' })
  return bump(bump(s, 't1', null, 'Bash'), 't1', null, 'Bash')
}

describe('buildTree', () => {
  test('turns newest first, agents nested under their parent, events and counts as leaves', () => {
    const tree = buildTree(sample(), 5_000, 0)
    expect(tree.map(n => n.text)).toEqual(['#2 · running · "second"', '#1 · 2m14s · $0.41 · "first"'])
    const t1 = tree[1]!
    expect(t1.children?.map(n => n.text)).toEqual([
      'Explore · find store writes · 1m02s · 12k/3k tok',
      '✗ asked → you denied · rm -rf /tmp/x',
      'files 0 · shell 2 · other 0',
    ])
    expect(t1.children?.[1]?.color).toBe('red')
    const a1 = t1.children?.[0]
    expect(a1?.children?.map(n => n.text)).toEqual(['Plan · plan it · unfinished'])
    expect(a1?.detail).toContain('  Found it in store.ts')
  })
  test('an agent whose parent is not in the record is shown under its turn, not dropped', () => {
    let s = append(newSession('s2', 0, '/repo'), { at: 1_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'p' })
    s = append(s, { at: 2_000, turnId: 't1', agentId: 'x', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'orphan', parentAgentId: 'gone', background: false })
    expect(buildTree(s, 0, 0)[0]?.children?.map(n => n.text)).toEqual(['Explore · orphan · running'])
  })
  test('permission, guard and error rows cut their text at 40 characters, like turn and agent rows', () => {
    const long = 'abcd '.repeat(24).trim()
    const cut = `${long.slice(0, 39)}…`
    let s = append(newSession('s3', 0, '/repo'), { at: 1_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'p' })
    s = append(s, { at: 2_000, turnId: 't1', agentId: null, kind: 'perm', tool: 'Bash', summary: long, decision: 'deny', decider: 'rule', outcome: null })
    s = append(s, { at: 3_000, turnId: 't1', agentId: null, kind: 'guard', ruleId: 'files.rm-recursive', action: 'ask-deny', summary: long })
    s = append(s, { at: 4_000, turnId: 't1', agentId: null, kind: 'error', tool: 'Bash', summary: 'x', message: long })
    const t1 = buildTree(s, 0, 0)[0]
    expect(t1?.children?.map(n => n.text)).toEqual([
      `✗ denied by rule · ${cut}`,
      `⚑ guard ask-deny · files.rm-recursive · ${cut}`,
      `! Bash · ${cut}`,
    ])
    expect(findNode([t1!], 'ev:3')?.detail).toContain(`message: ${long}`)
  })
  test('a saved session (since = Infinity) has no running turns', () => {
    expect(buildTree(sample(), Number.POSITIVE_INFINITY, 0)[0]?.text).toBe('#2 · unfinished · "second"')
  })
})

describe('agentRows', () => {
  test('every agent, newest first: type · task · duration · steps · outcome, with details', () => {
    let s = sample()
    s = append(s, { at: 141_000, turnId: 't2', agentId: 'a3', kind: 'agent-start', agentType: 'general-purpose', model: 'm', task: 'make the dir', parentAgentId: null, background: true })
    s = append(s, { at: 142_000, turnId: 't2', agentId: 'a3', kind: 'perm', tool: 'Bash', summary: 'mkdir newdir', decision: 'ask', decider: 'user', outcome: 'denied-by-user' })
    s = append(s, { at: 143_000, turnId: 't2', agentId: 'a3', kind: 'error', tool: 'Read', summary: 'x', message: 'no such file' })
    s = append(s, { at: 145_000, turnId: 't2', agentId: 'a3', kind: 'agent-end', durationMs: 4_000, tokensIn: 1, tokensOut: 1, aborted: false, report: ['could not make it'] })
    s = append(s, { at: 146_000, turnId: 't2', agentId: 'a4', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'look \x1b[31m', parentAgentId: null, background: false })
    s = bump(bump(s, 't2', 'a3', 'Bash'), 't2', 'a3', 'Read')
    const rows = agentRows(s, 146_000, 150_000)
    expect(rows.map(r => r.text)).toEqual([
      'Explore · look ^[[31m · 4s · 0 steps · running',
      'general-purpose · make the dir · 4s · 2 steps · ✗ 1 denied · 1 error',
      'Plan · plan it · — · 0 steps · unfinished',
      'Explore · find store writes · 1m02s · 0 steps · ✓ done',
    ])
    expect(rows.map(r => r.key)).toEqual(['agent:a4', 'agent:a3', 'agent:a2', 'agent:a1'])
    expect(rows[1]?.detail).toEqual([
      'agent general-purpose · m · background',
      'task: make the dir',
      'started ' + new Date(141_000).toTimeString().slice(0, 8) + ' · ran 4s',
      'tools: files 1 · shell 1 · other 0',
      'denials:',
      '  ✗ asked → you denied · mkdir newdir',
      'errors:',
      '  ! Read · no such file',
      'answer:',
      '  could not make it',
    ])
  })
})

describe('hand-back turns', () => {
  test('are labelled with the agent they hand back, not their raw text; the raw text stays in the details', () => {
    let s = sample()
    s = append(s, { at: 150_000, turnId: 't3', agentId: null, kind: 'turn-start', prompt: '<agent-message from="a1"> [Subagent hand-back] The text below…', auto: true })
    s = append(s, { at: 151_000, turnId: 't4', agentId: null, kind: 'turn-start', prompt: '<task-notification> <task-id>a1</task-id> <tool-use-id>tu</tool-use-id>', auto: true })
    s = append(s, { at: 152_000, turnId: 't5', agentId: null, kind: 'turn-start', prompt: '<task-notification> <task-id>gone</task-id>', auto: true })
    s = append(s, { at: 153_000, turnId: 't6', agentId: null, kind: 'turn-start', prompt: 'a peer says hi', auto: true })
    const tree = buildTree(s, Number.POSITIVE_INFINITY, 0)
    expect(tree.slice(0, 4).map(n => n.text)).toEqual([
      '#6 · unfinished · "a peer says hi"',
      '#5 · unfinished · ↩ agent hand-back',
      '#4 · unfinished · ↩ agent hand-back · Explore · find store writes',
      '#3 · unfinished · ↩ agent hand-back · Explore · find store writes',
    ])
    expect(tree[3]?.detail?.[0]).toBe('prompt: <agent-message from="a1"> [Subagent hand-back] The text below…')
  })
})

describe('openByDefault', () => {
  test('the newest turn, and also the latest one the person started when a hand-back turn came after it', () => {
    let s = sample()
    expect(openByDefault(s)).toEqual(['turn:t2'])
    s = append(s, { at: 150_000, turnId: 't3', agentId: null, kind: 'turn-start', prompt: '<agent-message from="a1">', auto: true })
    s = append(s, { at: 151_000, turnId: 't4', agentId: null, kind: 'turn-start', prompt: '<task-notification>', auto: true })
    expect(openByDefault(s)).toEqual(['turn:t4', 'turn:t2'])
    expect(openByDefault(newSession('s0', 0, '/repo'))).toEqual([])
  })
})

describe('flatten and labels', () => {
  test('only open nodes show their children; rows past the limit are counted', () => {
    const tree = buildTree(sample(), 5_000, 0)
    const open = toggledOpen([], ['turn:t1'])
    const { rows, hidden } = flatten(tree, open)
    expect(rows.map(r => [r.key, r.depth, r.hasChildren, r.isOpen])).toEqual([
      ['turn:t2', 0, false, false],
      ['turn:t1', 0, true, true],
      ['agent:a1', 1, true, false],
      ['ev:3', 1, false, false],
      ['count:t1:main', 1, false, false],
    ])
    expect(hidden).toBe(0)
    expect(flatten(tree, open, 2)).toMatchObject({ hidden: 3 })
    expect(rowLabel(rows[1]!)).toBe('▾ #1 · 2m14s · $0.41 · "first"')
    expect(rowLabel(rows[2]!)).toBe('  ▸ Explore · find store writes · 1m02s · 12k/3k tok')
    expect(rowLabel(rows[3]!)).toBe('    ✗ asked → you denied · rm -rf /tmp/x')
  })
  test('a default-open node closes when toggled', () => {
    const open = toggledOpen(['turn:t2'], ['turn:t2', 'turn:t1'])
    expect([open('turn:t2'), open('turn:t1'), open('agent:a1')]).toEqual([false, true, false])
  })
  test('findNode searches nested nodes', () => {
    expect(findNode(buildTree(sample(), 5_000, 0), 'agent:a2')?.text).toBe('Plan · plan it · unfinished')
    expect(findNode([], 'x')).toBeNull()
  })
})

describe('session list', () => {
  const at = new Date(2026, 9, 10, 21, 40).getTime()
  const entry = (sessionId: string, startedAt: number) => ({ sessionId, startedAt, endedAt: null, cwd: '/Users/me/workspace/binnacle', firstPrompt: 'fix the bug', bytes: 1 })
  test('labels carry local time, short directory and first prompt', () => {
    expect(sessionLabel(entry('s0', at), '/Users/me')).toBe('10-10 21:40 · ~/workspace/binnacle · "fix the bug"')
  })
  test('this session first, then saved ones newest first, without the current id', () => {
    const opts = sessionOptions([entry('old', at), entry('cur', at + 2), entry('mid', at + 1)], 'cur', '/Users/me')
    expect(opts.map(o => o.value)).toEqual(['current', 'mid', 'old'])
    expect(opts[0]?.label).toBe('This session')
  })
  test('at most 63 saved sessions are offered (the host refuses a Select with more than 64 options)', () => {
    const many = Array.from({ length: 70 }, (_, i) => entry(`s${i}`, at + i))
    const opts = sessionOptions(many, null, '/Users/me')
    expect(opts).toHaveLength(64)
    expect(opts[1]?.value).toBe('s69')
  })
  test('a saved id holding a control character is left out (the host refuses such a value)', () => {
    const opts = sessionOptions([entry('o\u001bd', at), entry('ok', at + 1)], null, '/Users/me')
    expect(opts.map(o => o.value)).toEqual(['current', 'ok'])
  })
})
