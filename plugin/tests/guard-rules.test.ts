import { describe, expect, test } from 'claude-code/testing'
import { evaluate } from '../hooks/modules/guard/engine.ts'
import { BUILTIN_RULES } from '../hooks/modules/guard/rules/index.ts'

const all = () => true
const ctx = { cwd: '/repo', home: '/home/u' }
const bash = (command: string, c = ctx) => evaluate(BUILTIN_RULES, all, 'Bash', { command }, c)
const hit = (command: string, c = ctx) => {
  const r = bash(command, c)
  return r ? `${r.rule.id}:${r.verdict.kind}` : 'pass'
}

describe('files', () => {
  test('recursive deletes ask', () => {
    expect(hit('rm -rf /opt/build')).toBe('files.rm-recursive:ask')
    expect(hit('sudo rm -R /tmp/x')).toBe('files.rm-recursive:ask')
    expect(hit('rm --recursive /tmp/dist')).toBe('files.rm-recursive:ask')
    expect(hit('find / -name x -delete')).toBe('files.find-delete:ask')
    expect(hit('git clean -fd')).toBe('files.git-clean:ask')
    expect(hit('git -C repo clean -fdx')).toBe('files.git-clean:ask')
  })
  test('non-recursive or dry runs pass', () => {
    expect(hit('rm file.txt')).toBe('pass')
    expect(hit('rm -f file.txt')).toBe('pass')
    expect(hit('git clean -n')).toBe('pass')
    expect(hit('find . -name "*.log"')).toBe('pass')
  })
  test('previews carry the targets', () => {
    const r = bash('rm -rf build /tmp/dist')
    expect(r?.verdict.kind === 'ask' && r.verdict.preview).toEqual({ kind: 'rm', targets: ['build', '/tmp/dist'] })
  })
  test('deletes inside the project pass', () => {
    for (const c of ['rm -rf dist', 'rm -rf ./build/*', 'rm -rf /repo/out', 'rm -rf', 'rm -rf -- dist']) expect(hit(c)).toBe('pass')
    expect(hit("find . -name '*.pyc' -delete")).toBe('pass')
    expect(hit('find -L src -type f -delete')).toBe('pass')
  })
  test('deletes outside the project, or of the project itself, ask', () => {
    for (const c of ['rm -rf /tmp/x', 'rm -rf ~/x', 'rm -rf ../other', 'rm -rf .', 'rm -rf *', 'rm -rf $DIR', 'rm -rf dist /tmp/x']) expect(hit(c)).toBe('files.rm-recursive:ask')
    for (const c of ['find / -name x -delete', 'find ~ -delete', 'find .. -delete', 'find src /tmp -delete']) expect(hit(c)).toBe('files.find-delete:ask')
  })
  test('unknown locations (cd, xargs, git -C) always ask and are never previewed', () => {
    const prev = (c: string) => { const r = bash(c); return r?.verdict.kind === 'ask' ? r.verdict.preview : 'n/a' }
    expect(hit('cd ~ && rm -rf Documents')).toBe('files.rm-recursive:ask')
    expect(prev('cd ~ && rm -rf Documents')).toBeNull()
    expect(hit('pushd /tmp; rm -rf dist')).toBe('files.rm-recursive:ask')
    expect(hit('rm -rf dist && cd /tmp')).toBe('pass')
    expect(hit('cd /tmp && find . -name x -delete')).toBe('files.find-delete:ask')
    expect(prev('cd /tmp && find . -delete')).toBeNull()
    expect(hit('ls | xargs rm -rf')).toBe('files.rm-recursive:ask')
    expect(prev('ls | xargs rm -rf')).toBeNull()
    expect(hit('find . -name x | xargs rm -rf')).toBe('files.rm-recursive:ask')
    expect(hit('find . -name x -print0 | xargs -0 find -delete')).toBe('files.find-delete:ask')
    expect(hit('git -C other clean -fdx')).toBe('files.git-clean:ask')
    expect(prev('git -C other clean -fdx')).toBeNull()
    expect(prev('git --git-dir=/x/.git reset --hard')).toBeNull()
    expect(prev('git --work-tree /x reset --hard')).toBeNull()
    expect(prev('cd /x && git reset --hard')).toBeNull()
    expect(prev('cd /x && git clean -fd')).toBeNull()
    expect(prev('git clean -fd $OPT')).toBeNull()
    expect(prev('git clean -fd "`opts`"')).toBeNull()
    expect(prev('cd /x && git push -f origin main')).toBeNull()
    expect(prev('git -C /x push -f origin main')).toBeNull()
    expect(prev('git reset --hard')).toEqual({ kind: 'discard', paths: [] })
  })
  test('sudo / doas, env -C and sudo -D make the location unknown', () => {
    const prev = (c: string) => { const r = bash(c); return r?.verdict.kind === 'ask' ? r.verdict.preview : 'n/a' }
    expect(hit('sudo rm -rf dist')).toBe('files.rm-recursive:ask')
    expect(prev('sudo rm -rf dist')).toBeNull()
    expect(hit('doas rm -rf dist')).toBe('files.rm-recursive:ask')
    expect(prev('sudo find . -name x -delete')).toBeNull()
    expect(hit('sudo -u root rm -rf dist')).toBe('files.rm-recursive:ask')
    expect(hit('env -C ~ rm -rf Documents')).toBe('files.rm-recursive:ask')
    expect(prev('env -C ~ rm -rf Documents')).toBeNull()
    expect(hit('env --chdir ~ rm -rf Documents')).toBe('files.rm-recursive:ask')
    expect(hit('env --chdir=/x rm -rf Documents')).toBe('files.rm-recursive:ask')
    expect(hit('sudo -D /x rm -rf Documents')).toBe('files.rm-recursive:ask')
    expect(hit('sudo --chdir /x rm -rf Documents')).toBe('files.rm-recursive:ask')
    expect(prev('sudo git reset --hard')).toBeNull()
    expect(prev('env -C /x git clean -fd')).toBeNull()
    expect(hit('env FOO=1 rm -rf dist')).toBe('files.rm-recursive:ask')
  })
  test('GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE relocate git without a preview', () => {
    const prev = (c: string) => { const r = bash(c); return r?.verdict.kind === 'ask' ? r.verdict.preview : 'n/a' }
    expect(prev('GIT_DIR=/o/.git GIT_WORK_TREE=/o git reset --hard')).toBeNull()
    expect(prev('GIT_DIR=/o/.git git clean -fdx')).toBeNull()
    expect(prev('env GIT_WORK_TREE=/o git reset --hard')).toBeNull()
    expect(prev('GIT_INDEX_FILE=/o/i git push -f origin main')).toBeNull()
    expect(prev('FOO=1 git reset --hard')).toEqual({ kind: 'discard', paths: [] })
  })
  test('find -exec rm -r is a delete scoped by the start paths', () => {
    expect(hit('find / -name x -exec rm -rf {} +')).toBe('files.find-delete:ask')
    expect(hit('find ~ -execdir rm -r {} ;')).toBe('files.find-delete:ask')
    expect(hit("find . -name '*.pyc' -exec rm -rf {} +")).toBe('pass')
    expect(hit('find / -name x -exec rm {} +')).toBe('pass')
    expect(hit('find / -exec ls -R {} +')).toBe('pass')
  })
  test('force push: wildcard destinations, --mirror / --all, value options', () => {
    expect(hit("git push -f origin 'refs/heads/*:refs/heads/*'")).toBe('git.force-push:ask')
    expect(hit('git push -f --mirror origin')).toBe('git.force-push:ask')
    expect(hit('git push -f --all origin')).toBe('git.force-push:ask')
    expect(hit('git push --mirror origin')).toBe('pass')
    expect(hit('git push -f -o ci.skip origin')).toBe('git.force-push:ask')
    expect(hit('git push -f --push-option ci.skip origin feat/x')).toBe('pass')
    expect(hit('git push -f -o x origin feat/x')).toBe('pass')
  })
  test('xargs long options with separate values are skipped', () => {
    expect(hit('ls | xargs --max-args 1 rm -rf')).toBe('files.rm-recursive:ask')
    expect(hit('ls | xargs --max-procs 4 --delimiter , rm -rf')).toBe('files.rm-recursive:ask')
    expect(hit('ls | xargs -n 1 rm -rf')).toBe('files.rm-recursive:ask')
  })
  describe('round 3: allowlist for a known location', () => {
    const prev = (c: string) => { const r = bash(c); return r?.verdict.kind === 'ask' ? r.verdict.preview : 'n/a' }
    const asksBlind = (c: string) => { expect(`${c} => ${hit(c)}`).toMatch(/:ask$/); expect(prev(c)).toBeNull() }
    test('wrappers, nested shells and state changes ask without a preview', () => {
      for (const c of [
        'doas -u root rm -rf /etc', 'doas -n rm -rf dist', 'sudo -iu root rm -rf /etc', 'sudo -uroot rm -rf dist',
        "sudo sh -c 'rm -rf dist'", "sudo bash -c 'rm -rf ~/x'",
        "env -C ~ bash -c 'rm -rf Documents'", "sudo -D / sh -c 'rm -rf etc'", 'env -C/x rm -rf foo', 'env -iC /x rm -rf foo', 'env --chdir=/x rm -rf foo',
        "GIT_DIR=/o/.git bash -c 'git reset --hard'", 'export GIT_DIR=/o/.git; git reset --hard',
        'HOME=/o rm -rf dist',
        "su -c 'rm -rf dist'", "su root -c 'rm -rf dist'", "su --command='rm -rf dist'", 'pkexec --user root rm -rf dist', 'runuser -u root -- rm -rf dist',
        "eval 'rm -rf dist'", 'source ./env.sh; rm -rf dist', 'set -e; rm -rf dist', 'exec rm -rf dist',
        'ls | xargs --replace rm -rf {}', 'ls | xargs --eof rm -rf', 'ls | xargs --max-lines rm -rf', 'ls | xargs -I {} rm -rf {}', 'ls | xargs -L 1 rm -rf',
      ]) asksBlind(c)
      // kubectl delete is refused outright, wrapped or with another cluster's config.
      for (const c of ['sudo kubectl delete pod x -n ns', 'KUBECONFIG=/o/kc kubectl delete pod x -n ns']) expect(hit(c)).toBe('k8s.delete:deny')
    })
    test('plain top-level commands keep scoping and previews', () => {
      expect(hit('rm -rf dist')).toBe('pass')
      expect(hit('timeout 10 rm -rf dist')).toBe('pass')
      expect(hit('nice -n 5 rm -rf dist')).toBe('pass')
      expect(hit('FOO=1 rm -rf dist')).toBe('pass')
      expect(hit("find . -name '*.tmp' -delete")).toBe('pass')
      expect(hit('find src -exec rm -rf {} +')).toBe('pass')
      expect(hit('git push -f origin feat/x')).toBe('pass')
      expect(prev('FOO=1 git reset --hard')).toEqual({ kind: 'discard', paths: [] })
      expect(prev('rm -rf /tmp/a[1]')).toEqual({ kind: 'rm', targets: ['/tmp/a[1]'] })
    })
  })
  describe('final review', () => {
    const prev = (c: string) => { const r = bash(c); return r?.verdict.kind === 'ask' ? r.verdict.preview : 'n/a' }
    const asksBlind = (c: string) => { expect(`${c} => ${hit(c)}`).toMatch(/:ask$/); expect(prev(c)).toBeNull() }
    test('declare / typeset / local / readonly / alias / shopt and assignment-only segments change the location', () => {
      for (const c of [
        'declare -x GIT_DIR=/o/.git; git reset --hard',
        'local GIT_WORK_TREE=/o; git clean -fd', 'readonly HOME=/; rm -rf ~/x', "alias rm='rm -i'; rm -rf /tmp/x",
        'shopt -s expand_aliases; rm -rf /tmp/x',
        'GIT_DIR=/o/.git; git reset --hard', 'HOME=/o; rm -rf ~/x',
        'PWD=/o; rm -rf /tmp/x', 'A=1 GIT_WORK_TREE=/o; git reset --hard',
        'git -c core.worktree=/o reset --hard', 'git -c core.bare=true clean -fd', 'git -c Core.WorkTree=/o push -f origin main',
      ]) asksBlind(c)
      expect(prev('FOO=1; git reset --hard')).toEqual({ kind: 'discard', paths: [] })
      for (const c of ['typeset -x KUBECONFIG=/o/kc; kubectl delete pod x -n ns', 'KUBECONFIG=/o/kc; kubectl delete pods -l app=api -n prod']) expect(hit(c)).toBe('k8s.delete:deny')
      expect(prev('git -c user.name=x reset --hard')).toEqual({ kind: 'discard', paths: [] })
    })
    test('a command substitution in an assignment-only segment is still checked', () => {
      expect(hit('x="$(rm -rf ~/x)"')).toBe('files.rm-recursive:ask')
    })
    test('find at the project root needs a name or path filter', () => {
      for (const c of ['find . -delete', 'find . -mindepth 1 -delete', 'find * -delete', 'find . -exec rm -rf {} +', 'find -delete', 'find ./ -type f -delete']) expect(hit(c)).toBe('files.find-delete:ask')
      for (const c of ["find . -name '*.pyc' -delete", "find . -iname '*.LOG' -delete", "find . -path './build/*' -delete", "find . -regex '.*~' -delete", "find . -name '*.o' -exec rm -rf {} +", 'find src -delete']) expect(hit(c)).toBe('pass')
    })
    test('.git is never a safe target, even inside the project', () => {
      for (const c of ['rm -rf .git', 'rm -rf ./.git/objects', 'rm -rf sub/.git', 'rm -rf src/../.git', 'rm -rf sub/*/.git']) expect(hit(c)).toBe('files.rm-recursive:ask')
      for (const c of ['find .git -delete', "find .git/objects -name '*.pack' -delete"]) expect(hit(c)).toBe('files.find-delete:ask')
      expect(hit('rm -rf .github')).toBe('pass')
      expect(hit('rm -rf .git/../dist')).toBe('pass')
    })
    test('a project-root find whose filter targets .git asks', () => {
      for (const c of ["find . -path './.git/*' -delete", 'find . -name .git -exec rm -rf {} +', "find . -path '*/.git/*' -delete", "find . -regex '.*\\.git.*' -delete", "find . -iname '.git*' -delete"]) expect(hit(c)).toBe('files.find-delete:ask')
      for (const c of ["find . -name '*.pyc' -delete", "find . -name '.github' -delete", "find src -path './.git/*' -delete"]) expect(hit(c)).toBe('pass')
    })
    test('xargs short clusters, time and sudo value flags are skipped', () => {
      for (const c of ['ls | xargs -0n 1 rm -rf', 'ls | xargs -0I {} rm -rf {}', 'ls | xargs -tP 4 rm -rf', 'time -o /tmp/t rm -rf /tmp/x', '/usr/bin/time -f %e rm -rf /tmp/x', 'time --output=/tmp/t rm -rf /tmp/x', 'time --format %e rm -rf /tmp/x', 'sudo -R /x rm -rf dist', 'sudo --chroot /x rm -rf dist']) expect(hit(c)).toBe('files.rm-recursive:ask')
      expect(hit('time -o /tmp/t rm -rf dist')).toBe('pass')
    })
  })
  test('find skips -O and -D before the start paths', () => {
    expect(hit('find -O3 / -name x -delete')).toBe('files.find-delete:ask')
    expect(hit('find -D tree / -name x -delete')).toBe('files.find-delete:ask')
    expect(hit('find -O3 src -name x -delete')).toBe('pass')
  })
  test('a .. after a wildcard is risky', () => {
    expect(hit('rm -rf dist/*/../../../etc')).toBe('files.rm-recursive:ask')
  })
  test('a session in $HOME or / or with no cwd has no safe zone', () => {
    expect(hit('rm -rf dist', { cwd: '/home/u', home: '/home/u' })).toBe('files.rm-recursive:ask')
    expect(hit('rm -rf dist', { cwd: '/', home: '/home/u' })).toBe('files.rm-recursive:ask')
    expect(hit('rm -rf dist', { cwd: null, home: null })).toBe('files.rm-recursive:ask')
    expect(hit("find . -name '*.pyc' -delete", { cwd: null, home: null })).toBe('files.find-delete:ask')
  })
})

