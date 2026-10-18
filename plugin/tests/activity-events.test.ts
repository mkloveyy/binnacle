import { describe, expect, test } from 'claude-code/testing'
import { brief, clip, mask } from '../hooks/modules/activity/mask.ts'
import { agentTurn, append, askOutcome, attribute, bump, currentTurn, deciderOf, firstLine, guardRefused, newSession, reportLines, tokensOf, turnNumbers } from '../hooks/modules/activity/events.ts'

/**
 * Fake secrets, put together at run time: whole in the source, they read as real ones to secret scanners (GitHub push
 * protection refused a push over one). What mask sees is unchanged.
 */
const AWS_SECRET = 'wJalrXUtnFEMI' + '/K7MDENG/bPxRfiCYEXAMPLEKEY'
const PEM = (kind: string): string => '-----BEGIN ' + kind + ' PRIVATE' + ' KEY-----'
const SLACK = 'hooks.' + 'slack.com'

describe('mask', () => {
  test('keyed secrets keep the key and hide the value', () => {
    expect(mask('export API_KEY=abc123 && run')).toBe('export API_KEY=*** && run')
    expect(mask('GITHUB_TOKEN=' + 'gh' + 'p_x mytool')).toBe('GITHUB_TOKEN=*** mytool')
    expect(mask('secret: hunter2')).toBe('secret: ***')
  })
  test('quoted keys and values (JSON, YAML), cloud keys and PEM blocks (B12 review I2)', () => {
    expect(mask('{"password": "hunter2"}')).toBe('{"password": "***"}')
    expect(mask('{"api_key": "' + 'sk_' + 'live_51Habc"}')).toBe('{"api_key": "***"}')
    expect(mask("token: 'abc123', next")).toBe("token: '***', next")
    expect(mask('aws_secret_access_key = ' + AWS_SECRET)).toBe('aws_secret_access_key = ***')
    expect(mask('export AWS_SECRET_ACCESS_KEY=' + AWS_SECRET + ' && run')).toBe('export AWS_SECRET_ACCESS_KEY=*** && run')
    expect(mask('id ' + 'AK' + 'IAIOSFODNN7EXAMPLE used')).toBe('id *** used')
    // The value shape alone, with no key before it: slashes are part of a long token now.
    expect(mask('copy ' + AWS_SECRET + ' here')).toBe('copy *** here')
    expect(mask('a ' + PEM('RSA') + ' MIIEow IBAAKCAQEA -----END RSA PRIVATE KEY----- b')).toBe('a *** b')
    expect(mask('key: ' + PEM('OPENSSH') + ' b3BlbnNzaC1rZXktdjEAAAAA')).toBe('key: ***')
  })
  test('paths stay readable although a long token may hold slashes', () => {
    for (const p of ['/Users/me/workspace/binnacle-v03/hooks/modules/x123', 'hooks/modules/activity/control-chars-2026x', '~/workspace/binnacle-v03/tests/search123']) expect(mask(`open ${p}`)).toBe(`open ${p}`)
  })
  test('inside a path-like run each segment is still checked: tokens in URLs and API paths, base64 from a slash (fix round 2)', () => {
    const G36 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
    expect(mask(`git clone https://${'gh'}p_${G36}@github.com/org/repo.git`)).toBe('git clone https://***@github.com/org/repo.git')
    expect(mask(`curl https://api.example.com/v1/keys/${'sk'}-ant-api03-${'Xy9'.repeat(10)}`)).toBe('curl https://api.example.com/v1/keys/***')
    expect(mask(`GET /repos/x/${'gh'}p_${G36}`)).toBe('GET /repos/x/***')
    // No token prefix: only the per-segment rule catches these.
    expect(mask('curl https://api.example.com/v1/keys/Zx81kQ0pL2mN4bV6cX8zA1sD3fG5hJ7kL9')).toBe('curl https://api.example.com/v1/keys/***')
    expect(mask('img /9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQ end')).toBe('img /9j/4AAQSkZJRgABAQEASABIAAD/*** end')
  })
  test('paths, relative paths, SHAs and CamelCase source paths stay readable (fix round 2)', () => {
    for (const p of [
      '/Users/me/workspace/binnacle-v03/hooks/modules/x123',
      'hooks/modules/activity/control-chars-2026x',
      'git show 0123456789abcdef0123456789abcdef01234567',
      'Sources/MyApp2/ViewControllers/LoginViewController.swift',
    ]) expect(mask(p)).toBe(p)
  })
  test('known token shapes, even short ones (fix round 2)', () => {
    const letters = (n: number) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(2).slice(0, n)
    for (const t of [
      'gh' + 'o_A1b2C3d4E5f6G7h8I9j0',
      'github' + '_pat_A1b2C3d4E5f6G7h8I9j0',
      'gl' + 'pat-A1b2C3d4E5f6G7h8I9j0',
      'xo' + 'xb-1234567890-abc',
      'sk_' + 'live_51Habcdefghijklmn',
      'pk_' + 'test_51Habcdefghijklmn',
      `${'AI'}za${letters(35)}`,
      `${'np'}m_${letters(36)}`,
      `${'sk'}-ant-${letters(24)}`,
      `${'sk'}-proj-${letters(24)}`,
      `${'sk'}-${letters(24)}`,
    ]) expect({ t, out: mask(`use ${t} now`) }).toEqual({ t, out: 'use *** now' })
  })
  test('secrets in a URL query, keyed private keys and credentials, Slack webhooks (fix round 2)', () => {
    expect(mask('GET /x?key=abc123&page=2')).toBe('GET /x?key=***&page=2')
    expect(mask('https://cdn.example.com/f?exp=1&sig=Zz9#top')).toBe('https://cdn.example.com/f?exp=1&sig=***#top')
    expect(mask('open https://x.io/cb?auth=short')).toBe('open https://x.io/cb?auth=***')
    expect(mask('s3?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=deadbeef')).toBe('s3?X-Amz-Credential=***&X-Amz-Signature=***')
    expect(mask('cb?code=xyz&state=1')).toBe('cb?code=***&state=1')
    expect(mask('private_key: abc')).toBe('private_key: ***')
    expect(mask('PRIVATE-KEY=abc')).toBe('PRIVATE-KEY=***')
    expect(mask('{"credentials": "xyz"}')).toBe('{"credentials": "***"}')
    expect(mask('credential=foo')).toBe('credential=***')
    expect(mask('post https://' + SLACK + '/services/T000/B000/XXXX now')).toBe('post https://hooks.slack.com/*** now')
  })
  test('a Slack webhook path stops at a quote or bracket: the JSON around it stays (final wave)', () => {
    expect(mask('{"url":"https://' + SLACK + '/services/T000/B000/XXXX","channel":"#dev"}')).toBe('{"url":"https://hooks.slack.com/***","channel":"#dev"}')
    expect(mask('<https://' + SLACK + '/services/T0/B0/XX>')).toBe('<https://hooks.slack.com/***>')
  })
  test("a keyed value runs on over an `&` that does not start the next `name=` (final wave)", () => {
    expect(mask('password=a&b next')).toBe('password=*** next')
    expect(mask('export PASSWORD=p&ss&w0rd')).toBe('export PASSWORD=***')
    expect(mask('s3?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=deadbeef')).toBe('s3?X-Amz-Credential=***&X-Amz-Signature=***')
    expect(mask('cb?access_token=abc&x=1')).toBe('cb?access_token=***&x=1')
  })
  test('a capitalised segment reads as a path word only from four letters: `Abc/` before a token is not a path (final wave)', () => {
    expect(mask('see Abc/aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1 end')).toBe('see *** end')
    for (const p of [
      'Sources/MyApp2/ViewControllers/LoginViewController3Delegate.swift',
      'Assets/Plugins/Android/libs/arm64-v8a/libunity2022.so',
      'Packages/com.unity.render-pipelines.universal/Runtime/Passes/DrawObjectsPass2D.cs',
    ]) expect(mask(p)).toBe(p)
  })
  test('password flags, bearer tokens and URL credentials', () => {
    expect(mask('mysql --password=hunter2 -u root')).toBe('mysql --password=*** -u root')
    expect(mask('mysql --password hunter2 -u root')).toBe('mysql --password *** -u root')
    expect(mask('git clone https://bob:s3cret@example.com/r.git')).toBe('git clone https://***@example.com/r.git')
    const h = mask("curl -H 'Authorization: Bearer abc.def' https://x")
    expect(h).not.toContain('abc.def')
    expect(h).toContain('***')
  })
  test('long mixed tokens are hidden; git SHAs, paths and plain words are not', () => {
    expect(mask('key ab12CD34ef56GH78ij90KL12mn34OP56qr end')).toBe('key *** end')
    const sha = 'git reset --hard 0123456789abcdef0123456789abcdef01234567'
    expect(mask(sha)).toBe(sha)
    const path = 'see /Users/me/workspace/binnacle/hooks/register.tsx'
    expect(mask(path)).toBe(path)
    expect(mask('a'.repeat(40))).toBe('a'.repeat(40))
  })
  test('brief collapses whitespace, masks, and clips to 120 with an ellipsis', () => {
    expect(brief('a\n  b\tc')).toBe('a b c')
    const long = brief('x '.repeat(100))
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
    expect(clip('abc', 5)).toBe('abc')
    expect(brief('token=abc')).toBe('token=***')
  })
})

