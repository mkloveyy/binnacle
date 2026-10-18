import { describe, expect, test } from 'claude-code/testing'
import { PREVIEW_LIMIT, runPreview, type Runner } from '../hooks/modules/guard/preview.ts'

const fake = (stdout: string, exitCode = 0) => {
  const calls: string[][] = []
  const run: Runner = async argv => { calls.push(argv); return { exitCode, stdout } }
  return { run, calls }
}

describe('runPreview', () => {
  test('rm lists files through a glob-only shell loop', async () => {
    const f = fake('build/a.js\nbuild/b.js\n')
    const out = (await runPreview({ kind: 'rm', targets: ['build'] }, f.run)).lines
    expect(out).toEqual(['2 file(s) would be deleted:', 'build/a.js', 'build/b.js'])
    expect(f.calls[0].slice(0, 2)).toEqual(['bash', '-c'])
    expect(f.calls[0].at(-1)).toBe('build')
  })
  test('rm refuses shell expansion and caps long lists', async () => {
    expect((await runPreview({ kind: 'rm', targets: ['$(whoami)'] }, fake('').run)).lines).toEqual(['cannot preview: the paths use shell expansion'])
    const many = Array.from({ length: 25 }, (_, i) => `f${i}`).join('\n')
    const out = (await runPreview({ kind: 'rm', targets: ['x'] }, fake(many).run)).lines
    expect(out).toHaveLength(PREVIEW_LIMIT + 2)
    expect(out.at(-1)).toBe('… and 5 more files')
  })
  test('find never runs actions', async () => {
    expect((await runPreview({ kind: 'find', args: ['.', '-exec', 'rm', '{}', ';'] }, fake('').run)).lines).toEqual(['cannot preview: find runs other actions'])
    const f = fake('./a.log\n')
    expect((await runPreview({ kind: 'find', args: ['.', '-name', '*.log'] }, f.run)).lines).toEqual(['1 file(s) would be deleted:', './a.log'])
    expect(f.calls[0]).toEqual(['find', '.', '-name', '*.log', '-print'])
  })
  test('git clean runs as a dry run', async () => {
    const f = fake('Would remove tmp/\n')
    expect((await runPreview({ kind: 'git-clean', args: ['-fdx'] }, f.run)).lines).toEqual(['Would remove tmp/'])
    expect(f.calls[0]).toEqual(['git', 'clean', '-n', '-fdx'])
  })
  test('git clean keeps the original flags: -ff (nested repositories) is previewed as given', async () => {
    const f = fake('Would remove sub/\n')
    expect((await runPreview({ kind: 'git-clean', args: ['-ffd'] }, f.run)).lines).toEqual(['Would remove sub/'])
    expect(f.calls[0]).toEqual(['git', 'clean', '-n', '-ffd'])
    const g = fake('')
    await runPreview({ kind: 'git-clean', args: ['--force', '--force', '-d', '--', 'src'] }, g.run)
    expect(g.calls[0]).toEqual(['git', 'clean', '-n', '--force', '--force', '-d', '--', 'src'])
    const h = fake('')
    await runPreview({ kind: 'git-clean', args: ['-fd', '-e', '*.env', '--exclude=tmp', 'src', '--', '-odd'] }, h.run)
    expect(h.calls[0]).toEqual(['git', 'clean', '-n', '-fd', '-e', '*.env', '--exclude=tmp', 'src', '--', '-odd'])
    for (const args of [['-de*.env'], ['-f', '-e', '--no-dry-run'], ['-f', '--exclude', '--no-dry-run'], ['-f', '--', '--no-dry-run']]) {
      const k = fake('')
      await runPreview({ kind: 'git-clean', args }, k.run)
      expect(k.calls[0]).toEqual(['git', 'clean', '-n', ...args])
    }
  })
  test('git clean with an option that could undo -n is never run', async () => {
    for (const args of [['-fd', '--no-dry-run'], ['-fd', '--no-dry'], ['-f', '-i'], ['-f', '--interactive'], ['-fdi'], ['-f', 'src', '--no-dry-run'], ['-f', '--end-of-options'], ['-f', '--no-force'], ['-f', '--dry'], ['-fd', '--exclude=x', '-i']]) {
      const f = fake('')
      expect((await runPreview({ kind: 'git-clean', args }, f.run)).lines).toEqual(['cannot preview: git clean has an option the preview does not know'])
      expect(f.calls).toEqual([])
    }
  })
  test('force push compares with the remote branch', async () => {
    const f = fake('a1b2c3d fix: retry\n')
    expect((await runPreview({ kind: 'force-push', remote: 'origin', branch: 'feat/x' }, f.run)).lines).toEqual(['the remote would lose 1 commit(s):', 'a1b2c3d fix: retry'])
    expect(f.calls[0]).toEqual(['git', 'log', '--oneline', '-n', '50', 'HEAD..origin/feat/x'])
    expect((await runPreview({ kind: 'force-push', remote: null, branch: null }, fake('').run)).lines).toEqual(['the remote has no commits that would be lost'])
    expect((await runPreview({ kind: 'force-push', remote: 'origin', branch: 'gone' }, fake('', 128).run)).lines).toEqual(['cannot preview: could not compare with origin/gone'])
  })
  test('discard lists tracked changes only', async () => {
    const f = fake(' M src/a.ts\n?? new.txt\n D old.ts\n')
    expect((await runPreview({ kind: 'discard', paths: [] }, f.run)).lines).toEqual(['changes that would be lost:', ' M src/a.ts', ' D old.ts'])
    expect(f.calls[0]).toEqual(['git', '--no-optional-locks', 'status', '--porcelain', '--', ':/'])
  })
  test('a runner that throws becomes a message', async () => {
    const run: Runner = async () => { throw new Error('timeout') }
    expect((await runPreview({ kind: 'discard', paths: ['.'] }, run)).lines).toEqual(['cannot preview: the preview command did not run'])
  })
})