describe('git', () => {
  test('force pushes ask, lease does not', () => {
    expect(hit('git push --force origin main')).toBe('git.force-push:ask')
    expect(hit('git push -f')).toBe('git.force-push:ask')
    expect(hit('git push origin +main')).toBe('git.force-push:ask')
    expect(hit('git push --force origin +release/1.2')).toBe('git.force-push:ask')
    expect(hit('git push -f origin release-2')).toBe('git.force-push:ask')
    expect(hit('git push -f origin HEAD')).toBe('git.force-push:ask')
    expect(hit('git push -f origin refs/heads/master')).toBe('git.force-push:ask')
    expect(hit('git push -f origin feat/x')).toBe('pass')
    expect(hit('git push -f origin feat/x main')).toBe('git.force-push:ask')
    expect(hit('git push origin feat/x +main')).toBe('git.force-push:ask')
    expect(hit('git push origin main feat/x')).toBe('pass')
    expect(hit('git push origin +feat/x main')).toBe('pass')
    expect(bash('git push -f origin feat/x release/1')?.verdict).toMatchObject({ preview: { branch: 'release/1' } })
    expect(hit('git push -f origin releases')).toBe('pass')
    expect(hit('git push --force-with-lease origin feat/x')).toBe('pass')
    expect(hit('git push origin feat/x')).toBe('pass')
  })
  test('discarding changes asks, switching branches does not', () => {
    expect(hit('git reset --hard HEAD~1')).toBe('git.discard-changes:ask')
    expect(hit('git checkout -- .')).toBe('git.discard-changes:ask')
    expect(hit('git checkout .')).toBe('git.discard-changes:ask')
    expect(hit('git restore src/a.ts')).toBe('git.discard-changes:ask')
    expect(hit('git checkout main')).toBe('pass')
    expect(hit('git restore --staged src/a.ts')).toBe('pass')
    expect(hit('git reset --soft HEAD~1')).toBe('pass')
  })
  test('force-push preview names remote and branch', () => {
    const r = bash('git push --force origin main')
    expect(r?.verdict.kind === 'ask' && r.verdict.preview).toEqual({ kind: 'force-push', remote: 'origin', branch: 'main' })
  })
})

