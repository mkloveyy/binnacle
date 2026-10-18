import { describe, expect, test } from 'claude-code/testing'
import { ASSIGNMENTS, base, commands, segments, stripPrefixes, words } from '../hooks/core/shell.ts'

const heads = (line: string) => commands(line).map(c => c.words.slice(0, 2).join(' '))

describe('segments and words', () => {
  test('separators', () => {
    expect(segments('a && b || c; d | e & f\ng').map(s => s.text)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(segments('a 2>&1 | b >&2').map(s => s.text)).toEqual(['a 2>&1', 'b >&2'])
  })
  test('positions point into the original line', () => {
    const line = 'x;  y z  '
    const s = segments(line)
    expect(s.map(x => line.slice(x.start, x.end))).toEqual(['x', 'y z'])
  })
  test('quotes keep separators literal', () => {
    expect(segments(`echo "a && b" 'c; d'`).map(s => s.text)).toEqual([`echo "a && b" 'c; d'`])
    expect(words(`echo "a b" 'c d' e\\ f`)).toEqual(['echo', 'a b', 'c d', 'e f'])
  })
  test('comments and heredoc bodies are not commands', () => {
    expect(heads('ls # rm -rf /')).toEqual(['ls'])
    const firsts = (line: string) => commands(line).map(c => c.words[0])
    expect(firsts("cat <<'EOF' > notes.md\nrm -rf /\nEOF\necho done")).toEqual(['cat', 'echo'])
    expect(firsts('cat <<-END\n\trm -rf x\n\tEND\npwd')).toEqual(['cat', 'pwd'])
  })
  test('subshells and command substitution are split out', () => {
    expect(heads('(cd x && rm -rf y)')).toEqual(['cd x', 'rm -rf'])
    expect(heads('echo $(rm -rf y)')).toEqual(['echo $', 'rm -rf'])
    expect(heads('echo `rm -rf y`')).toEqual(['echo', 'rm -rf'])
  })
})

describe('prefixes', () => {
  test('wrappers, env assignments and their flags', () => {
    expect(stripPrefixes(['sudo', '-u', 'root', 'rm', '-rf', 'x'])).toEqual(['rm', '-rf', 'x'])
    expect(stripPrefixes(['FOO=1', 'env', 'BAR=2', 'kubectl', 'get'])).toEqual(['kubectl', 'get'])
    expect(stripPrefixes(['timeout', '-s', 'KILL', '30', 'git', 'push'])).toEqual(['git', 'push'])
    expect(stripPrefixes(['xargs', '-0', '-n', '1', 'rm', '-r'])).toEqual(['rm', '-r'])
    expect(stripPrefixes(['nohup', 'nice', '-n', '5', 'make'])).toEqual(['make'])
    expect(stripPrefixes(['command', 'exec', 'ls'])).toEqual(['ls'])
    expect(stripPrefixes(['sudo', '-iu', 'root', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['doas', '-u', 'root', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['env', '-iC', '/x', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['env', '-C/x', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['runuser', '-u', 'root', '--', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['pkexec', '--user', 'root', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['xargs', '--replace', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['xargs', '--max-args', '1', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['xargs', '-0n', '1', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['xargs', '-n1', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['xargs', '-i', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['time', '-o', 'out', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['/usr/bin/time', '-f', '%e', '-a', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['sudo', '-R', '/x', 'rm'])).toEqual(['rm'])
    expect(stripPrefixes(['sudo', '--chroot', '/x', 'rm'])).toEqual(['rm'])
  })
  test('base strips directories', () => {
    expect(base('/usr/local/bin/kubectl')).toBe('kubectl')
    expect(base('rm')).toBe('rm')
  })
})

describe('nested scripts', () => {
  test('bash -c, sh -lc, zsh -c and eval are expanded', () => {
    expect(heads(`bash -c 'kubectl get pods -A'`)).toEqual(['bash -c', 'kubectl get'])
    expect(heads(`sh -lc "git push --force"`)).toEqual(['sh -lc', 'git push'])
    expect(heads(`zsh -c 'cd /tmp; rm -rf x'`)).toEqual(['zsh -c', 'cd /tmp', 'rm -rf'])
    expect(heads(`eval "rm -rf x"`)).toEqual(['eval rm -rf x', 'rm -rf'])
  })
  test('text that only mentions commands is not a command', () => {
    expect(heads('git commit -m "fix: rm -rf no longer runs"')).toEqual(['git commit'])
    expect(heads(`echo 'kubectl get pods -A'`)).toEqual(['echo kubectl get pods -A'])
    expect(heads('grep -n "rm -rf" notes.txt')).toEqual(['grep -n'])
  })
  test('an assignment-only segment is kept under a marker head, and its substitutions are read', () => {
    const cs = commands('GIT_DIR=/o/.git; x="$(rm -rf y)"')
    expect(cs.map(c => c.words)).toEqual([[ASSIGNMENTS, 'GIT_DIR=/o/.git'], [ASSIGNMENTS, 'x=$(rm -rf y)'], ['rm', '-rf', 'y']])
    expect(cs[0].assigns).toEqual(['GIT_DIR=/o/.git'])
  })
  test('empty and whitespace', () => {
    expect(commands('')).toEqual([])
    expect(commands('   \n  ')).toEqual([])
  })
})

const texts = (line: string) => commands(line).map(c => c.words.join(' '))

describe('fix round 1: lexer gaps', () => {
  test('arithmetic << is not a heredoc', () => {
    expect(texts('echo $((1<<2))\nrm -rf x')).toContain('rm -rf x')
    expect(texts('x=$((1<<2)); rm -rf x\nrm -rf y')).toContain('rm -rf x')
    expect(texts('x=$((1<<2)); rm -rf x\nrm -rf y')).toContain('rm -rf y')
  })
  test('unterminated heredoc fails open', () => {
    expect(texts('cat <<EOF\nrm -rf x')).toContain('rm -rf x')
  })
  test('shell keywords do not hide the command head', () => {
    expect(texts('if true; then rm -rf x; fi')).toContain('rm -rf x')
    expect(texts('for f in a; do rm -rf x; done')).toContain('rm -rf x')
    expect(texts('{ rm -rf x; }')).toContain('rm -rf x')
    expect(texts('! rm -rf x')).toContain('rm -rf x')
  })
  test('command substitution inside double quotes is split out', () => {
    expect(texts('echo "$(rm -rf y)"')).toEqual(['echo $(rm -rf y)', 'rm -rf y'])
    expect(texts('echo "`rm -rf y`"')).toEqual(['echo `rm -rf y`', 'rm -rf y'])
  })
  test('wrapper flags are skipped', () => {
    const heads = (line: string) => commands(line).map(c => c.words[0])
    expect(heads('time -p rm -rf x')).toEqual(['rm'])
    expect(heads('command -p rm x')).toEqual(['rm'])
    expect(heads('exec -a foo rm x')).toEqual(['rm'])
    expect(heads('builtin echo')).toEqual(['echo'])
  })
  test('bash -c accepts combined and extra flags', () => {
    expect(texts('bash -ce "rm -rf x"')).toContain('rm -rf x')
    expect(texts('bash -c -x "rm -rf x"')).toContain('rm -rf x')
    expect(texts('zsh -ce "rm -rf x"')).toContain('rm -rf x')
    expect(texts('sh -xc "rm -rf x"')).toContain('rm -rf x')
  })
  test('ANSI-C quotes keep backslash escapes', () => {
    expect(words("echo $'a\\'b'")).toEqual(['echo', "a'b"])
    expect(texts("echo $'a\\'b'; rm -rf x")).toContain('rm -rf x')
  })
})
