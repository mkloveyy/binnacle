import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { append, newSession } from '../hooks/modules/activity/events.ts'
import { brief } from '../hooks/modules/activity/mask.ts'
import { entryOf, sizeOf } from '../hooks/modules/activity/store.ts'
import { files, home, savedRecord, sessionFile } from './files.ts'

const PANE = { component: 'Pane' as const, requestId: 'binnacle', props: { title: 'binnacle', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }

type Rec = { sessionId: string; endedAt: number | null; events: { kind: string; prompt?: string }[] }

const DAY = 24 * 60 * 60 * 1000

/**
 * A store in a Map and session files in memory the test can read, plus the bottoms a turn needs. `refuse`: store
 * keys and file paths whose writes fail. `now`: where the clock starts.
 */
function world(on: On, id: () => string, refuse = (_target: string) => false, now = 5_000) {
  const disk = files(on, { refuse })
  home(on)
  const clock = mock.clock(on, { now })
  const stored = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => {
    if (refuse(e.key)) throw new Error('$.store.set: the store would be over the limit')
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('session.id', () => ({ value: id() }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  return { stored, disk, clock }
}

const activityKeys = (stored: Map<string, unknown>) => [...stored.keys()].filter(k => k.startsWith('activity:'))

test('each main turn writes the session to its file in the plugin data directory, and the index to the store', async ($, on) => {
  const { stored, disk } = world(on, () => 's1')
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete({ answer: 'hi', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(disk.writes).toContain('/home/u/.claude/plugins/data/binnacle-binnacle/sessions/s1.json')
  expect((disk.record('s1') as Rec).events.map(ev => ev.kind)).toEqual(['turn-start', 'turn-end'])
  expect(stored.get('activity:index')).toEqual([expect.objectContaining({ sessionId: 's1', firstPrompt: 'hello', endedAt: null })])
  expect(activityKeys(stored)).toEqual(['activity:index'])
})

const FIRST = { version: 1, sessionId: 's1', startedAt: 1, endedAt: 2, cwd: '/repo', firstPrompt: 'first', events: [{ at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'first' }], counts: [] }

test('a resumed session continues its saved record', async ($, on) => {
  const { stored, disk } = world(on, () => 's1')
  disk.seed('s1', { version: 1, sessionId: 's1', startedAt: 1, endedAt: 2, cwd: '/repo', firstPrompt: 'first', events: [{ at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'first' }], counts: [] })
  stored.set('activity:index', [{ sessionId: 's1', startedAt: 1, endedAt: 2, cwd: '/repo', firstPrompt: 'first', bytes: 200 }])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'second', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const s = disk.record('s1') as Rec
  expect(s.events.map(ev => ev.prompt)).toEqual(['first', 'second', undefined])
  expect(s.endedAt).toBeNull()
})

test('a resumed session saved in the store before 0.4.0 continues too, and its newer record goes to its file', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 's1')
  stored.set('activity:s1', FIRST)
  stored.set('activity:index', [{ sessionId: 's1', startedAt: 1, endedAt: 2, cwd: '/repo', firstPrompt: 'first', bytes: 200 }])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.turn.start({ text: 'second', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect((disk.record('s1') as Rec).events.map(ev => ev.prompt)).toEqual(['first', 'second', undefined])
})

test('/clear saves the old session and starts a new record', async ($, on) => {
  let id = 's1'
  const { disk } = world(on, () => id)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  id = 's2'
  await $.turn.start({ text: 'two', turnId: 't2' })
  expect((disk.record('s1') as Rec).endedAt).toBe(5_000)
  const s = (await savedRecord($, disk, 's2')) as Rec
  expect(s.sessionId).toBe('s2')
  expect(s.events.map(ev => ev.kind)).toEqual(['turn-start'])
})

test('session.end saves the record and its index entry with the time it came', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 's1')
  await $.turn.start({ text: 'one', turnId: 't1' })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(4_000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect((disk.record('s1') as Rec).endedAt).toBe(9_000)
  expect(stored.get('activity:index')).toEqual([expect.objectContaining({ sessionId: 's1', endedAt: 9_000 })])
})

test('exiting after /clear keeps the time the cleared session ended', async ($, on) => {
  let id = 's1'
  const { stored, disk, clock } = world(on, () => id)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  id = 's2'
  await clock.advance(4_000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: { id: 's2' } })
  expect((disk.record('s1') as Rec).endedAt).toBe(5_000)
  expect(stored.get('activity:index')).toEqual([expect.objectContaining({ sessionId: 's1', endedAt: 5_000 })])
})

test('a session going on after its end is open again', async ($, on) => {
  const { disk } = world(on, () => 's1')
  await $.turn.start({ text: 'one', turnId: 't1' })
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect((disk.record('s1') as Rec).endedAt).toBe(5_000)
  await $.turn.start({ text: 'two', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect((disk.record('s1') as Rec).endedAt).toBeNull()
})

test('compaction saves the session record', async ($, on) => {
  const { disk } = world(on, () => 's1')
  on('session.compact', () => ({ skip: 'test' }))
  await $.turn.start({ text: 'one', turnId: 't1' })
  expect(disk.has('s1')).toBe(false)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'one', toolUses: [] }] })
  expect((disk.record('s1') as Rec).events.map(ev => ev.kind)).toEqual(['turn-start'])
})

const OLD = { version: 1, sessionId: 'old', startedAt: 0, endedAt: 1, cwd: '/x', firstPrompt: 'x', events: [], counts: [] }
const OLD_ENTRY = { sessionId: 'old', startedAt: 0, endedAt: 1, cwd: '/x', firstPrompt: 'x', bytes: 100 }

test('sessions started more than 90 days ago are deleted with rm -f on their file', async ($, on) => {
  const { stored, disk } = world(on, () => 's1', undefined, 91 * DAY)
  disk.seed('old', OLD)
  disk.seed('recent', { ...OLD, sessionId: 'recent', startedAt: 2 * DAY })
  stored.set('activity:index', [OLD_ENTRY, { ...OLD_ENTRY, sessionId: 'recent', startedAt: 2 * DAY }])
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(disk.removed).toEqual([sessionFile('old')])
  expect(disk.has('old')).toBe(false)
  expect(disk.has('recent')).toBe(true)
  expect((stored.get('activity:index') as { sessionId: string }[]).map(x => x.sessionId)).toEqual(['recent', 's1'])
})

test('an evicted session still in the store from before 0.4.0 loses its key too', async ($, on) => {
  const { stored, disk } = world(on, () => 's1', undefined, 91 * DAY)
  stored.set('activity:old', OLD)
  stored.set('activity:index', [OLD_ENTRY])
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(stored.has('activity:old')).toBe(false)
  expect(disk.removed).toEqual([sessionFile('old')])
  expect(activityKeys(stored)).toEqual(['activity:index'])
})

test('a data directory that refuses writes is reported once and recording goes on', async ($, on) => {
  files(on, { refuse: () => true })
  home(on)
  const clock = mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  mock.store(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  for (const t of ['t1', 't2']) {
    await $.turn.start({ text: t, turnId: t })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: t, reason: 'answer' })
  }
  await clock.settle()
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('could not save')
  expect(toasts[0]).toContain('the plugin data directory')
  expect(toasts[0]).toContain('/binnacle activity clear')
  // Nothing saved: the record held in memory still shows both turns.
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: '2 turns · 0 agents' })).toBeDefined()
  await ui.unmount()
})

