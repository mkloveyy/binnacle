import { PASS, type Rule } from '../types.ts'

const META = /^(show|desc|describe|explain)\b/i
const SORT_OR_AGGREGATE = /\border\s+by\b|\bgroup\s+by\b|\bdistinct\b|\b(count|sum|avg|min|max)\s*\(/i

function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`[^`]*`/g, 'x')
    .trim()
}

export function sqlDenial(sql: string): string | null {
  for (const raw of normalize(sql).split(';')) {
    const s = raw.trim()
    if (s === '' || META.test(s)) continue
    const where = /\bwhere\b/i.test(s)
    if (/^(update|delete)\b/i.test(s)) {
      if (!where) return 'UPDATE / DELETE without WHERE touches every row.'
      continue
    }
    if (!/^(select|with)\b/i.test(s) || !/\bfrom\b/i.test(s) || where) continue
    if (/\blimit\s+\d+/i.test(s) && !SORT_OR_AGGREGATE.test(s)) continue
    return 'SELECT without WHERE scans the whole table. Bound it by an id or a time range; for sample rows use LIMIT without ORDER BY or aggregates.'
  }
  return null
}

const SQL_KEY = /^(sql|query|statement)$/i

/** String values stored under a sql / query / statement key (directly or in arrays below it), at any depth of the input. */
function sqlStrings(input: Record<string, unknown>): string[] {
  const found: string[] = []
  const collect = (v: unknown, depth: number) => {
    if (depth > 4) return
    if (typeof v === 'string') found.push(v)
    else if (Array.isArray(v)) for (const x of v) collect(x, depth + 1)
  }
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || v === null || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      if (SQL_KEY.test(k)) collect(x, 0)
      visit(x, depth + 1)
    }
  }
  visit(input, 0)
  return found
}

export const sqlUnbounded: Rule = {
  id: 'sql.unbounded', pack: 'sql', title: 'Unbounded SQL', summary: 'SQL in MCP tools: UPDATE / DELETE or SELECT without WHERE (a bare LIMIT sample passes)', action: 'deny', tools: ['mcp:*'], defaultEnabled: true,
  check(_tool, input) {
    for (const sql of sqlStrings(input)) {
      const reason = sqlDenial(sql)
      if (reason !== null) return { kind: 'deny', reason }
    }
    return PASS
  },
}
