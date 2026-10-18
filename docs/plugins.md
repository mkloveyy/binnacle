English | [简体中文](plugins.zh-CN.md)

# Writing a binnacle plugin

binnacle is a kernel with an interface for plugins. A plugin is an ordinary Claude Code plugin that lists `"binnacle"` under `dependencies` and adds to binnacle's interface through `$.binnacle`: a button at the right of the footer, a part of the status line, a line under it, a setting, a tab in `/binnacle`, an attention toast, a rule for the guard, or the source of its own guard's denials. binnacle draws all of it; your plugin only sends data, and hears back through one event, `binnacle.notify`, when the person uses something it added.

`binnacle-example-pack` (a rule pack with a footer button and a setting) is a plugin of this kind; the code is in the marketplace repository, beside `template/`.

## 1. How it fits together

```
your plugin                                   binnacle
───────────                                   ────────
session.start
  $.binnacle.version({})            ───────▶  { api: 1, binnacle: '0.6.0' }
  $.binnacle.button({ id, label })  ───────▶  drawn at the right of the footer
                                               … the person clicks it …
on('binnacle.notify', …)            ◀───────  $.binnacle.notify({ plugin, kind: 'press', id })
  checks it came from binnacle and is yours,
  then does the work (after the chain: §4)
```

binnacle never knows which plugins exist. It keeps what each one registered under the name Claude Code gives the caller (`next.origin.plugin`, which a plugin cannot set), so a plugin can only change or remove its own things.

## 2. Five minutes

1. Copy `template/` from the marketplace repository to the root of a new repository; rename the plugin in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `types/index.d.ts` and `NAME` in `hooks/register.ts`.
2. Install binnacle from its marketplace (`claude plugin install binnacle@binnacle`).
3. In a project, run `claude --plugin-dir <your folder>`: `✋ hello` shows at the right of the footer; click it.
4. Edit `hooks/logic.ts` and `hooks/register.ts`; `claude plugin validate .` and `claude plugin test .` check them.
5. Go through `CHECKLIST.md` in a real session.