test('with HOME unknown nothing is written, it is reported once, and recording goes on', async ($, on) => {
  const disk = files(on)
  on('env.get', () => ({ value: undefined }))
  const clock = mock.clock(on)
  on('session.id', () => ({ value: 's1' }))
  mock.store(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  for (const t of ['t1', 't2']) {
    await $.turn.start({ text: t, turnId: t })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: t, reason: 'answer' })
  }
  await clock.settle()
  expect(toasts).toEqual([expect.stringContaining('the plugin data directory')])
  expect(disk.writes).toEqual([])
  // Nothing saved: the record held in memory still shows both turns.
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: '2 turns · 0 agents' })).toBeDefined()
  await ui.unmount()
})

test('a record a concurrent call started is kept, not overwritten', async ($, on) => {
  const { disk } = world(on, () => 's1')
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }))
  // The first call to start a record waits on session.usage while a second call starts one and counts into it.
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let held = false
  on('session.usage', async () => {
    if (!held) {
      held = true
      await gate
    }
    return { value: { startedAt: 7 } } as never
  })
  const first = $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pwd', tool_use_id: 'tu2' } as never)
  release()
  await first
  // A session with no turn is not saved: one starts, then the record is read as saved.
  await $.turn.start({ text: 'go', turnId: 't1' })
  const s = (await savedRecord($, disk)) as Rec & { counts: { shell: number }[] }
  expect(s.counts.reduce((n, c) => n + c.shell, 0)).toBe(2)
})

