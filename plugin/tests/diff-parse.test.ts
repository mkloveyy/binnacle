import { describe, expect, test } from 'claude-code/testing'
import { GIT_DIFF, GIT_STATUS, capHunks, fileLabel, keepPatches, parseGitDiff, patchOf, relPath, untracked, visible, wholeHunk, workspaceDiff } from '../hooks/modules/diff/parse.ts'
import { editedTurns, turnFiles } from '../hooks/modules/diff/turns.ts'
import { append, newSession } from '../hooks/modules/activity/events.ts'

const EDIT = {
  filePath: '/repo/alpha.txt', oldString: 'alpha 10', newString: 'alpha TEN', originalFile: 'x', userModified: false, replaceAll: false,
  structuredPatch: [{ oldStart: 7, oldLines: 3, newStart: 7, newLines: 3, lines: [' alpha 9', '-alpha 10', '+alpha TEN', ' alpha 11'] }],
}

describe('patches from tool results', () => {
  test('Edit: one hunk per structuredPatch entry, with real line numbers', () => {
    expect(patchOf('Edit', EDIT)).toEqual({ file: '/repo/alpha.txt', hunks: ['@@ -7,3 +7,3 @@\n alpha 9\n-alpha 10\n+alpha TEN\n alpha 11'], added: 1, removed: 1 })
  })
  test('Write that creates a file: all of its content is added', () => {
    const r = { type: 'create', filePath: '/repo/d.txt', content: 'd1\nd2\n', structuredPatch: [], originalFile: null }
    expect(patchOf('Write', r)).toEqual({ file: '/repo/d.txt', hunks: ['@@ -0,0 +1,2 @@\n+d1\n+d2'], added: 2, removed: 0 })
  })
  test('NotebookEdit: a cell-relative hunk whose counts match its lines', () => {
    const r = { notebook_path: '/repo/n.ipynb', new_source: 'print(2)', old_source: 'print(1)', cell_type: 'code', language: 'python', edit_mode: 'replace', original_file: '', updated_file: '' }
    expect(patchOf('NotebookEdit', r)?.hunks).toEqual(['@@ -1,1 +1,1 @@\n-print(1)\n+print(2)'])
  })
  test('staged edits and other tools carry no patch', () => {
    expect(patchOf('Edit', { ...EDIT, staged: true })).toBeNull()
    expect(patchOf('Bash', { stdout: '' })).toBeNull()
    expect(patchOf('Edit', 'oops')).toBeNull()
  })
  test('wholeHunk counts match the body, including empty sides', () => {
    expect(wholeHunk(['a'], [])).toBe('@@ -1,1 +0,0 @@\n-a')
  })
})

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old',
  '+new',
  '@@ -10,1 +10,2 @@',
  ' ten',
  '+eleven',
  'diff --git a/new file.txt b/new file.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new file.txt',
  '@@ -0,0 +1 @@',
  '+hi',
  'diff --git a/img.png b/img.png',
  'index 1..2 100644',
  'Binary files a/img.png and b/img.png differ',
  'diff --git a/old.ts b/gone.ts',
  'similarity index 90%',
  'rename from old.ts',
  'rename to gone.ts',
  '',
].join('\n')

