import { base } from '../../../core/shell.ts'
import { PASS, bashCommands, gitArgs, gitRelocated, locationKnown, type Rule } from '../types.ts'

const isProtected = (branch: string | null) => branch === null || branch.includes('*') || branch === 'HEAD' || /^(main|master)$/.test(branch) || /^release([/-]|$)/.test(branch)
const branchOf = (ref: string) => (ref.replace(/^\+/, '').split(':').pop() ?? '').replace(/^refs\/heads\//, '')

const VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

export const forcePush: Rule = {
  id: 'git.force-push', pack: 'git', title: 'Force push', summary: 'force push to main, master, release*, HEAD or every branch; feature branches pass', action: 'ask', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input) {
    const cmds = bashCommands(input)
    for (const c of cmds) {
      if (base(c.words[0]) !== 'git') continue
      const g = gitArgs(c.words)
      if (!g || g.sub !== 'push') continue
      const flags: string[] = []
      const positional: string[] = []
      for (let i = 0; i < g.args.length; i++) {
        const w = g.args[i]
        if (!w.startsWith('-')) positional.push(w)
        else {
          flags.push(w)
          if (VALUE_OPTIONS.has(w)) i++
        }
      }
      const forcedAll = flags.some(w => w === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(w)) || (positional[0] ?? '').startsWith('+')
      const refs = positional.slice(1).filter(r => forcedAll || r.startsWith('+'))
      if (!forcedAll && refs.length === 0) continue
      const remote = positional[0] ?? null
      const sweeping = forcedAll && flags.some(w => w === '--mirror' || w === '--all')
      const branches = refs.length === 0 || sweeping ? [null] : refs.map(branchOf)
      const branch = branches.find(isProtected)
      if (branch === undefined) continue
      const preview = gitRelocated(c) || !locationKnown(c, cmds) ? null : { kind: 'force-push' as const, remote, branch }
      return { kind: 'ask', reason: `\`${c.text}\` can drop commits on the remote.`, preview }
    }
    return PASS
  },
}

export const discardChanges: Rule = {
  id: 'git.discard-changes', pack: 'git', title: 'Discard local changes', summary: 'reset --hard, checkout -- <paths> or ., restore of the work tree: drops uncommitted edits', action: 'ask', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input) {
    const cmds = bashCommands(input)
    for (const c of cmds) {
      if (base(c.words[0]) !== 'git') continue
      const g = gitArgs(c.words)
      if (!g) continue
      let paths: string[] | null = null
      if (g.sub === 'reset' && g.args.includes('--hard')) paths = []
      if (g.sub === 'checkout') {
        const dd = g.args.indexOf('--')
        if (dd !== -1) paths = g.args.slice(dd + 1)
        else if (g.args.length === 1 && g.args[0] === '.') paths = ['.']
      }
      if (g.sub === 'restore') {
        const staged = g.args.includes('--staged') || g.args.includes('-S')
        const worktree = g.args.includes('--worktree') || g.args.includes('-W')
        if (!staged || worktree) paths = g.args.filter(w => !w.startsWith('-'))
      }
      if (paths === null) continue
      return { kind: 'ask', reason: `\`${c.text}\` throws away uncommitted changes.`, preview: gitRelocated(c) || !locationKnown(c, cmds) ? null : { kind: 'discard', paths } }
    }
    return PASS
  },
}
