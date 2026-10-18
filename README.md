English | [简体中文](README.zh-CN.md)

# binnacle

An all-in-one [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview): an adaptive status line below the prompt whose model and effort open Claude Code's own pickers, guards that stop risky commands before they run, and a panel that shows what runs now, what each turn and agent did, and the whole transcript to search. Plugins add more through its [plugin interface](docs/plugins.md): rule packs of your own.

![binnacle: the status line, the panel and its tabs](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/demo.gif)

## Install

Requires Claude Code 2.1.296 or later.

binnacle and its plugins install from the binnacle marketplace:

```
claude plugin marketplace add mkloveyy/binnacle-marketplace
claude plugin install binnacle@binnacle
```

Then run `/reload-plugins` in Claude Code (or restart it). To update later:

```
claude plugin marketplace update binnacle && claude plugin update binnacle@binnacle
```

Every catalog entry is pinned to a commit, so an update installs exactly the release the marketplace lists.

## Uninstall

```
claude plugin uninstall binnacle@binnacle
claude plugin marketplace remove binnacle
```

Then run `/reload-plugins` (or restart). This removes the plugin, its `/config` options, its saved Activity sessions (`~/.claude/plugins/data/binnacle-binnacle/`; add `--keep-data` to `uninstall` to keep them) and the marketplace entry, with every plugin installed from it. Your panel settings and the history's index stay in `~/.claude/plugins/store/binnacle_binnacle-*.json`, and the downloaded copy in `~/.claude/plugins/cache/binnacle/`:

```
rm -f ~/.claude/plugins/store/binnacle_binnacle-*.json
rm -rf ~/.claude/plugins/cache/binnacle
```

## Modules

Both modules are on by default; turn either off in `/config`: `binnacle: status line` (the status line, its model and effort buttons, and what plugins add to it) and `binnacle: guard`. Plugins are switched in Settings → Plugins.

### Status line