`plugin.json` needs `"dependencies": ["binnacle@binnacle"]` (a plugin listed in binnacle's own marketplace may write just `"binnacle"`). Claude Code installs binnacle with your plugin, starts binnacle first, and lays binnacle's types in `.claude-plugin/types/binnacle/`, so `$.binnacle` is typed with nothing copied. A plugin whose dependency is missing is not loaded at all.

## 3. The interface

Every call is rejected (the promise rejects) when an argument is wrong or a limit is reached; the reason starts with `binnacle:`. Text is drawn as one line, control characters shown as visible stand-ins (`^[`), and cut to the limit; a colour is a hex value or a theme name, anything else is dropped. Ids are cut to 200 characters. Calling with the same id again replaces the item, keeping its place; an empty label, text or form list removes it.

| Call | Arguments → answer | What it does | Limit per plugin |
|---|---|---|---|
| `version` | `{}` → `{ api, binnacle }` | `api` is raised only by a change that breaks plugins written for the old one | — |
| `button` | `{ id, label, color? }` → `{ ok }` | A button at the right of the footer, before `☰ binnacle`; a click notifies `press` | 2; label 16 columns |
| `segment` | `{ id, text, color?, priority?, press? }` → `{ ok }` | A part at the end of the status line. When the line is short of room, plugin parts go before any of binnacle's own, the lowest `priority` (0–9, default 5) first. With `press: true` a click notifies `press` | 3; text 30 columns |
| `line` | `{ id, forms, press? }` → `{ ok }` | A line under the status line. `forms` are spans (`{ text, color?, dim?, bold? }[]`) wide to narrow: binnacle draws the first that fits, else cuts the last | 1 line; 4 forms of 200 characters |
| `setting` | `{ id, title, default }` → `{ ok, value }` | A switch under your plugin in `/binnacle` → Settings → Plugins; binnacle stores it and answers its value; a toggle notifies `setting` | 10; title 40 columns |
| `tab` | `{ id, title, rows }` → `{ ok }` | A tab in `/binnacle` (hotkeys `1`–`9`). Rows: below. Opening it notifies `open`. Empty `rows` removes it | 2 tabs; 2000 rows of 500 characters |
| `attention` | `{ id, level, text }` → `{ ok }` | A toast under your plugin's name when the item is new or its text changed (`info`, `warn`, `error`) | 3; 80 characters |
| `guardSource` | `{ prefix, source }` → `{ ok }` | Your guard's denials (reasons that read `<prefix><rule> · <text>`, rule `[a-z][a-z-]*`) are shown in Activity and Permissions under `source` | 3; prefix 3–40 characters, not `binnacle…`, one owner |
| `register`, `enabled`, `ask`, `record`, `shell` | see the rule pack | Rules for binnacle's guard: list a rule in Settings, ask whether it is on, ask the person, record a decision, split a shell command | — |

Everything plugins add is ordered by plugin name, each plugin's own items in the order it added them: the order plugins load in depends on each person's setup, so it never decides where a button or a tab (and its hotkey) goes. Segments and lines show while binnacle's status line is on; buttons while its status line or its guard is on. The person can turn everything a plugin added off in Settings → Plugins (its settings stay there, to turn it back on).

**Tab rows.** `{ id?, text?, color?, dim?, bold?, cols?, press?, buttons?, children? }`:

- `cols`: up to 6 cells of spans, right-aligned across the rows of one level that have the same number of cells; the text is cut first.
- `press: true` (with an `id`): the whole row is a button; a press notifies `{ kind: 'press', id }`.
- `buttons`: up to 6 `{ id, label }` (20 columns); a press notifies `{ kind: 'press', id, row }` with the row's id. A row with buttons and no text is drawn as a row of buttons.
- `children`: rows under it; binnacle draws the toggle.

## 4. Hearing back: `binnacle.notify`

```ts
type BinnacleNotify =
  | { plugin: string; kind: 'press'; id: string; row?: string }
  | { plugin: string; kind: 'setting'; id: string; value: boolean }
  | { plugin: string; kind: 'open'; id: string }
```

```ts
on('binnacle.notify', async ($, e, next) => {
  if (next.origin.plugin !== 'binnacle' || e.plugin !== NAME) return next(e)
  $.clock.after(0, () => void handle($, e))
  return { value: { handled: true } }
}).catch(($, e, next) => (next.called ? { value: { handled: true } } : next(e)))
```

Four rules, each from something measured:

1. **Check that binnacle sent it.** Any plugin can call `$.binnacle.notify`, and in a real session that call reaches your subscription with `next.origin.plugin` set to the caller. Pass on anything not from `binnacle` and anything for another plugin.
2. **Call binnacle back only after the chain.** Inside the `binnacle.notify` chain, a call to `$.binnacle.<anything>` never reaches binnacle: it gets a placeholder answer and nothing is drawn. Do that work in `$.clock.after(0, …)`, as above. Calls to the rest of Claude Code (`$.model.fork`, `$.command.run`, `$.prompt.fill`, `$.process.run`) work in the chain.
3. **Add `.catch`.** The subscription is a hook that answers for others; the validator asks for it.
4. **A handler that throws** is skipped; Claude Code shows `<plugin>: binnacle.notify hook skipped: threw …` in the conversation, and binnacle carries on.

The answer (`handled`) is not used by binnacle; it never waits for your handler.

## 5. Lifetime and state

- Register in `session.start`. Registering again with the same id replaces, so doing it at every start is harmless.
- `/clear` and `/resume <id>` raise `session.end` and **no** `session.start` after it. binnacle keeps what plugins registered for the whole process, so your buttons and tabs stay; your plugin's own atoms (`$.state`) go back to their defaults.
- Keep what should outlive `/clear` in module memory or `$.store`; keep what belongs to one conversation in atoms.
- A plugin that keeps atoms declares them in its own types contract: `declare module 'claude-code' { interface PluginState { '<your-plugin>': { … } } }`, with `"types"` in `plugin.json`.
- `/reload-plugins` runs your `session.start` again with your module memory empty; atoms stay.

## 6. Compatibility

- Check `(await $.binnacle.version({})).api` at `session.start` and register nothing when it is not the number you wrote for.
- `"binnacle@^0.6"` in `dependencies` passes validation but is not enforced: check the api number instead.
- Every `$.binnacle` call sits in a `try` or has a `.catch`.

## 7. Testing

`claude plugin test` loads no dependency. Copy `tests/binnacle-mock.tsx` from the template into your `tests/` and load it beside your plugin: it stands in for binnacle.

```ts
import { MOCK_PANE, binnacleMock } from './binnacle-mock.tsx'

test('the hello button greets', { plugins: [binnacleMock] }, async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(toasts).toContain('binnacle-mock: button binnacle-hello {"id":"hello","label":"✋ hello"}')
  const ui = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...MOCK_PANE })
  await ui.press({ key: 'press-binnacle-hello-hello' })
  await ui.unmount()
  expect(toasts).toContain('hello, once')
})
```

- Each call your plugin makes shows as a toast `binnacle-mock: <call> <plugin> <arguments>`.
- The mock's pane has a button for everything you registered: `press-<plugin>-<id>`, `setting-<plugin>-<id>`, `open-<plugin>-<tab>`, `row-<plugin>-<tab>-<row>`, `rowbutton-<plugin>-<tab>-<row>-<button>`. A press raises `binnacle.notify` from binnacle and resolves once your handler has; work you deferred with `$.clock.after` runs after `mock.clock(on).settle()`.
- Without the mock, a plugin that subscribes to `binnacle.notify` does not load in `claude plugin test` at all.
- What the mock cannot show (binnacle's own drawing, another plugin pretending to be binnacle) is for a real session: `CHECKLIST.md`.

## 8. Publishing your plugin

**From your own repository (nothing in binnacle changes).** The template's repository is its own marketplace: `.claude-plugin/marketplace.json` lists the plugin with `"source": "./"` and allows its dependency on binnacle's marketplace:

```json
{ "name": "my-plugin", "owner": { "name": "me" }, "allowCrossMarketplaceDependenciesOn": ["binnacle"],
  "plugins": [{ "name": "my-plugin", "source": "./", "description": "…" }] }
```

People install it with:

```
claude plugin marketplace add <binnacle's marketplace>    # once, for binnacle itself
claude plugin marketplace add <your repository>
claude plugin install my-plugin@my-plugin                 # binnacle comes along
```

Measured: with the allow line, binnacle is installed with your plugin; without it, your plugin installs but does not load until binnacle is installed; without binnacle's marketplace added, it does not load and Claude Code says why.

**Listed in binnacle's marketplace as well (optional).** People who added only that marketplace then find your plugin there. Add an entry with your repository and a full 40-character commit `sha` to its catalog and open a merge request (inside the company) or a pull request (GitHub):

```json
{ "name": "my-plugin", "source": { "source": "git-subdir", "url": "https://github.com/me/my-repo.git", "path": "my-plugin", "sha": "<40 hex>" }, "description": "…" }
```

(`{ "source": "github", "repo": "me/my-plugin", "sha": "…" }` for a repository that is the plugin.)

Either way, bump `version` in `plugin.json` for every release: Claude Code does not update a plugin whose version did not change.

## 9. What a plugin may do

- Send data only. binnacle cleans every text and caps every list (§3).
- binnacle refuses changes to another plugin's things.
- Any installed plugin can subscribe to `binnacle.<call>` and change what other plugins send; it cannot change who the caller is. Installing a plugin means trusting it, as it can read and write files and run commands anyway: install plugins you trust; entries in binnacle's marketplace are reviewed and pinned to a commit.