describe('k8s', () => {
  test('cluster-wide reads deny', () => {
    expect(hit('kubectl get pods -A')).toBe('k8s.all-namespaces:deny')
    expect(hit('kubectl get pods --all-namespaces')).toBe('k8s.all-namespaces:deny')
    expect(hit(`bash -c 'kubectl top pods -A'`)).toBe('k8s.all-namespaces:deny')
    expect(hit('kubectl get pods -n web')).toBe('k8s.unscoped-list:deny')
    expect(hit('kubectl -n web describe deploy')).toBe('k8s.unscoped-list:deny')
  })
  test('-A after -- belongs to the remote command', () => {
    expect(hit('kubectl exec api-1 -- ls -A')).not.toBe('k8s.all-namespaces:deny')
    expect(hit('kubectl exec api-1 -- grep -A 3 foo log')).not.toBe('k8s.all-namespaces:deny')
    expect(hit('kubectl get pods -A -- x')).toBe('k8s.all-namespaces:deny')
  })
  test('named or selected reads pass; deletes are refused', () => {
    expect(hit('kubectl get pod api-1 -n web')).toBe('pass')
    expect(hit('kubectl get pods -n web -l app=api')).toBe('pass')
    expect(hit('kubectl get deploy/api -n web -o yaml')).toBe('pass')
    expect(hit('kubectl logs api-1 -n web')).toBe('pass')
    expect(hit('kubectl delete pod api-1 -n web')).toBe('k8s.delete:deny')
  })
  test('-f / -k name the objects; attached -l is a selector', () => {
    for (const c of ['kubectl get -f x.yaml', 'kubectl describe -f x.yaml', 'kubectl get --filename=x.yaml', 'kubectl get -k overlays/prod', 'kubectl get --kustomize overlays/prod', 'kubectl get -R -f manifests/', 'kubectl get pods -lapp=api', 'kubectl get pods -l=app=api', 'kubectl get pods -n web -lapp=api']) expect(hit(c)).toBe('pass')
    expect(hit('kubectl get pods -R -n web')).toBe('k8s.unscoped-list:deny')
  })
  test('every kubectl delete is refused, however it names the objects (user, 2026-10-15)', () => {
    for (const c of ['kubectl delete -f x.yaml', 'kubectl delete pod api-1 -n web --grace-period=0 --force', 'kubectl -n web delete deploy/api']) expect(hit(c)).toBe('k8s.delete:deny')
    const r = bash('kubectl delete pod api-1 -n web')
    expect(r?.verdict.kind === 'deny' && r.verdict.reason).toMatch(/deletes cluster resources/)
  })
})