describe('git diff', () => {
  test('files, statuses, line counts and hunks', () => {
    const files = parseGitDiff(DIFF)
    expect(files.map(f => [f.path, f.status, f.added, f.removed, f.hunks.length, f.binary])).toEqual([
      ['src/a.ts', 'M', 2, 1, 2, false],
      ['new file.txt', 'A', 1, 0, 1, false],
      ['img.png', 'M', 0, 0, 0, true],
      ['gone.ts', 'R', 0, 0, 0, false],
    ])
    expect(files[0]?.hunks[0]).toBe('@@ -1,2 +1,2 @@\n keep\n-old\n+new')
  })
  test('the trailing newline of the output is not part of the last hunk', () => {
    expect(parseGitDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n')[0]?.hunks).toEqual(['@@ -1,1 +1,1 @@\n-a\n+b'])
  })
  test('git runs with fixed arguments and unquoted paths, so non-ASCII names read as they are', () => {
    expect(GIT_DIFF).toEqual([
      'git', '--no-optional-locks', '-c', 'core.quotepath=false', 'diff-index', '-p', '-M',
      '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD',
    ])
    expect(GIT_STATUS).toEqual(['git', '--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain'])
    const files = parseGitDiff('diff --git a/文档/说明.md b/文档/说明.md\nindex 1..2 100644\n--- a/文档/说明.md\n+++ b/文档/说明.md\n@@ -1,1 +1,1 @@\n-旧\n+新\n')
    expect(files.map(f => [f.path, f.status, f.added, f.removed])).toEqual([['文档/说明.md', 'M', 1, 1]])
    expect(untracked(' M 文档/说明.md\n?? 笔记.md\n').map(f => f.path)).toEqual(['笔记.md'])
  })
  test('an empty line inside a hunk is a blank context line (diff.suppressBlankEmpty)', () => {
    const files = parseGitDiff('diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n')
    expect(files[0]?.hunks).toEqual(['@@ -1,3 +1,3 @@\n a\n \n-b\n+B'])
    expect([files[0]?.added, files[0]?.removed]).toEqual([1, 1])
  })
  test('a path holding " b/" is read from the two equal halves of the header', () => {
    expect(parseGitDiff('diff --git a/Plan b/c.txt b/Plan b/c.txt\n--- a/Plan b/c.txt\n+++ b/Plan b/c.txt\n@@ -1 +1 @@\n-x\n+y\n')[0]?.path).toBe('Plan b/c.txt')
  })
  test('a cut output drops its last, incomplete hunk and that hunk\'s line counts', () => {
    const cut = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,3 +9,3 @@\n x\n-y\n+z'
    const w = workspaceDiff({ exitCode: 0, stdout: cut, stderr: '', isStdoutTruncated: true }, null)
    expect(w.kind === 'ok' && w.files.map(f => [f.hunks, f.added, f.removed])).toEqual([[['@@ -1,1 +1,1 @@\n-a\n+b'], 1, 1]])
    const whole = workspaceDiff({ exitCode: 0, stdout: cut.replace('+z', '+z\n y\n'), stderr: '', isStdoutTruncated: true }, null)
    expect(whole.kind === 'ok' && whole.files[0]?.hunks.length).toBe(2)
  })
  test('untracked files come from git status', () => {
    expect(untracked(' M src/a.ts\n?? notes.md\n?? "with space.md"\n').map(f => f.path)).toEqual(['notes.md', 'with space.md'])
  })
  test('outside a repository, before the first commit, and on other failures', () => {
    const proc = (exitCode: number, stdout: string, stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false })
    expect(workspaceDiff(proc(128, '', 'fatal: not a git repository (or any of the parent directories): .git'), null)).toEqual({ kind: 'not-repo' })
    const fresh = workspaceDiff(proc(128, '', "fatal: ambiguous argument 'HEAD': unknown revision"), proc(0, '?? a.txt\n'))
    expect(fresh).toEqual({ kind: 'ok', files: [expect.objectContaining({ path: 'a.txt', status: '?' })], note: 'no commits yet: only untracked files are listed' })
    expect(workspaceDiff(proc(1, '', 'fatal: bad config'), null)).toEqual({ kind: 'error', message: 'git diff failed: fatal: bad config' })
    const big = workspaceDiff({ ...proc(0, DIFF), isStdoutTruncated: true }, proc(0, ''))
    expect(big.kind === 'ok' && big.note).toContain('over 4 MiB')
  })
})