![The status line, and binnacle's buttons at the right of the footer](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/statusline.png)

Drawn below the prompt, after Claude Code's mode label. It fits itself to the terminal width: wide terminals get one line with bars; when that does not fit it wraps to a second line with everything still in full, and only past two lines does it switch to shorter forms.

| Item | Source |
|---|---|
| Context | tokens used, window, percent |
| 5h / 7d limits | subscription usage windows, with the time left until each window resets |
| Duration and cost | session start, total cost and this turn's cost |
| Directory | current directory, shortened |

**Model and effort.** The status line starts with them, in colour, on the row Claude Code begins with its mode label: `⏵⏵ auto mode on · Opus 5.5 · high · ctx …`. Click the model and Claude Code's own `/model` picker opens (every model it offers; Enter makes the pick your default, `s` uses it for this session only, Esc keeps it); click the effort and its `/effort` slider opens the same way. Each opening leaves a `/model` or `/effort` line in the transcript. A model your organisation's policy locks is drawn as text. An effort picked there shows once the next turn reports it. Before the first request no plugin API gives the effort, so until then it is left out (Claude Code shows its own above the prompt); the context shows from the start, counted as `/context` counts it. The permission mode stays Claude Code's own label, changed with shift+tab. Settings → Status line → `model` and `effort` show or hide the two parts. At the right of the footer, after Claude Code's own mode labels, binnacle adds `⚑ guard N` once its guard has refused N commands in this session (opens the panel on Permissions, where they are listed), the buttons plugins add (such as the example rule pack's `⚑ pack`), and `☰ binnacle` (opens the panel, or closes it when it is up). binnacle draws nothing above the prompt.

**Plugin lines.** A plugin can add a part to the end of the status line (dropped first when the line is short of room) and a line under it.

**Compactions.** Once the session has compacted N times the status line shows `⇣N` after the context figures (before `· msgs NN%`), in every form but the narrowest `ctx NN%`, and Overview's session card has a `compact N` line.

The 5h and 7d limits are coloured by how much is used: green under 50%, the accent colour from 50%, yellow from 80% and red from 90% (the theme's success, suggestion, warning and error colours). Context turns yellow at 80% and red at 90%. When a limit passes 90%, or the context passes 80% (and again at 90%), a toast says so for 10 seconds, once; it comes again only after the figure dropped back and passed the mark again. A command the guard refused shows as `⚑ guard N` at the right of the footer. The status line shows how long until a limit resets (`↻2h10m`, and `↻2d4h` for the 7-day limit); the limit toast shows the clock time plus the countdown (`resets 14:30 (in 1h5m)`), and the `/binnacle` overview shows `↻14:30 (in 1h5m)`.

When the context breakdown is known (after the first turn), the `ctx` bar is split by category in the same colours as the `/binnacle` overview, and the widest form names the largest category, for example `ctx ███░░░░ 412k/1M 41% · msgs 75%`.

If you used `statusLine` before, remove it from your settings so the information is not shown twice.

### Guard

![The guard asks before git checkout -- . and lists the changes that would be lost](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/guard-ask.png)

| Pack | Rule | Action |
|---|---|---|
| files | `rm -r` with a target outside the project (or the project root itself), or fed by `xargs`, or run after `cd` / with `env -C` / `sudo -D`, or through `sudo` / `doas` (always asks); `find … -delete` or `-exec rm -r` starting outside the project, or at the project root (`find .`, `find *`) without a `-name` / `-iname` / `-path` / `-ipath` / `-regex` / `-iregex` / `-wholename` / `-iwholename` filter (or in any of those situations); any target or start path that is `.git` or inside it, even within the project; a `find … -delete` or `-exec rm -r` with a `-name` / `-path` filter aimed at `.git` also asks, even at the project root; `git clean -f` | ask, with the files that would be deleted |
| git | `git push --force` or `+ref` to `main`, `master`, `release*`, `HEAD` or no named branch (always asks) | ask, with the commits the remote would lose |
| git | `git reset --hard`, `git checkout -- <paths>`, `git checkout .`, `git restore` (not `--staged` alone) | ask, with the changes that would be lost |
| k8s | `kubectl … -A`, list without a name or selector | deny |
| k8s | `kubectl delete` | deny: every one, wrapped or with another cluster's config; run it yourself if it is needed |
| sql | UPDATE / DELETE without `WHERE`, or SELECT … FROM without `WHERE` (a plain `LIMIT n` sample passes), in `sql`, `query` or `statement` values of MCP tool arguments | deny |

“Ask” opens Claude Code's own question dialog. Choosing **Deny**, closing the dialog, or running headless (`-p`) refuses the call; text typed under **Other** is passed to Claude as your reason. The guard only interrupts for loss that cannot be undone: if the read-only preview shows nothing would be lost, the call runs without asking and is logged as `auto-allow`. If the preview cannot run, it still asks. Force pushes to protected branches always ask, since the remote-tracking ref may be stale. Auto-allow only applies to a plain top-level command on a line of its own (a line holding several commands always asks): wrappers such as `sudo`, `doas`, `env` or `xargs`, nested shells, or an earlier `cd`/`export` make binnacle ask without a preview. After `cd`, or with `xargs`, `env -C`, `sudo`/`doas`, `GIT_DIR` or `git -C`, the location or user is unknown, so these ask without a preview.

The shell parser understands quotes, heredocs, comments, `sudo`/`env`/`timeout`/`xargs` prefixes and `bash -c`/`eval`. It does not expand variables, aliases or command substitution inside double quotes, so treat the guard as a seatbelt, not a sandbox. Path checks are lexical: symlinks are not resolved, and a session started in `$HOME`, above it, or in `/` has no safe zone, so every delete target there counts as outside the project.

## Activity

binnacle records each turn, the subagents it started, permission and guard decisions, errors and file edits as one stream, nested turn → agent.

binnacle draws nothing above the prompt: Claude Code shows its own agents there. The **Agents** tab of the panel starts with **Now**, what runs now (its heading counts `N running · N waiting`):

| Row | Meaning |
|---|---|
| `● Explore   find store writes   1m02s   12 steps` | a subagent is running |
| `⏸ Explore   approval? rm -rf /tmp/x   12s` | one of its calls was put to approval 3 or more seconds ago and has not finished. No API says when an ask is settled or what the permission mode is, so when the session's latest settled ask was the auto-mode classifier's, an ask open 15 seconds or more counts as approved and its call as running |
| `✓ Explore   find store writes   done 25s ago` | a background agent finished since your last prompt (kept through the turn Claude Code starts to hand its report back; cleared at your next prompt) |
| `✗ 2 denied · 1 error this turn` | denials and errors since your last prompt, the hand-back turns included |

With none of these it says `no agents running`. Below them, in a pane of 60 columns or more, the **Timeline** draws the newest 8 agents (4 below 70 columns), one lane each: a `━` bar over the time the agent ran, each turn's start marked `#N` above, the bar in the focus colour while running, dimmed when done, red when it failed or had a call refused; its state and duration at the right. A saved session's timeline ends at its last event. Then **History**: every agent of the session, newest first (at most 400; the rest are counted), in columns: type, task, duration, steps, outcome (`✓ done`, `✗ 1 denied · 2 errors`, `running`, `unfinished`); Enter shows its task, tools, denials, errors and the first lines of its answer. The tab redraws once a second while it is the tab drawn and one of these rows is running, waiting or counting `done … ago`.

Limits: Claude Code tells a plugin that a call was put to approval, not who answers it, so binnacle cannot tell a dialog still waiting from the auto-mode classifier still deciding, or from an approved call that is now running; the `⏸` row stays until the call ends. Only subagents' asks get a `⏸` row; the main conversation's own asks are recorded in Activity once the call ends, like any other. A denial is attributed to you or to the classifier from the error text, on a best-effort basis; an approval by you and by the classifier look the same.

The history is kept in binnacle's own data directory, one file per session in `~/.claude/plugins/data/binnacle-binnacle/sessions/`, with its index in the plugin's store: the first 120 characters of each prompt, agent tasks and the first five lines of their reports, decisions, command summaries, and file names with line counts. Likely secrets are masked before saving. `--resume`, `--continue` and `/resume` inside Claude Code pick up the same session; `/clear` starts a new one. One session's record is kept under 3 MiB: past it, its oldest permission, guard, error and edit entries go first, its turns, agents and compactions stay. Sessions started more than 90 days ago are deleted, and at most 500 are kept, 100 MiB in all, the oldest dropped first; the current session is never dropped. While Claude Code runs, the record is held in memory and written to its file after each turn, after a compaction and when the session ends. A session with no turn is not saved. Sessions saved in the store by earlier versions are moved to their files once, in the background, at the first start.

### Compactions and search

Each compaction is recorded (manual or auto, tokens before and after, how long) and the transcript's own compaction records are counted: Overview → Compactions shows the count and the latest five. A forked or handed-off session's file may start with the compaction it was copied from; Overview says so. Settings → History → *count compactions across forks* follows the fork chain and counts each compaction once (it reads the earlier sessions' transcript files).

The **Search** tab searches the whole transcript of this session, or of a saved one, with fuzzy matching (whole words first, then word starts, substrings, and letters in order). Of a transcript over 24 MiB it reads only the newest 24 MiB (with `perl`, read-only) and says so (`last 24 MB of …`). It indexes the newest 20,000 messages and tool calls, each cut to 2,000 characters, and shows at most 400 results. A search that takes more than 50 ms stops early and says so (`stopped early · newest N rows searched`). The index is kept in memory only and brought up to date when you search, reading only what was added. Enter on a result shows the whole message under it (with its time and turn, and for a reply the turn's prompt), and Enter again closes it; the button under it, *Open turn in Activity*, opens that turn there. Text is masked before it is indexed or shown, on a best-effort basis. The Find field takes the focus, so letters type into it rather than switch tabs; Tab moves on to the Session list and the results.

### Diff

The Workspace view in the Diff tab is `git diff-index -p -M HEAD` plus the untracked files from `git status --porcelain`. It is read-only and never writes the index; the exact arguments are in [SECURITY.md](SECURITY.md). Untracked files are listed by name only. At most 90,000 drawn characters are shown per file; a longer diff is cut at a whole hunk and ends with `… N more hunks`. Control characters are shown as stand-ins, so a file with CRLF line endings shows `^M` at the end of each line.

## Panel and commands

| | |
|---|---|
| ![Overview](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/overview.png) | ![Activity](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/activity.png) |
| ![Agents](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/agents.png) | ![Diff](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/diff.png) |
| ![Search](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/search.png) | ![Permissions](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/permissions.png) |

`/binnacle` opens the panel (docked beside the transcript in fullscreen). Tabs: **Overview** (status, context breakdown by category with a colour legend giving each category's tokens and share of the window, last turn), **Permissions** (page title `Permissions & guard`; permission checks since Claude Code started, guard decisions in this session), **Settings** (every status item, guard rule and plugin, click or Enter to toggle, the status items wrap to fit the pane; each built-in guard rule has a line saying what it covers), **Activity** (turns and their agents, the newest turn open, and the latest turn you started too when Claude Code's hand-back turns came after it, which show as `↩ agent hand-back · <agent>`; Tab moves between rows, Enter expands and shows details; the Session list switches to a saved session), **Agents** (beside Activity: what runs now on top, a timeline of the newest agents, then every agent of the session, newest first, in columns of type, task, duration, steps and outcome; Enter shows its task, tools, denials, errors and answer; the same Session list), **Diff** (the working tree against `HEAD`, or the files one turn edited, drawn with Claude Code's own diff highlighting; `r` refreshes once Tab has moved focus off the Source picker). In fullscreen the panel shares the dock with Claude Code's `/diff`; `ctrl+x ←` widens it and Claude Code remembers the width.

**Flow** (beside Agents) draws this turn live: main as a card with its newest three tool calls, the agents main spawned as cards side by side (three to a row) with theirs, finished ones on one line, then this turn's decisions (allowed by rules, by a hook or automatically, asked and how it ended, denied), anything that looks wrong (the same error twice, two refusals in a row, an agent quiet for two minutes, context from 80%) and the last five events. It redraws every second while something runs. The tool calls it shows are kept in memory only, never saved, and start over with each turn you start. `auto` is the permission mode or the classifier: live, the two look alike; Permissions → Who decided tells them apart from the transcript. Below 80 columns it is a tree. `/binnacle flow` opens it; while agents run, the footer's `☰ binnacle ●N` opens it too.

![The Flow tab: main, three Explore agents side by side with their newest calls, this turn's decisions and the log](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/flow.png)

**Search** (`f`): see above.

```
/binnacle activity                   # open on the Activity tab
/binnacle activity clear             # delete saved sessions except this one (asks first; Cancel is the first option)
/binnacle flow                       # open on the Flow tab
/binnacle agents                     # open on the Agents tab
/binnacle diff                       # open on the Diff tab
/binnacle search [words]             # open on the Search tab and search
/binnacle status show|hide <item>    # model, effort, context, limits, duration, cost, cwd
/binnacle guard on|off <rule>
/binnacle guard list
```

## Plugins

A plugin is a separate Claude Code plugin that lists binnacle as a dependency and adds to binnacle through `$.binnacle`: a footer button, a part of the status line or a line under it, a setting, a tab with rows, buttons and aligned columns, an attention toast, rules for the guard, or the prefix its own guard's denials carry. binnacle draws everything and tells the plugin through `binnacle.notify` when you use it; each plugin's additions can be turned off in Settings → Plugins. How to write one: [docs/plugins.md](docs/plugins.md); a template and an example rule pack are in the marketplace repository. A plugin is published from its author's own repository, which is its own marketplace: nothing in binnacle changes, and listing it in binnacle's marketplace is optional.

## What it can reach

No network. binnacle itself writes no files of yours, only its own saved sessions under `~/.claude/plugins/data/binnacle-binnacle/`. Clicking the model or the effort on the status line runs Claude Code's `/model` or `/effort` picker, where Enter saves the pick as your default in `~/.claude/settings.json` and `s` keeps it to this session. It reads this session's transcript for Search and the compaction count. Plugins are code of their own: what one can reach is in its README. See [SECURITY.md](SECURITY.md).

## Development

The plugin itself is in `plugin/`: that folder is all an install copies. The rest of the repository (the READMEs, `docs/`) stays out of installs, and the README's images live on the `assets` branch.

```
plugin/
  .claude-plugin/plugin.json   the plugin manifest
  hooks/                       register.tsx (all wiring) and modules/ (pure code)
  types/                       the plugin's types contract
  tests/                       claude plugin test runs every *.test.ts here
docs/                          plugins.md (the plugin interface), the e2e checklist
```

```
cd plugin
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## Credits

The shell parser follows the approach of merge-gate in [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods). The panel took ideas from [scasella/claude-flightdeck](https://github.com/scasella/claude-flightdeck), and the context breakdown from context-bar in the same hamzafer collection.

## License

MIT
