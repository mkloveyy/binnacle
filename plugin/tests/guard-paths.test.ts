import { describe, expect, test } from 'claude-code/testing'
import { inGitDir, outsideProject } from '../hooks/modules/guard/paths.ts'

const ctx = { cwd: '/repo', home: '/home/u' }
const out = (t: string, allowRoot = false, c = ctx) => outsideProject(t, c, allowRoot)

describe('outsideProject', () => {
  test('1. no cwd, or a cwd with no safe zone, is always risky', () => {
    expect(out('dist', false, { cwd: null, home: '/home/u' })).toBe(true)
    expect(out('dist', true, { cwd: '/', home: null })).toBe(true)
    expect(out('dist', true, { cwd: '/home/u', home: '/home/u' })).toBe(true)
    expect(out('dist', true, { cwd: '/home/u/', home: '/home/u' })).toBe(true)
    expect(out('dist', false, { cwd: '/repo/', home: '/home/u' })).toBe(false)
    expect(out('dist', false, { cwd: '/repo', home: null })).toBe(false)
  })
  test('2. unknown expansion is risky', () => {
    expect(out('$DIR')).toBe(true)
    expect(out('dist/$X')).toBe(true)
    expect(out('`pwd`')).toBe(true)
  })
  test('3. paths resolve lexically', () => {
    expect(out('dist')).toBe(false)
    expect(out('./build/out')).toBe(false)
    expect(out('/repo/out')).toBe(false)
    expect(out('/repo2/out')).toBe(true)
    expect(out('/tmp/x')).toBe(true)
    expect(out('../other')).toBe(true)
    expect(out('dist/../../other')).toBe(true)
    expect(out('a/./b/../c')).toBe(false)
    expect(out('/../tmp')).toBe(true)
    expect(out('~/x')).toBe(true)
    expect(out('~')).toBe(true)
    expect(out('~root/x')).toBe(true)
    expect(out('~/x', false, { cwd: '/repo', home: null })).toBe(true)
    expect(out('~/proj/x', false, { cwd: '/home/u/proj', home: '/home/u' })).toBe(false)
    expect(out('~/proj', true, { cwd: '/home/u/proj', home: '/home/u' })).toBe(false)
  })
  test('4. globs cut at the first wildcard segment', () => {
    expect(out('dist/*')).toBe(false)
    expect(out('./build/*')).toBe(false)
    expect(out('*', false)).toBe(true)
    expect(out('*', true)).toBe(false)
    expect(out('src/a?/b')).toBe(false)
    expect(out('/tmp/*')).toBe(true)
    expect(out('/*')).toBe(true)
    expect(out('[ab]*/x')).toBe(true)
  })
  test('review: .. after a wildcard, and cwd above HOME', () => {
    expect(out('dist/*/../../../etc')).toBe(true)
    expect(out('dist/*/x')).toBe(false)
    expect(out('dist', false, { cwd: '/home', home: '/home/u' })).toBe(true)
    expect(out('dist', false, { cwd: '/home/', home: '/home/u' })).toBe(true)
    expect(out('dist', false, { cwd: '/home/u/p', home: '/home/u' })).toBe(false)
  })
  test('5. the project root itself depends on allowRoot', () => {
    expect(out('.', false)).toBe(true)
    expect(out('.', true)).toBe(false)
    expect(out('/repo', false)).toBe(true)
    expect(out('/repo/', true)).toBe(false)
    expect(out('dist/..', false)).toBe(true)
  })
})

describe('inGitDir', () => {
  const git = (t: string) => inGitDir(t, ctx)
  test('a .git segment, after resolution, anywhere in the path', () => {
    for (const t of ['.git', './.git/objects', 'sub/.git', 'src/../.git', '/repo/.git/', 'sub/*/.git', 'sub/.g*', '.git*', '/other/.git']) expect(`${t}:${git(t)}`).toBe(`${t}:true`)
  })
  test('other paths are not', () => {
    for (const t of ['.github', '.gitignore', '.git/../dist', 'dist/*', 'sub/*', '~user/.git']) expect(`${t}:${git(t)}`).toBe(`${t}:false`)
  })
})
