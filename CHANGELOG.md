# Changelog

## 0.6.3

- **Plugin tab rows can be laid out:** `indent` (1 or 2, two columns per level) puts a row one or two levels in, after its text is cleaned to one line, so a plugin no longer loses its spaces. A row of buttons now starts where a text row's text does, and moves with its indent. A row with nothing in it is a blank line between sections.

## 0.6.2

- **A plugin tab's row with an id stays open when rows above it come or go:** a row is remembered open by its id when no sibling shares it (by its place otherwise, as before). A folded group under a card whose height changes no longer closes itself.

## 0.6.1

- **Plugins' buttons, tabs, parts and lines are ordered by plugin name**, each plugin's own in the order it added them. Plugins load in an order each person's setup decides (measured: the reverse of the `--plugin-dir` order), so a tab's hotkey could change between sessions; Settings → Plugins lists them by name too.
- The manifest's author reads `Mark`.

## 0.6.0

- **A plugin interface:** other plugins add to binnacle through `$.binnacle`: `version`, `button` (the footer's right), `segment` (a part of the status line, dropped first when it is short of room), `line` (a line under it, from forms wide to narrow), `setting` (a switch under the plugin in Settings → Plugins, stored by binnacle), `guardSource` (the prefix of an external guard's denials, shown in Activity and Permissions under its source), and tab rows with aligned `cols`, pressed rows and row `buttons`. binnacle tells a plugin through `binnacle.notify` when the person presses, toggles or opens something of its. Limits, cleaning and the rules for handling a notice are in [docs/plugins.md](docs/plugins.md).
- **Plugin tabs and attention items survive `/clear` and `/resume`:** Claude Code raises no `session.start` after them, so a plugin had no chance to add them again; binnacle now keeps what plugins registered for the whole process.
- **The example rule pack** moved to the marketplace repository as `binnacle-example-pack` 0.3.0, with a footer button and a setting.
- **Uninstall wording corrected:** `claude plugin uninstall` deletes binnacle's saved sessions unless given `--keep-data`; the README said they stayed.

## 0.5.3