describe('drawing limits and labels', () => {
  test('capHunks keeps whole hunks under the limit and counts the rest', () => {
    const h = ['@@ -1,1 +1,1 @@\n-' + 'a'.repeat(30), '@@ -5,1 +5,1 @@\n-' + 'b'.repeat(30), '@@ -9,1 +9,1 @@\n-' + 'c'.repeat(30)]
    const r = capHunks(h, 100)
    expect(r.omitted).toBe(1)
    expect(r.source).toBe(`${h[0]}\n${h[1]}`)
    expect(capHunks(['x'.repeat(200)], 100)).toEqual({ source: '', omitted: 1 })
  })
  test('the size cap is measured on the drawn text, after control characters become stand-ins', () => {
    const dense = '@@ -1,1 +1,1 @@\n-' + '\x1b'.repeat(60_000)
    expect(capHunks([dense], 100_000)).toEqual({ source: '', omitted: 1 })
    const r = capHunks(['@@ -1,1 +1,1 @@\n-a\fb\r\n+c\x1bd\te', dense], 100_000)
    expect(r).toEqual({ source: '@@ -1,1 +1,1 @@\n-a^Lb^M\n+c^[d\te', omitted: 1 })
    expect(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(r.source)).toBe(false)
  })
  test('control characters other than tab and newline are drawn as visible stand-ins, line by line', () => {
    expect(visible('-a\fb\n+\x1b[31mred\tx\n+cr\r\n del\x7f c1\x85')).toBe('-a^Lb\n+^[[31mred\tx\n+cr^M\n del^? c1\uFFFD')
    expect(visible('plain\ttext\n')).toBe('plain\ttext\n')
  })
  test('labels and relative paths', () => {
    expect(fileLabel({ path: 'src/a.ts', status: 'M', added: 12, removed: 3, hunks: [], binary: false })).toBe('M src/a.ts +12 −3')
    expect(fileLabel({ path: 'notes.md', status: '?', added: 0, removed: 0, hunks: [], binary: false })).toBe('? notes.md')
    expect(relPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relPath('/elsewhere/a.ts', '/repo')).toBe('/elsewhere/a.ts')
  })
  test('patch bodies drop the oldest past the limit', () => {
    const one = keepPatches([], { turnId: 't1', file: 'a', source: 'aaaaaa' }, 10)
    const two = keepPatches(one, { turnId: 't2', file: 'b', source: 'bbbbbb' }, 10)
    expect(two.map(p => p.file)).toEqual(['b'])
  })
})

describe('changes per turn', () => {
  test('edited turns newest first; files summed per turn with their kept patches', () => {
    let s = newSession('s1', 0, '/repo')
    s = append(s, { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'one' })
    s = append(s, { at: 2, turnId: 't1', agentId: null, kind: 'edit', tool: 'Edit', file: '/repo/a.ts', added: 1, removed: 1 })
    s = append(s, { at: 3, turnId: 't1', agentId: 'x', kind: 'edit', tool: 'Edit', file: '/repo/a.ts', added: 2, removed: 0 })
    s = append(s, { at: 4, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'two' })
    s = append(s, { at: 5, turnId: 't2', agentId: null, kind: 'edit', tool: 'Write', file: '/repo/b.ts', added: 3, removed: 0 })
    expect(editedTurns(s)).toEqual([{ turnId: 't2', n: 2 }, { turnId: 't1', n: 1 }])
    const files = turnFiles(s, 't1', [{ turnId: 't1', file: '/repo/a.ts', source: '@@ -1,1 +1,1 @@\n-a\n+b' }])
    expect(files).toEqual([{ path: 'a.ts', status: 'M', added: 3, removed: 1, hunks: ['@@ -1,1 +1,1 @@\n-a\n+b'], binary: false }])
    expect(turnFiles(s, 't2', [])[0]?.hunks).toEqual([])
    const other = { turnId: 't2', file: '/repo/a.ts', source: '@@ -9,1 +9,1 @@\n-x\n+y' }
    expect(turnFiles(s, 't1', [other])[0]?.hunks).toEqual([])
  })
})