const S = () => newSession('s1', 1000, '/repo')

describe('session record', () => {
  test("a hand-back turn never becomes firstPrompt; the first turn the person started does", () => {
    let s = append(S(), { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: '<agent-message from="a1">', auto: true })
    expect(s.firstPrompt).toBe('')
    s = append(s, { at: 2, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'fix the bug' })
    s = append(s, { at: 3, turnId: 't3', agentId: null, kind: 'turn-start', prompt: 'again' })
    expect(s.firstPrompt).toBe('fix the bug')
  })
  test('the first turn-start sets firstPrompt; turns are numbered in order', () => {
    let s = append(S(), { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'fix the bug' })
    s = append(s, { at: 2, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'again' })
    expect(s.firstPrompt).toBe('fix the bug')
    expect(currentTurn(s)).toBe('t2')
    expect(turnNumbers(s).get('t2')).toBe(2)
    expect(currentTurn(S())).toBe('')
  })
  test("an agent's calls belong to the turn that spawned it; unknown agents to the main loop", () => {
    let s = append(S(), { at: 1, turnId: 't1', agentId: null, kind: 'turn-start', prompt: 'p' })
    s = append(s, { at: 2, turnId: 't1', agentId: 'a1', kind: 'agent-start', agentType: 'Explore', model: 'm', task: 'look', parentAgentId: null, background: true })
    s = append(s, { at: 3, turnId: 't2', agentId: null, kind: 'turn-start', prompt: 'q' })
    expect(attribute(s, 'a1')).toEqual({ turnId: 't1', agentId: 'a1' })
    expect(attribute(s, 'compact-fork')).toEqual({ turnId: 't2', agentId: null })
    expect(attribute(s, undefined)).toEqual({ turnId: 't2', agentId: null })
    expect(agentTurn(s, 'nope')).toBeNull()
  })
  test('bump merges counts per turn and agent', () => {
    let s = bump(S(), 't1', null, 'Bash')
    s = bump(s, 't1', null, 'Read')
    s = bump(s, 't1', 'a1', 'mcp__x__y')
    s = bump(s, 't1', null, 'Bash')
    expect(s.counts).toEqual([
      { turnId: 't1', agentId: null, files: 1, shell: 2, other: 0 },
      { turnId: 't1', agentId: 'a1', files: 0, shell: 0, other: 1 },
    ])
  })
})