/** The host's store: one JSON object of keys, refused past 4 194 304 characters. Also reports the largest it got. */
function limitedStore(on: On, limit = 4_194_304) {
  const stored = new Map<string, unknown>()
  const sizes = new Map<string, number>()
  let sum = 0
  const total = (n: number, s: number) => 2 + s + Math.max(0, n - 1)
  const stats = { peak: 0 }
  const set = (key: string, value: unknown) => {
    const c = JSON.stringify(key).length + 1 + JSON.stringify(value).length
    const s = sum - (sizes.get(key) ?? 0) + c
    const t = total(sizes.has(key) ? sizes.size : sizes.size + 1, s)
    if (t > limit) throw new Error(`$.store.set: the store would be ${t} characters, over the ${limit} limit`)
    stored.set(key, value)
    sizes.set(key, c)
    sum = s
    stats.peak = Math.max(stats.peak, t)
  }
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => {
    sum -= sizes.get(e.key) ?? 0
    sizes.delete(e.key)
    stored.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  return { stored, stats, seed: set }
}

const sid = (i: number) => `${String(i).padStart(8, '0')}-1111-2222-3333-444455556666`
const CWD = `/Users/someone/workspace/${'deep/'.repeat(12)}project`
const PROMPT = 'please look at this and reply ok '.repeat(4)

/** A one-turn session as `claude -p` leaves it, built with the module's own functions. */
function oneTurn(i: number) {
  let s = newSession(sid(i), i, CWD)
  s = append(s, { at: i, turnId: `t-${i}`, agentId: null, kind: 'turn-start', prompt: brief(PROMPT) })
  s = append(s, { at: i, turnId: `t-${i}`, agentId: null, kind: 'turn-end', durationMs: 4_000, costUsd: 0.01, aborted: false })
  return { ...s, endedAt: i + 1 }
}

test('thousands of one-turn sessions: at most 500 files are kept, the oldest dropped, and the store stays small', { timeoutMs: 120_000 }, async ($, on) => {
  const disk = files(on)
  home(on)
  const { stored, stats, seed } = limitedStore(on)
  // 3 900 sessions already saved, all of them listed.
  const seeded = Array.from({ length: 3_900 }, (_, i) => oneTurn(i))
  for (const s of seeded) disk.seed(s.sessionId, s)
  seed('activity:index', seeded.map(s => entryOf(s, sizeOf(s))))
  seed('settings', { version: 1 })
  mock.clock(on, { now: 10_000_000 })
  let n = 3_900
  on('session.id', () => ({ value: sid(n) }))
  on('session.cwd', () => ({ value: CWD }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  for (; n < 4_400; n++) {
    await $.turn.start({ text: PROMPT, turnId: `t-${n}` })
    await $.turn.complete({ answer: 'ok', durationMs: 4_000, isAborted: false, turnId: `t-${n}`, reason: 'answer' })
    await $.session.end({ reason: 'other', sessionId: sid(n), resume: { id: sid(n) } })
  }
  expect(toasts).toEqual([])
  expect(stats.peak).toBeLessThanOrEqual(4_194_304)
  const index = stored.get('activity:index') as { sessionId: string }[]
  expect(index).toHaveLength(500)
  expect(index.at(-1)?.sessionId).toBe(sid(4_399))
  expect(disk.has(sid(0))).toBe(false)
  expect(disk.has(sid(4_399))).toBe(true)
  expect(disk.ids().sort()).toEqual(index.map(x => x.sessionId).sort())
  expect([...stored.keys()].filter(k => k.startsWith('activity:'))).toEqual(['activity:index'])
  expect(disk.removed.length).toBeGreaterThan(3_000)
})

test('a session with no turn is neither saved nor listed', async ($, on) => {
  const { stored, disk } = world(on, () => 's1')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(activityKeys(stored)).toEqual([])
  expect(disk.ids()).toEqual([])
})

test('a /clear right after a start saves nothing for the empty session', async ($, on) => {
  let id = 's1'
  const { stored, disk } = world(on, () => id)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  id = 's2'
  await $.turn.start({ text: 'two', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(activityKeys(stored)).toEqual(['activity:index'])
  expect(disk.ids()).toEqual(['s2'])
})

for (const failing of [sessionFile('s1'), 'activity:index']) {
  test(`sessions due for eviction stay when writing ${failing} fails`, async ($, on) => {
    const { stored, disk } = world(on, () => 's1', target => target === failing, 91 * DAY)
    on('ui.toast', () => ({ value: undefined }))
    disk.seed('old', OLD)
    stored.set('activity:index', [OLD_ENTRY])
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(disk.has('old')).toBe(true)
    expect(disk.removed).toEqual([])
  })
}

test('saved sessions the index lost are listed again from the files and the store, and count toward the cap', async ($, on) => {
  const { stored, disk } = world(on, () => 's1')
  disk.seed('lost', { version: 1, sessionId: 'lost', startedAt: 3, endedAt: 4, cwd: '/x', firstPrompt: 'lost one', events: [{ at: 3, turnId: 'o', agentId: null, kind: 'turn-start', prompt: 'lost one' }], counts: [] })
  disk.disk.set(sessionFile('junk'), 'not JSON')
  disk.disk.set(`${sessionFile('notes')}.bak`, '{}')
  stored.set('activity:legacy', { version: 1, sessionId: 'legacy', startedAt: 5, endedAt: 6, cwd: '/x', firstPrompt: 'from the store', events: [], counts: [] })
  stored.set('activity:index', [])
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const index = stored.get('activity:index') as { sessionId: string; firstPrompt: string; startedAt: number }[]
  expect(index.map(x => x.sessionId).sort()).toEqual(['junk', 'legacy', 'lost', 's1'])
  expect(index.find(x => x.sessionId === 'lost')?.firstPrompt).toBe('lost one')
  expect(index.find(x => x.sessionId === 'legacy')?.firstPrompt).toBe('from the store')
  expect(index.find(x => x.sessionId === 'junk')?.startedAt).toBe(0)
})

// ── moving the store's records to files (0.4.0) ──
const rec = (id: string, prompt: string) => ({ version: 1, sessionId: id, startedAt: 1, endedAt: 2, cwd: '/x', firstPrompt: prompt, events: [{ at: 1, turnId: 't', agentId: null, kind: 'turn-start', prompt }], counts: [] })
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

test('after session.start each record in the store moves to its file and its key is deleted; the index stays', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 'me')
  const index = [{ ...OLD_ENTRY, sessionId: 'a' }, { ...OLD_ENTRY, sessionId: 'b' }]
  stored.set('activity:a', rec('a', 'one'))
  stored.set('activity:b', rec('b', 'two'))
  stored.set('activity:index', index)
  stored.set('settings', { version: 1 })
  await $.session.start(START)
  // In the background: session.start does not wait for it.
  expect(disk.ids()).toEqual([])
  await clock.settle()
  expect(disk.record('a')).toEqual(rec('a', 'one'))
  expect(disk.record('b')).toEqual(rec('b', 'two'))
  expect([...stored.keys()].sort()).toEqual(['activity:index', 'settings'])
  expect(stored.get('activity:index')).toEqual(index)
})

test('a record that fails to move stays in the store, still readable; the others move', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 'me', target => target === sessionFile('a'))
  stored.set('activity:a', rec('a', 'one'))
  stored.set('activity:b', rec('b', 'two'))
  await $.session.start(START)
  await clock.settle()
  expect(stored.get('activity:a')).toEqual(rec('a', 'one'))
  expect(disk.has('a')).toBe(false)
  expect(disk.record('b')).toEqual(rec('b', 'two'))
  expect(stored.has('activity:b')).toBe(false)
})

test('a file already there is kept, and the stale store key goes', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 'me')
  disk.seed('a', rec('a', 'newer'))
  stored.set('activity:a', rec('a', 'older'))
  await $.session.start(START)
  await clock.settle()
  expect(disk.record('a')).toEqual(rec('a', 'newer'))
  expect(stored.has('activity:a')).toBe(false)
})

