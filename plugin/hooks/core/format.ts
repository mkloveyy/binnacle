import { textWidth } from './width.ts'

const FAMILY = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?![\d])/i

export function modelLabel(id: string): string {
  const m = FAMILY.exec(id)
  if (!m) return id
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  return m[3] !== undefined ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

const SHORT: Record<string, string> = { low: 'lo', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' }

export function effortLabel(e: string | null, short = false): string {
  if (e === null || e === '') return '—'
  return short ? SHORT[e] ?? e : e
}

/** `Opus 5.5 · high`, or the model alone while no turn has reported the effort (no API gives it before one). */
export const modelEffort = (model: string, effort: string | null): string =>
  effort === null || effort === '' ? modelLabel(model) : `${modelLabel(model)} · ${effort}`

export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function duration(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A running clock with seconds: `42s`, `1m02s`, `1h05m`. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function countdown(ms: number): string {
  if (ms <= 0) return 'now'
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local 24-hour clock for a reset moment; `withDay` prefixes the English weekday. */
export function resetClock(at: number, withDay: boolean): string {
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return withDay ? `${DAYS[d.getDay()]} ${hm}` : hm
}

/** Reset moment as clock plus countdown, e.g. `14:30 (in 1h5m)`. */
export function resetLabel(at: number, now: number, withDay: boolean): string {
  return `${resetClock(at, withDay)} (${at <= now ? 'now' : `in ${countdown(at - now)}`})`
}

export function bar(percent: number, width: number): string {
  return barParts(percent, width).join('')
}

/** A bar's filled and empty cells apart, so the empty ones can be drawn `subtle` (spec §4.2). */
export function barParts(percent: number, width: number): [filled: string, empty: string] {
  const n = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return ['█'.repeat(n), '░'.repeat(width - n)]
}

export const money = (usd: number): string => `$${usd.toFixed(2)}`

export function shortenPath(path: string, home: string, max: number): string {
  const p = home !== '' && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path
  if (textWidth(p) <= max) return p
  const parts = p.split('/')
  let out = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = '/' + parts[i] + out
    if (textWidth('…' + next) > max) break
    out = next
  }
  return '…' + out
}