describe('fix round 1: failures are reported, never read as an empty result', () => {
  test('rm rejects brace expansion', async () => {
    expect((await runPreview({ kind: 'rm', targets: ['{a,b}'] }, fake('').run)).lines).toEqual(['cannot preview: the paths use shell expansion'])
  })
  test('a failed git clean -n is not "nothing would be removed"', async () => {
    expect((await runPreview({ kind: 'git-clean', args: ['-fdx'] }, fake('', 1).run)).lines).toEqual(['cannot preview: git clean -n failed'])
  })
  test('a failed git status is not "no uncommitted changes"', async () => {
    expect((await runPreview({ kind: 'discard', paths: [] }, fake('', 128).run)).lines).toEqual(['cannot preview: git status failed'])
  })
  test('a failed find with no output is reported; with output, the output is shown', async () => {
    expect((await runPreview({ kind: 'find', args: ['.', '-name', '*.log'] }, fake('', 1).run)).lines).toEqual(['cannot preview: find failed'])
    expect((await runPreview({ kind: 'find', args: ['.', '-name', '*.log'] }, fake('./a.log\n', 1).run)).lines).toEqual(['1 file(s) would be deleted:', './a.log'])
  })
})

describe('nothingLost', () => {
  const nl = async (spec: Parameters<typeof runPreview>[0], stdout = '', exitCode = 0) => (await runPreview(spec, fake(stdout, exitCode).run)).nothingLost
  test('true only for the "nothing" results', async () => {
    expect(await nl({ kind: 'rm', targets: [] })).toBe(true)
    expect(await nl({ kind: 'rm', targets: ['x'] })).toBe(true)
    expect(await nl({ kind: 'find', args: ['.'] })).toBe(true)
    expect(await nl({ kind: 'git-clean', args: ['-fd'] })).toBe(true)
    expect(await nl({ kind: 'force-push', remote: 'origin', branch: 'x' })).toBe(false) // the remote ref may be stale
    expect(await nl({ kind: 'discard', paths: [] })).toBe(true)
  })
  test('false for non-empty and for "cannot preview"', async () => {
    expect(await nl({ kind: 'rm', targets: ['x'] }, 'x/a\n')).toBe(false)
    expect(await nl({ kind: 'rm', targets: ['$X'] })).toBe(false)
    expect(await nl({ kind: 'find', args: ['.'] }, '', 1)).toBe(false)
    expect(await nl({ kind: 'git-clean', args: ['-fd'] }, 'Would remove a\n')).toBe(false)
    expect(await nl({ kind: 'git-clean', args: ['-fd'] }, '', 1)).toBe(false)
    expect(await nl({ kind: 'force-push', remote: 'origin', branch: 'x' }, '', 128)).toBe(false)
    expect(await nl({ kind: 'discard', paths: [] }, ' M a\n')).toBe(false)
  })
  test('an unreadable rm target (non-zero exit, no output) is not "nothing lost"', async () => {
    const r = await runPreview({ kind: 'rm', targets: ['/var/root/x'] }, fake('', 1).run)
    expect(r).toEqual({ lines: ['cannot preview: some paths could not be read'], nothingLost: false })
    expect((await runPreview({ kind: 'rm', targets: ['x'] }, fake('x/a\n', 1).run)).nothingLost).toBe(false)
  })
  test('a failing rm loop (exit 1, e.g. a path in an unreadable directory) never reads as nothing lost', async () => {
    for (const targets of [['locked/sub'], ['locked/*'], ['locked'], ['/var/root/Library']]) {
      expect(await runPreview({ kind: 'rm', targets }, fake('', 1).run)).toEqual({ lines: ['cannot preview: some paths could not be read'], nothingLost: false })
    }
    expect((await runPreview({ kind: 'rm', targets: ['readable/nothing'] }, fake('', 0).run)).nothingLost).toBe(true)
  })
  test('a runner that throws is not "nothing lost"', async () => {
    const run: Runner = async () => { throw new Error('timeout') }
    expect((await runPreview({ kind: 'discard', paths: [] }, run)).nothingLost).toBe(false)
  })
})