test('a store copy newer than the file (an older binnacle still saving it in another terminal) replaces the file', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 'me')
  disk.seed('a', rec('a', 'file'))
  const later = { ...rec('a', 'store'), endedAt: 9, events: [...rec('a', 'store').events, { at: 9, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'more' }] }
  stored.set('activity:a', later)
  await $.session.start(START)
  await clock.settle()
  expect(disk.record('a')).toEqual(later)
  expect(stored.has('activity:a')).toBe(false)
})

test('the session held now is left to its own saves, not overwritten by its older copy', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 's1')
  stored.set('activity:s1', FIRST)
  await $.session.start(START)
  await clock.settle()
  expect(disk.has('s1')).toBe(false)
  expect(stored.get('activity:s1')).toEqual(FIRST)
})

test('a store key whose id is not a file name is never moved or turned into a path', async ($, on) => {
  const { stored, disk, clock } = world(on, () => 'me')
  stored.set('activity:../../evil', rec('x', 'x'))
  stored.set('activity:a/b', rec('y', 'y'))
  await $.session.start(START)
  await clock.settle()
  expect(disk.writes).toEqual([])
  expect(stored.has('activity:../../evil')).toBe(true)
  expect(stored.has('activity:a/b')).toBe(true)
})

test('with HOME unknown nothing moves and nothing throws', async ($, on) => {
  const disk = files(on)
  on('env.get', () => ({ value: undefined }))
  const clock = mock.clock(on)
  const stored = new Map<string, unknown>([['activity:a', rec('a', 'one')]])
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { stored.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('session.id', () => ({ value: 'me' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  await $.session.start(START)
  await clock.settle()
  expect(disk.writes).toEqual([])
  expect(stored.get('activity:a')).toEqual(rec('a', 'one'))
})

test('a full store never breaks the status and guard toggles', async ($, on) => {
  mock.clock(on)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => { throw new Error('$.store.set: the store would be 4215182 characters, over the 4194304 limit') })
  const hide = await $.command.run({ command: 'binnacle', args: 'status hide cwd' })
  expect(hide.text).toBe('cwd hidden.')
  const off = await $.command.run({ command: 'binnacle', args: 'guard off git.force-push' })
  expect(off.text).toBe('rule git.force-push turned off.')
  const list = await $.command.run({ command: 'binnacle', args: 'guard list' })
  expect(list.text).toContain('✗ git.force-push')
})
