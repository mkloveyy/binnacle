import type { Rule } from '../types.ts'
import { findDelete, gitClean, rmRecursive } from './files.ts'
import { discardChanges, forcePush } from './git.ts'
import { k8sAllNamespaces, k8sDelete, k8sUnscopedList } from './k8s.ts'
import { sqlUnbounded } from './sql.ts'

export const BUILTIN_RULES: readonly Rule[] = [
  rmRecursive, findDelete, gitClean, forcePush, discardChanges, k8sAllNamespaces, k8sUnscopedList, k8sDelete, sqlUnbounded,
]