describe('outcomes and summaries', () => {
  test('an ask outcome is read from the call result', () => {
    expect(askOutcome({})).toBe('approved')
    expect(askOutcome({ deny: 'no' })).toBe('denied-by-hook')
    expect(askOutcome({ isError: true, text: "The user doesn't want to proceed with this tool use. The tool use was rejected." })).toBe('denied-by-user')
    expect(askOutcome({ isError: true, text: 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [x]' })).toBe('denied-by-classifier')
    expect(askOutcome({ isError: true, text: 'Exit code 1' })).toBe('unknown')
    // A subagent's call refused in its dialog (2.1.296, manual mode, "4. No"): a different text from the main loop's.
    expect(askOutcome({ isError: true, text: 'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.' })).toBe('denied-by-user')
    expect([deciderOf('denied-by-user'), deciderOf('denied-by-classifier'), deciderOf('denied-by-hook'), deciderOf('approved'), deciderOf('unknown')]).toEqual(['user', 'classifier', 'hook', 'unknown', 'unknown'])
  })
  test('a report keeps five non-empty lines of at most 160 characters, masked', () => {
    const r = reportLines(['', 'one', 'token=abc', 'x'.repeat(200), 'four', 'five', 'six'].join('\n'))
    expect(r).toHaveLength(5)
    expect(r[1]).toBe('token=***')
    expect(r[2]).toHaveLength(160)
    expect(r[4]).toBe('five')
  })
  test('saved summaries draw control characters as visible stand-ins, cut after the stand-ins are in', () => {
    expect(brief('why is \x1b[31mred\x07')).toBe('why is ^[[31mred^G')
    expect(brief('\x1b'.repeat(200))).toHaveLength(120)
    expect(firstLine('\n\x1b[31mFAIL\x1b[0m tests/a.test.ts\nstack')).toBe('^[[31mFAIL^[[0m tests/a.test.ts')
    expect(firstLine('\x1b'.repeat(200))).toHaveLength(160)
    expect(reportLines('ok \x1b[1mbold\x7f\nc1 \x85')).toEqual(['ok ^[[1mbold^?', 'c1 �'])
    expect(reportLines('\x1b'.repeat(200))[0]).toHaveLength(160)
  })
  test("a guard's refusal of the same call is found by turn, summary and time", () => {
    const g = (action: 'deny' | 'ask-deny' | 'ask-allow', at: number, turnId = 't1', summary = 'kubectl get pods -A') =>
      ({ at, turnId, agentId: null, kind: 'guard' as const, ruleId: 'k8s.all-namespaces', action, summary })
    const s = (ev: ReturnType<typeof g>) => append(S(), ev)
    expect(guardRefused(s(g('deny', 10)), 't1', 'kubectl get pods -A', 10)).toBe(true)
    expect(guardRefused(s(g('ask-deny', 12)), 't1', 'kubectl get pods -A', 10)).toBe(true)
    expect(guardRefused(s(g('ask-allow', 12)), 't1', 'kubectl get pods -A', 10)).toBe(false)
    expect(guardRefused(s(g('deny', 9)), 't1', 'kubectl get pods -A', 10)).toBe(false)
    expect(guardRefused(s(g('deny', 10, 't2')), 't1', 'kubectl get pods -A', 10)).toBe(false)
    expect(guardRefused(s(g('deny', 10, 't1', 'other')), 't1', 'kubectl get pods -A', 10)).toBe(false)
  })
  test('tokens and the first error line', () => {
    expect(tokensOf({ input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 })).toEqual({ tokensIn: 115, tokensOut: 3 })
    expect(tokensOf(undefined)).toEqual({ tokensIn: null, tokensOut: null })
    expect(firstLine('\n  boom: no such file\nstack')).toBe('boom: no such file')
  })
})
