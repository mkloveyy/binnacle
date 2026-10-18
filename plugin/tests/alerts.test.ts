import { expect, mock, test } from 'claude-code/testing'

const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' }, viewport: { columns: 200, rows: 50 } }

/**
 * Alerts are toasts (user, 2026-10-13: the line under the status line sat oddly indented): one when a limit passes 90%
 * or the context passes 80% / 90%, not again while it stays there, again once it drops back and passes it once more.
 */
test('the context passing 80% toasts once; staying there is quiet; dropping back and passing again toasts again', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let percent = 50
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: percent * 10_000, percent }, rateLimits: [], cost: { usd: 1 } } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'binnacle' } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  const turn = async (n: number) => {
    await $.turn.start({ text: `t${n}`, turnId: `t${n}` })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
  }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turn(1)
  expect(toasts.filter(t => t.includes('context'))).toEqual([])
  percent = 82
  await turn(2)
  await turn(3)
  expect(toasts.filter(t => t.includes('context')).length).toBe(1)
  expect(toasts.find(t => t.includes('context'))).toMatch(/^⚠ context 82%/)
  percent = 40
  await turn(4)
  percent = 85
  await turn(5)
  expect(toasts.filter(t => t.includes('context')).length).toBe(2)
  // No line under the status line any more.
  const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Text', text: /⚠ context/ })).toBeUndefined()
  await hint.unmount()
})
