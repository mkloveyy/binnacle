import { base, type Cmd } from '../../../core/shell.ts'
import { PASS, bashCommands, type Rule } from '../types.ts'

const VALUE_FLAGS = new Set([
  '-n', '--namespace', '-l', '--selector', '--field-selector', '--context', '--kubeconfig', '--cluster', '--user',
  '-o', '--output', '-c', '--container', '--sort-by', '--template', '-L', '--label-columns', '--chunk-size',
  '--request-timeout', '-s', '--server', '--token', '--as', '--grace-period', '--cascade', '--timeout',
  '-f', '--filename', '-k', '--kustomize',
])
// A selector, or a file / kustomization naming the objects, scopes a list.
const SELECTORS = new Set(['-l', '--selector', '--field-selector', '-f', '--filename', '-k', '--kustomize'])
const LIST_VERBS = new Set(['get', 'describe', 'top'])

const isKubectl = (c: Cmd) => base(c.words[0]) === 'kubectl'

function parse(c: Cmd) {
  const positional: string[] = []
  let selected = false
  for (let i = 1; i < c.words.length; i++) {
    const w = c.words[i]
    if (w.startsWith('-')) {
      const flag = w.includes('=') ? w.slice(0, w.indexOf('=')) : w
      if (SELECTORS.has(flag) || /^-[lfk][^=-]/.test(w)) selected = true
      if (!w.includes('=') && VALUE_FLAGS.has(w)) i++
      continue
    }
    positional.push(w)
  }
  return { positional, selected }
}

export const k8sAllNamespaces: Rule = {
  id: 'k8s.all-namespaces', pack: 'k8s', title: 'Cluster-wide kubectl', summary: 'kubectl -A / --all-namespaces: scans every namespace of a shared cluster', action: 'deny', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input) {
    for (const c of bashCommands(input)) {
      if (!isKubectl(c)) continue
      const own = c.words.slice(0, c.words.indexOf('--') === -1 ? undefined : c.words.indexOf('--'))
      if (own.some(w => w === '-A' || w === '--all-namespaces' || w.startsWith('--all-namespaces='))) {
        return { kind: 'deny', reason: `\`${c.text}\` scans every namespace of a shared cluster. Find the namespace from the code or config first, or ask the user.` }
      }
    }
    return PASS
  },
}

export const k8sUnscopedList: Rule = {
  id: 'k8s.unscoped-list', pack: 'k8s', title: 'Unscoped kubectl list', summary: 'kubectl get / describe / top of a resource type with no name, -l selector or -f', action: 'deny', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input) {
    for (const c of bashCommands(input)) {
      if (!isKubectl(c)) continue
      const { positional, selected } = parse(c)
      const [verb, resource, ...names] = positional
      if (!LIST_VERBS.has(verb ?? '') || resource === undefined) continue
      if (names.length > 0 || resource.includes('/') || selected) continue
      return { kind: 'deny', reason: `\`${c.text}\` lists every ${resource} with no name or label selector. Name the object or add -l <selector>.` }
    }
    return PASS
  },
}

export const k8sDelete: Rule = {
  // Refused, not asked (user, 2026-10-15): a delete on a shared cluster is run by a person, outside Claude.
  id: 'k8s.delete', pack: 'k8s', title: 'kubectl delete', summary: 'every kubectl delete is refused; run it yourself', action: 'deny', tools: ['Bash'], defaultEnabled: true,
  check(_tool, input) {
    for (const c of bashCommands(input)) {
      if (!isKubectl(c) || parse(c).positional[0] !== 'delete') continue
      return { kind: 'deny', reason: `\`${c.text}\` deletes cluster resources. binnacle refuses every kubectl delete; if it is needed, the user runs it.` }
    }
    return PASS
  },
}
