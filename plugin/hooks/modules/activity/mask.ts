// Order matters: a PEM block goes whole first; a bearer token is hidden before "authorization: <word>" is; known
// token shapes, URL query secrets and keyed values before the generic long-token rule.
/** A PEM block, to its END line or, when clipped or still being written, to the end of the text. */
const PEM = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g
const BEARER = /Bearer\s+\S+/gi
/** An AWS access key id. */
const AKIA = /\bAKIA[0-9A-Z]{16}\b/g
/** A Slack incoming webhook: the host stays, the path is the secret, up to a quote or bracket (JSON, `<url>`). */
const SLACK_HOOK = /(hooks\.slack\.com\/)services\/[^\s"'<>]+/g
/** Known token prefixes (GitHub, GitLab, Slack, Stripe, Google, npm, Anthropic/OpenAI), even when short. */
const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|[spr]k_(?:live|test)_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{35}|npm_[A-Za-z0-9]{36}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})/g
/** A secret in a URL query (signed URLs, OAuth callbacks). */
const QUERY_SECRET = /([?&](?:key|sig|signature|auth|code|access_token|refresh_token|id_token|client_secret|apikey|x-amz-signature|x-amz-credential|x-goog-signature)=)[^&\s#"']+/gi
/**
 * A secret-looking key, quoted or not (JSON, YAML, env), then its value up to a blank, a quote, a comma or an `&` that
 * starts the next `name=` (`X-Amz-Credential=…&X-Amz-Signature=…` keeps its second name; `password=a&b` is all value).
 */
const KEYED = /(token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|authorization)(["']?\s*[:=]\s*["']?)(?:[^\s"',&]|&(?![\w.-]+=))+/gi
const PASS_FLAG = /--password([= ])\S+/g
const URL_CRED = /(\/\/)[^\s/@:]+:[^\s/@]+@/g
/** A long mixed token; `/` is part of one (a cloud secret key's value has slashes). */
const LONG = /[A-Za-z0-9+_=/-]{32,}/g
/** One slash-free piece of a path-like run, checked on its own. */
const SEGMENT = /[A-Za-z0-9+_=-]{32,}/g
const GIT_SHA = /^[0-9a-f]{40}$/
/** Mixed letters and digits, and no git SHA: what the long-token rule hides. */
const tokenLike = (m: string): boolean => !(GIT_SHA.test(m) || !/[0-9]/.test(m) || !/[A-Za-z]/.test(m))
/**
 * A long run with slashes that reads as a path: absolute, or holding a word segment (`hooks`, `src`, `Sources`; a
 * capitalised one from four letters, so `Abc/` in front of a token does not make it a path). Its segments are still
 * checked one by one, so a token in a URL path or base64 from a slash is hidden.
 */
const PATH_WORD = /^(?:[a-z][a-z-]{2,}|[A-Z][a-z-]{3,})$/
const pathLike = (m: string): boolean => m.includes('/') && (m.startsWith('/') || m.split('/').some(seg => PATH_WORD.test(seg)))

/** Replaces likely secrets with `***`. Best effort: a pure text rule, no knowledge of the command. */
export function mask(text: string): string {
  return text
    .replace(PEM, '***')
    .replace(BEARER, 'Bearer ***')
    .replace(AKIA, '***')
    .replace(SLACK_HOOK, '$1***')
    .replace(TOKEN, '***')
    .replace(QUERY_SECRET, '$1***')
    .replace(KEYED, (_m, key: string, sep: string) => `${key}${sep}***`)
    .replace(PASS_FLAG, (_m, sep: string) => `--password${sep}***`)
    .replace(URL_CRED, '$1***@')
    .replace(LONG, m => (pathLike(m) ? m.replace(SEGMENT, seg => (tokenLike(seg) ? '***' : seg)) : tokenLike(m) ? '***' : m))
}

/** Control characters other than tab and newline in caret form (`^L`, `^[`, `^?`), C1 ones as U+FFFD: the host refuses them in drawn text. */
export const visible = (text: string): string =>
  text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, c => {
    const n = c.charCodeAt(0)
    return n >= 0x80 ? '\uFFFD' : '^' + String.fromCharCode(n ^ 0x40)
  })

export const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max - 1) + '…' : text)

/** One line, masked, control characters made visible, at most `max` characters: the form every saved or shown summary takes. */
export const brief = (text: string, max = 120): string => clip(visible(mask(text.replace(/\s+/g, ' ').trim())), max)