describe('sql', () => {
  const mcp = (sql: string) => evaluate(BUILTIN_RULES, all, 'mcp__db__query', { database: 'orders', sql }, ctx)
  test('unbounded statements deny on MCP tools', () => {
    expect(mcp('select * from orders')?.rule.id).toBe('sql.unbounded')
    expect(mcp('SELECT count(*) FROM orders')?.verdict.kind).toBe('deny')
    expect(mcp('select * from orders order by id limit 10')?.verdict.kind).toBe('deny')
    expect(mcp('delete from orders')?.verdict.kind).toBe('deny')
  })
  test('bounded statements and prose pass', () => {
    expect(mcp('select * from orders where id = 1')).toBeNull()
    expect(mcp('select * from orders limit 10')).toBeNull()
    expect(mcp('show create table orders')).toBeNull()
    expect(mcp('Select the best orders to review')).toBeNull()
  })
  test('only sql / query / statement values are scanned', () => {
    const call = (input: Record<string, unknown>) => evaluate(BUILTIN_RULES, all, 'mcp__db__query', input, ctx)?.verdict.kind ?? 'pass'
    expect(call({ sql: 'select * from t' })).toBe('deny')
    expect(call({ args: { query: 'delete from t' } })).toBe('deny')
    expect(call({ Statement: ['update t set a = 1'] })).toBe('deny')
    expect(call({ text: 'Delete from my list' })).toBe('pass')
    expect(call({ message: 'select * from t' })).toBe('pass')
    expect(call({ tool: 'select * from t' })).toBe('pass')
  })
  test('file tools are never checked for SQL', () => {
    expect(evaluate(BUILTIN_RULES, all, 'Write', { file_path: 'q.sql', content: 'select * from orders' }, ctx)).toBeNull()
  })
})

describe('engine', () => {
  test('disabled rules are skipped', () => {
    expect(evaluate(BUILTIN_RULES, id => id !== 'files.rm-recursive', 'Bash', { command: 'rm -rf /tmp/x' }, ctx)).toBeNull()
  })
  test('the most severe verdict wins', () => {
    expect(hit('rm -rf /tmp/x && kubectl get pods -A')).toBe('k8s.all-namespaces:deny')
  })
  test('mentions in messages are not commands', () => {
    expect(hit('git commit -m "stop running rm -rf in CI"')).toBe('pass')
    expect(hit("cat <<'EOF' > n.md\ngit push --force\nEOF")).toBe('pass')
  })
})

test('every built-in rule says in one line what it covers', () => {
  for (const r of BUILTIN_RULES) {
    expect(typeof r.summary).toBe('string')
    expect((r.summary ?? '').length).toBeGreaterThan(20)
    expect((r.summary ?? '').length).toBeLessThan(120)
  }
})