- **Records from before 0.5.0 repaired as they are read:** on Claude Code 2.1.299–2.1.300 binnacle recorded each subagent's own loop as a turn of main (just after the spawn, never ended), so saved sessions numbered their turns too high and put some of main's calls under them. Such turns are dropped, at most one per spawn, and what sat under them goes back to the turn before. Nothing is rewritten on disk until that session is saved again.
- **Flow no longer repeats the tool's name:** a call read `Read  Read /path`; it now reads `Read  /path`, in the cards and the log.
- **`/compact` counted without its event:** Claude Code 2.1.300 fires no `session.compact` (nor a classic `PostCompact` or `SessionStart`) for a manual `/compact`, checked in a real session, so the compaction count only caught up at the next start. The transcript is now counted again whenever a turn ends: `⇣N` and Overview's Compactions show it by the end of the next turn.
- **No `· —` for the effort anywhere before the first request:** the panel's title line, Overview's card and Flow's main card leave it out, as the status line does.
- **Agent-team teammates are not main's agents:** a teammate runs in its own pane and reports no end, so Flow drew it and the footer counted it as running long after the team shut down. Teammates spawned from now on are marked and left out of Flow and `●N`.
- **`kubectl delete` is refused, no longer asked (user's call):** every one, wrapped (`sudo`) or with another cluster's `KUBECONFIG`; the user runs it if it is needed. Its `kubectl get` preview is gone.
- **A call auto mode already approved no longer reads as waiting:** no API says when an ask is settled, nor the permission mode (the footer's mode labels and classic hooks do not carry it on 2.1.300). The transcript does say who settled each ask, so when the session's latest settled ask was the classifier's, an ask open 15 s or more counts as approved: Agents shows the agent running, Flow drops the `⏳ waiting for approval` row. Who decided is now read at the end of every turn.

## 0.5.2

- **Context from the start:** before the first request reports the context, the status line shows the breakdown's total (what `/context` counts) instead of `—/1M —`.
- **No `—` for the effort before the first request:** no plugin API gives it until a request is made (`$.config`, `$.session`, the render props and `CLAUDE_EFFORT` were all checked), and Claude Code shows its own above the prompt, so binnacle leaves it out until the first turn reports it.

## 0.5.1

- **Flow after `/clear`:** the tab empties at once instead of showing the old session's calls until the first prompt.
- **A call cut off by the end of its turn** (main's, or its agent's) ends with it: no longer drawn as running, and the tab stops redrawing every second.
- **Decisions told apart:** a refused ask says who refused it (`you`, `auto`, `hook`); a deny with no rule or hook behind it counts as `auto → deny`; an ask approved whose tool then failed counts as approved.
- **Cards of one row are as tall as the tallest.**
- **The footer's `☰ binnacle ●N`** counts the agents drawn as cards (not ones another agent spawned), and closes the panel when it already shows Flow.
- **Your own prompt with an agent prompt's very words** still counts as a turn.
- **Two redraws per tool call**, not three: a check's tally waits for its call to end.

## 0.5.0

- **Flow tab:** this turn drawn live, main and the agents it spawned as cards with their newest tool calls, a fork and a join, this turn's decisions as one bar, warnings (the same error twice, two refusals in a row, an agent quiet for two minutes, context from 80%) and the last five events. Calls are held in memory only. `/binnacle flow`; the footer's `☰ binnacle ●N` opens it while agents run.
- **A subagent's own turn no longer counts as a turn of main:** on Claude Code 2.1.299 and 2.1.300 (seen from 2026-10-14) a subagent's loop fires `turn.start` with its prompt and no agent id; binnacle recorded each as a new turn, so Activity numbered turns too high and "this turn" (Agents, Flow) jumped to the agent's prompt. A `turn.start` whose text is the prompt of an agent spawned in the last minute is now set aside.

## 0.4.2

- **Section headings keep their title whole:** a long summary is cut at its end instead of cutting the title (`Compa…`).
- **A session keeps up to 3 MiB of history (was 512 KiB), 100 MiB in all:** sizes are counted in UTF-8 bytes, as the 4 MiB file limit is, so CJK text cannot push a record past it. Past 100 MiB of saved sessions the oldest go, beside the 500-session and 90-day limits.
- **Tool calls no longer slow down as the record grows:** the live record is held in binnacle's own code instead of `$.state`, whose every write copied the whole record (measured about 25 ms per MiB on each tool call, so about 13 ms at the old 512 KiB and 75 ms at 3 MiB; now about 1 ms at any size). It is written to its file after each turn, after a compaction and at the session's end; reloading binnacle's code mid-turn loses that turn's entries so far.
- **Activity and Agents draw in time linear in the record:** each turn and agent no longer scans every event (3.5 MiB: Activity 233 → 39 ms, Agents 45 → 5 ms of computing).

## 0.4.1

- **Permissions in the Context block's look:** *Permission checks* and *Who decided* each draw one bar split by share, with a coloured legend of counts and shares (two columns when they fit), instead of a bar per row.

## 0.4.0

- **Install only the plugin:** the plugin moved to `plugin/` and the marketplace lists it with `"source": "./plugin"`, so an install copies only that folder; the READMEs and `docs/` (design notes and plans) stay in the repository. Development commands run in `plugin/`.
- **Who decided:** Permissions has a new section that says, for this session, how many permission checks you allowed or denied in the dialog, how many auto mode's classifier allowed or denied, and how many the mode, rules or hooks settled. It is read from the transcript (`permissionDecision`), so it covers the whole session and lasts across restarts.
- **Alerts are toasts:** a limit passing 90% and the context passing 80% (and 90%) show a toast once, for 10 seconds, instead of a line under the status line; a refused command shows as `⚑ guard N`. Plugins' `$.binnacle.attention` items are toasts too, under the plugin's name.

- **Activity history in files, kept longer:** each saved session is now its own file in binnacle's data directory, `~/.claude/plugins/data/binnacle-binnacle/sessions/<session id>.json`; the plugin store keeps only the index and your settings. The 3.5 MiB cap on all history is gone: sessions started more than 90 days ago are deleted, and at most 500 are kept, the oldest dropped first (the current session never is). Each session is still kept under 512 KiB.
- **Moving from earlier versions:** sessions saved in the store are moved to their files once, in the background after a session starts; one that fails to move stays in the store, is still shown, and is tried again at the next start.
- **Deleting** a saved session (eviction, *Delete this saved session*, `/binnacle activity clear`) runs `rm -f` on that one file, and only for a session id made of letters, digits, `_` and `-`. If HOME is unknown or the data directory is not writable, binnacle says so once and keeps recording in memory.
- **Uninstall** leaves `~/.claude/plugins/data/binnacle-binnacle/` beside the store file; the README shows how to remove both.

## 0.3.9

- **Search:** the Find field keeps the query after Enter (Claude Code empties a field on Enter; it is now drawn again with the query, the focus still on it).
- **README images** live on the `assets` branch, so installing the plugin no longer downloads them.

## 0.3.8


## 0.3.7


## 0.3.6

- **`☰ binnacle` on the status line** opens the panel, and closes it when it is up: no need to type `/binnacle`. At its shortest it is `☰` and it is never dropped, so it is still there while the open panel narrows the line.

## 0.3.5

- **Compaction count easier to see:** `⇣N` stays on the status line when the context figures shorten (it goes only with the narrowest `ctx NN%`), and Overview's session card has a `compact N` line at the top.

## 0.3.4


## 0.3.3

- **Model and effort are back on the status line**, in colour, on the row Claude Code starts with its mode label: `⏵⏵ auto mode on · Opus 5.5 · high · ctx …`. Click the model or the effort and Claude Code's own `/model` or `/effort` picker opens: every model it offers (a plugin cannot list them, so the old list showed only aliases), Enter to make it your default, `s` for this session only, Esc to keep it. The switcher row above the prompt is gone: binnacle draws nothing there.

## 0.3.2

- **Search:** Enter on a result shows the whole message under it, with its time and turn (and the turn's prompt for a reply), instead of leaving for Activity, where a long session's turn was not scrolled into view. *Open turn in Activity* under it still goes there.

## 0.3.1


## 0.3.0

- **Switcher above the prompt.** The one thing binnacle draws there: the model and the effort, `Opus 5.5 · high`. Click a part and it turns into a list; click the list to open it and pick with ↑↓ and Enter. The pick runs `/model <alias>` or `/effort <level>` at once — **and Claude Code saves it as your default for new sessions, in `~/.claude/settings.json`**; a plugin has no session-only way. Esc, or 15 seconds with no pick, keeps the old value. The permission mode stays Claude Code's own label, changed with shift+tab: a plugin can neither read the mode nor hide that label. The status line no longer repeats model and effort. Until the first turn reports an effort the part reads `—`, while Claude Code may show its own effort hint nearby. The switcher belongs to the status line module: `binnacle: status line` off removes it too.
- **5h and 7d limits** are coloured in four bands: green under 50%, the accent colour from 50%, yellow from 80%, red from 90%. Context keeps yellow at 80% and red at 90%.
- **Compactions** are counted: live (trigger, tokens before and after, duration) and from the transcript's own records, in Overview, in Activity (`⇣ compacted · auto 121k → 57k`) and as `⇣N` on the widest status line. Settings → History can count them across forks.
- **Search** (`f`, `/binnacle search <words>`): fuzzy search over the transcript of this or a saved session (the newest 24 MiB, at most the newest 20,000 messages and tool calls), indexed in memory and brought up to date when you search, reading only what was added (with `perl`, read-only: about 0.2 s for 24 MB in our measurements); Enter opens the matching turn in Activity. Likely secrets are masked before indexing, on a best-effort basis.
- Hand-backs while the session is busy, measured: Claude Code queues the background agent's hand-back into the running turn (its `prompt.submit` carries that turn's id, and no turn start follows); a hand-back whose submission ends before its turn starts still counts as a hand-back; a foreground agent cut off with its turn shows `unfinished`, not `running`; a `/loop` turn starts a new "this turn" (shown `⟳ /loop · …`); the permission tally no longer goes back when two checks finish out of order.
- Masking (Activity and Search) knows more shapes: PEM blocks, quoted keys, AWS access key ids, known token prefixes, secrets in URL queries, Slack webhooks, `private_key` / `credentials`, and tokens inside URL paths. It is still best effort; see SECURITY.md.
- Activity and Agents: an agent row with no end event is no longer coloured; only a running one is blue. A foreground agent left without an end when its turn ended shows `unfinished` (with no duration in Agents) instead of `running`.
- The empty cells of every bar (context and limits on the status line, the limit bars on Overview, the Permissions counts) are drawn in the theme's subtle colour, whatever the colour of the filled part.
- Permissions & guard: an ask you refused counts once, as blocked, so `blocked · asked · auto` adds up to the records listed.
- Diff: the file list takes the room the selected file's code does not need, so a long list in a wide pane is no longer cut at half the page.
- Compactions: a sub-agent's compaction is not added to "in this file" (its record is in another file), a transcript record with no time is skipped, and two compactions run back to back are both counted while the second one's record is still being written. Counting across forks says `earlier sessions not found` when it stops at its 10-file limit.
- Search: when its time budget stops a search early, the info line says so (`stopped early · newest N rows searched`).
- Masking: a Slack webhook stops at a quote or bracket (the JSON around it stays), `password=a&b` is masked whole, and a short capitalised word before a long token no longer makes it read as a path.
- A rule another plugin registers needs the action `deny`, `ask` or `rewrite`; any other is not added (and logged once), and Settings draws a rule's action made visible and cut to the row.
- When the model is locked by managed settings, the switcher shows it as plain text with no picker.
- With the panel closed, the end of a turn no longer re-runs the last Search query.
- Requires Claude Code 2.1.296 or later (was 2.1.287): v0.3's host behaviours were measured on 2.1.296 only.

## 0.2.1

- After `/clear` or an in-process `/resume <id>`, the status line, the settings and the session's Activity record come back at once instead of at the next prompt. Claude Code starts a plugin's in-memory state over at both, without a `session.start`; binnacle now loads it back as soon as anything draws.
- A settings change (Settings tab, `/binnacle status`, `/binnacle guard`) is made on the stored settings, so one made after `/clear` no longer saves the defaults over them and turns a guard rule you had turned off back on.
- **Permissions & guard** counts permission checks for the whole Claude Code process, as it says, instead of starting over at `/clear`.
- Guard rules that other plugins register come back after `/clear`, in Settings and `/binnacle guard list`.
- Settings: the status-line items wrap onto more rows at the default panel width, so `cwd` (the last item) is no longer cut off.
- Command replies (`/binnacle status`, `guard`, `activity clear`) show `binnacle:` once; Claude Code already adds it, and the replies had added it again.
- `/binnacle activity clear` asks with **Cancel** as the first option, so a stray Enter deletes nothing.
- Diff: while the Source picker has focus it takes the keys, so `r` does nothing there. The tab now says `Tab, then r refreshes`.
- The `✓ … done … ago` row for a finished background agent (now in the Agents tab) shows. Claude Code 2.1.296 starts a turn of its own to hand the agent's report back about 150 ms after the agent ends, and that turn used to clear the row before it was drawn. The live rows now count from the latest turn you started (a prompt from you, or a plugin's sent as your own words; not a hand-back or another session's message), or from the newest turn when you started none, and the same goes for `✗ … denied this turn`.
- Activity opens the latest turn you started as well as the newest one, so the turn holding a background agent is no longer collapsed under the hand-back turn that came after it.
- Activity labels a hand-back turn `↩ agent hand-back · <agent> · <task>` instead of its raw `<task-notification>` or `<agent-message …>` text (kept in the turn's details), and a hand-back turn no longer becomes a saved session's name in the Session list.
- A subagent's call you refuse in its approval dialog is recorded as one denial (`✗ asked → you denied`, `✗ 1 denied this turn`). Claude Code answers a subagent's refused call with a different text from the main conversation's, so binnacle recorded an unknown `? asked` and an error as well.
- Claude Code 2.1.296 summarises a running background agent in a loop of its own that refuses every tool with `No tools needed for summary`. binnacle recorded that refusal as an error of the main conversation (`! Bash · No tools needed for summary`, counted in `✗ … errors this turn`); it no longer records it. Every other failed call is still recorded, from that kind of loop too.
- New **Agents** tab beside Activity (`g`, or `/binnacle agents`): what runs now on top (running subagents, one waiting on approval for 3 s or more, background agents that just finished, this turn's denials and errors), then every agent of the chosen session, newest first (at most 400, the rest counted), with its duration, steps and outcome; Enter shows its task, tools, denials, errors and answer. It redraws once a second only while it is the tab drawn and a row on it is running, waiting or just finished.
- binnacle no longer draws anything above the prompt: its interface is the status line below the prompt (with its attention lines) and the panel. The rows that were drawn above the prompt are on top of the Agents tab, and the timers that redrew them (every 5 seconds, and 3 seconds after a subagent's ask) are gone.
- Activity: the Session list offers This session and the 63 newest saved sessions. Claude Code refuses a list of more than 64 options, which left the whole panel blank once more than 63 sessions were saved.
- Diff: the Source list offers Workspace and the 63 newest turns that edited files. Claude Code refuses a list of more than 64 options, which left the whole panel blank in a session with 64 or more such turns; a turn past the list falls back to Workspace.

## 0.2.0

- Activity: every turn, the agents it started, permission and guard decisions, errors and file edits are recorded as one stream, nested turn → agent. Saved in the plugin store (masked, capped at 3.5 MiB including the index and at most 500 sessions; the oldest sessions are dropped first; a session with no turn is not saved), kept across `--resume` and `--continue`.
- Above the prompt: running subagents with elapsed time and steps, an agent whose call has been waiting on approval for 3 seconds or more, finished background agents, and this turn's denials and errors. Nothing is drawn when there is nothing to show.
- `/binnacle` gains **Activity** (tree, details, saved sessions; `/binnacle activity`, `/binnacle activity clear`) and **Diff** (working tree against `HEAD`, or one turn's edits; `/binnacle diff`).
- `/binnacle` Settings says under each built-in guard rule what it covers, and what deny and ask mean.
- When the status line does not fit on one line it wraps to two lines in full before shortening anything (for example while the `/binnacle` panel is docked).
- The status line's `ctx` bar is coloured by context category, with the largest category in the widest form.
- The `/binnacle` overview's context bar fills exactly the pane width and has a legend: each category's colour, tokens and share of the window, in two columns when they fit.
- The status line shows the time left until each limit resets (`↻2h10m`, `↻2d4h` for 7d); the attention line shows the clock time plus the countdown (`resets 14:30 (in 1h5m)`), and the `/binnacle` overview shows `↻14:30 (in 1h5m)`.
- `$.binnacle.attention` and `$.binnacle.tab` let other plugins add attention lines and tabs; each can be turned off per plugin in Settings.
- The guard log, the permission page and the last-turn receipt now read from the activity stream; the guard's rules and asks are unchanged.

## 0.1.0

- Adaptive status line below the prompt: model, effort, context, 5h/7d limits, duration, cost and this turn's cost, directory; attention line for limits, context and blocked commands.
- Guard with packs `files`, `git`, `k8s`, `sql`; asks only for unrecoverable loss (targets outside the project, protected branches) through Claude Code's dialog with read-only previews; an ask whose preview shows nothing would be lost runs as `auto-allow`.
- `/binnacle` panel: overview with context breakdown, permissions & guard, settings.
- `$.binnacle` noun for rule packs; example pack.
