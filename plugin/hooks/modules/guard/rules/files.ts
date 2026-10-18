import { base } from '../../../core/shell.ts'
import { inGitDir, outsideProject } from '../paths.ts'
import { PASS, bashCommands, gitArgs, gitRelocated, locationKnown, type Rule } from '../types.ts'

const isShortFlag = (w: string) => /^-[a-zA-Z]+$/.test(w)

export const rmRecursive: Rule = {
  id: 'files.rm-recursive', pack: 'files', title: 'Recursive delete', summary: 'rm -r on paths outside the project or inside .git, or where the location is unknown', action: 'ask', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input, ctx) {
    const cmds = bashCommands(input)
    for (const c of cmds) {
      if (base(c.words[0]) !== 'rm') continue
      const rest = c.words.slice(1)
      if (!rest.some(w => w === '--recursive' || (isShortFlag(w) && /[rR]/.test(w)))) continue
      const targets = rest.filter(w => !w.startsWith('-'))
      const unknown = !locationKnown(c, cmds)
      if (!unknown && !targets.some(t => outsideProject(t, ctx, false) || inGitDir(t, ctx))) continue
      return { kind: 'ask', reason: `\`${c.text}\` deletes ${targets.join(' ') || 'files'} recursively.`, preview: unknown ? null : { kind: 'rm', targets } }
    }
    return PASS
  },
}

/** The start paths of a find command: the words after `find` (and leading -H/-L/-P) up to the first expression word. */
function findStarts(words: string[]): string[] {
  let i = 1
  while (i < words.length && (['-H', '-L', '-P'].includes(words[i]) || /^-O\d?$/.test(words[i]) || words[i] === '-D')) i += words[i] === '-D' ? 2 : 1
  const starts: string[] = []
  for (; i < words.length && !/^[-()!]/.test(words[i]); i++) starts.push(words[i])
  return starts.length ? starts : ['.']
}

const FILTERS = new Set(['-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-wholename', '-iwholename'])

/** A filter value that can reach the repository's own history: `.git` at a segment start (after nothing, `/`, `*`, `\\`) and not continuing as a longer literal name. */
const GIT_FILTER = /(^|[/*\\])\.git($|[^A-Za-z0-9_-])/

function filtersGit(words: string[]): boolean {
  return words.some((w, i) => FILTERS.has(words[i - 1] ?? '') && GIT_FILTER.test(w))
}

/** `find … -exec rm -r… ` (or -execdir / -ok / -okdir). */
function findExecRm(words: string[]): boolean {
  return words.some((w, i) => /^-(exec|execdir|ok|okdir)$/.test(w) && base(words[i + 1] ?? '') === 'rm' && words.slice(i + 2).some(x => x === '--recursive' || (isShortFlag(x) && /[rR]/.test(x))))
}

export const findDelete: Rule = {
  id: 'files.find-delete', pack: 'files', title: 'find -delete', summary: 'find -delete / -exec rm -r outside the project, at its root with no name filter, or aimed at .git', action: 'ask', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input, ctx) {
    const cmds = bashCommands(input)
    for (const c of cmds) {
      if (base(c.words[0]) !== 'find' || !(c.words.includes('-delete') || findExecRm(c.words))) continue
      const unknown = !locationKnown(c, cmds)
      // The project root itself is a safe start only with a name / path filter.
      const filtered = c.words.some(w => FILTERS.has(w))
      const gitFilter = filtersGit(c.words)
      if (!unknown && !findStarts(c.words).some(p => outsideProject(p, ctx, filtered) || inGitDir(p, ctx) || (gitFilter && !outsideProject(p, ctx, true) && outsideProject(p, ctx, false)))) continue
      return { kind: 'ask', reason: `\`${c.text}\` deletes every file it matches.`, preview: unknown ? null : { kind: 'find', args: c.words.slice(1).filter(w => w !== '-delete') } }
    }
    return PASS
  },
}

export const gitClean: Rule = {
  id: 'files.git-clean', pack: 'files', title: 'git clean', summary: 'git clean -f: deletes files git does not track (never committed); previewed with git clean -n', action: 'ask', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input) {
    const cmds = bashCommands(input)
    for (const c of cmds) {
      if (base(c.words[0]) !== 'git') continue
      const g = gitArgs(c.words)
      if (!g || g.sub !== 'clean') continue
      if (!g.args.some(w => w === '--force' || (isShortFlag(w) && w.includes('f')))) continue
      return { kind: 'ask', reason: `\`${c.text}\` deletes untracked files.`, preview: gitRelocated(c) || !locationKnown(c, cmds) || g.args.some(w => /[$`]/.test(w)) ? null : { kind: 'git-clean', args: g.args } }
    }
    return PASS
  },
}
