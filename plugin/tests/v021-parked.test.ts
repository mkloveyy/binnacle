import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { append, newSession, personTurnAt, viaOf } from '../hooks/modules/activity/events.ts'
import { agentRows, buildTree, HAND_BACK } from '../hooks/modules/activity/tree.ts'
import { files, home, savedRecord } from './files.ts'

describe('§7.3 how a turn began', () => {
  test('viaOf names the origins the person did not type', () => {
    expect(viaOf({ kind: 'composer' }, 'go')).toBeNull()
    expect(viaOf({ kind: 'plugin', asUser: true }, 'dictated')).toBeNull()
    expect(viaOf({ kind: 'task-notification' }, '<task-notification> …')).toBe('hand-back')
    expect(viaOf({ kind: 'peer' }, '<agent-message from="a1"> [Subagent hand-back]')).toBe('hand-back')
    expect(viaOf({ kind: 'peer' }, 'hi from the other session')).toBe('peer')
    expect(viaOf({ kind: 'scheduled-trigger' }, 'check the deploy')).toBe('loop')
    expect(viaOf({ kind: 'plugin' }, 'from a plugin')).toBe('plugin')
    expect(viaOf({ kind: 'unclassified' }, 'x')).toBe('other')
  })
  test('only a hand-back keeps "this turn" running; a /loop firing starts a new one; old records keep the old rule', () => {
    let s = append(newSession('s1', 0, '/r'), { at: 100, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
    s = append(s, { at: 200, turnId: 't2', agentId: null, kind: 'turn-start', prompt: '<task-notification>', auto: true, via: 'hand-back' })
    expect(personTurnAt(s)).toBe(100)
    s = append(s, { at: 300, turnId: 't3', agentId: null, kind: 'turn-start', prompt: 'check the deploy', auto: true, via: 'loop' })
    expect(personTurnAt(s)).toBe(300)
    let old = append(newSession('s2', 0, '/r'), { at: 100, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
    old = append(old, { at: 200, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'from a peer', auto: true })
    expect(personTurnAt(old)).toBe(100)
  })
  test('a /loop turn is labelled as one', () => {
    const s = append(newSession('s1', 0, '/r'), { at: 100, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'check the deploy', auto: true, via: 'loop' })
    expect(buildTree(s, 0, 0)[0]?.text).toBe('#1 · running · ⟳ /loop · check the deploy')
  })
  test('HAND_BACK is exported for the fallback', () => {
    expect(HAND_BACK.test('<task-notification> <task-id>a1</task-id>')).toBe(true)
    expect(HAND_BACK.test('run the tests')).toBe(false)
  })
})

describe('§7.2 a foreground agent with no end in an ended turn', () => {
  const s = (() => {
    let x = append(newSession('s1', 0, '/r'), { at: 1_000, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'go' })
    x = append(x, { at: 2_000, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'cut off', parentAgentId: null, background: false })
    x = append(x, { at: 9_000, turnId: 't1', agentId: null, kind: 'turn-end', durationMs: 8_000, costUsd: null, aborted: true })
    return x
  })()
  test('is unfinished in the tree, not running', () => {
    expect(buildTree(s, 0, 0)[0]?.children?.[0]?.text).toBe('Explore · cut off · unfinished')
  })
  test('is unfinished with no duration in the Agents history', () => {
    expect(agentRows(s, 0, 60_000)[0]?.text).toBe('Explore · cut off · — · 0 steps · unfinished')
  })
})

type Ev = { kind: string; [k: string]: unknown }
type Rec = { events: Ev[] }

/** The session files, read back by savedRecord. */
let disk: ReturnType<typeof files>

function world(on: On) {
  disk = files(on)
  home(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  return (key: string) => writes.filter(w => w.key === key).at(-1)?.value
}

test('§7.1 a hand-back whose prompt.submit finished before its turn.start still counts as a hand-back', async ($, on) => {
  const last = world(on)
  await $.turn.start({ text: '<task-notification> <task-id>a1</task-id> done', turnId: 't1' })
  const turn = ((await savedRecord($, disk)) as Rec).events.find(ev => ev.kind === 'turn-start')
  expect(turn).toMatchObject({ auto: true, via: 'hand-back' })
})

test('§7.3 a /loop firing is recorded with via loop and starts a new "this turn"', async ($, on) => {
  const last = world(on)
  let n = 0
  on('prompt.submit', async (_$, e) => {
    await $.turn.start({ text: e.text, turnId: `t${++n}` })
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: 'check the deploy', origin: { kind: 'scheduled-trigger' }, wait: false })
  const turns = ((await savedRecord($, disk)) as Rec).events.filter(ev => ev.kind === 'turn-start')
  expect(turns.map(ev => [ev.turnId, ev.auto ?? false, ev.via ?? null])).toEqual([['t1', false, null], ['t2', true, 'loop']])
})

test('§7.4 two permission checks whose writes land out of order still count both', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const writes: { key: string; value: unknown }[] = []
  on('state.set', (_$, e, next) => { writes.push(e as never); return next(e) })
  let release: () => void = () => undefined
  const gate = new Promise<void>(r => { release = r })
  let first = true
  // The first check's read of the tally waits until the second check has written: its write lands last.
  on('state.get', async (_$, e, next) => {
    if (e.key === 'perm' && first) {
      first = false
      await gate
    }
    return next(e)
  })
  on('tool.check', () => ({ decision: 'allow' }))
  const one = $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu1' })
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'tu2' })
  release()
  await one
  const perm = writes.filter(w => w.key === 'perm').at(-1)?.value as { allow: number }
  expect(perm.allow).toBe(2)
})

test('§7.1 a hand-back turn while the person\'s prompt is under way does not take the person\'s submission', async ($, on) => {
  const last = world(on)
  let release: () => void = () => undefined
  const gate = new Promise<void>(r => { release = r })
  on('prompt.submit', async (_$, e) => {
    await gate
    await $.turn.start({ text: e.text, turnId: 't-person' })
    return { text: e.text }
  })
  const person = $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false })
  await $.turn.start({ text: '<task-notification> <task-id>a1</task-id> done', turnId: 't-hand-back' })
  release()
  await person
  const turns = ((await savedRecord($, disk)) as Rec).events.filter(ev => ev.kind === 'turn-start')
  expect(turns.map(ev => [ev.turnId, ev.auto ?? false, ev.via ?? null])).toEqual([['t-hand-back', true, 'hand-back'], ['t-person', false, null]])
})
