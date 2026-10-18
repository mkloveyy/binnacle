[English](README.md) | 简体中文

# binnacle

一个 all-in-one 的 [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview)：输入框下方的自适应状态行（点其中的模型、档位打开 Claude Code 自带的选择器）、在危险命令执行前拦下它的守卫，以及一个详情窗口：正在发生什么、每一轮和每个 agent 做了什么、可搜索的完整对话。更多功能由插件通过它的[插件接口](docs/plugins.zh-CN.md)加进来：你自己的规则包。

![binnacle: the status line, the panel and its tabs](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/demo.gif)

## 安装

需要 Claude Code 2.1.296 或更高版本。

binnacle 和它的插件都从 binnacle 市场安装：

```
claude plugin marketplace add mkloveyy/binnacle-marketplace
claude plugin install binnacle@binnacle
```

然后在 Claude Code 里执行 `/reload-plugins`（或重启）。以后更新：

```
claude plugin marketplace update binnacle && claude plugin update binnacle@binnacle
```

市场目录里的每一条都固定到某个提交，所以更新时装的就是市场列出的那个版本。

## 卸载

```
claude plugin uninstall binnacle@binnacle
claude plugin marketplace remove binnacle
```

然后执行 `/reload-plugins`（或重启）。这会移除：插件本身；它在 `/config` 里的选项；保存的 Activity 会话（`~/.claude/plugins/data/binnacle-binnacle/`，`uninstall` 时加 `--keep-data` 可以保留）；市场登记，以及从这个市场装的所有插件。

以下内容会保留：详情窗口的设置与历史索引，在 `~/.claude/plugins/store/binnacle_binnacle-*.json`；下载的插件副本，在 `~/.claude/plugins/cache/binnacle/`。要彻底清除，再执行：

```
rm -f ~/.claude/plugins/store/binnacle_binnacle-*.json
rm -rf ~/.claude/plugins/cache/binnacle
```

## 模块

两个模块默认都开启，可在 `/config` 里分别关闭：`binnacle: status line`（状态行、其中的模型与档位按钮，以及插件加到状态行的内容）和 `binnacle: guard`。插件在 Settings → Plugins 里开关。

### 状态行

![状态行，以及输入框下方右侧的 binnacle 按钮](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/statusline.png)

画在输入框下方、Claude Code 的模式标签之后，并按终端宽度自适应：宽终端一行带进度条；一行放不下时先折成两行，内容保持完整写法；两行也放不下才换成更短的写法。

| 信息 | 来源 |
|---|---|
| 上下文 | 已用 token、窗口大小、百分比 |
| 5 小时 / 每周额度 | 订阅额度，显示距各窗口重置还剩多久 |
| 时长与费用 | 会话开始时间、累计费用与本轮费用 |
| 目录 | 当前目录（自动缩短） |

**模型与档位**。状态行以它们开头，带颜色，与 Claude Code 的模式标签同一行：`⏵⏵ auto mode on · Opus 5.5 · high · ctx …`。点模型打开 Claude Code 自带的 `/model` 选择器（列出它提供的全部型号；回车存为默认值，`s` 只用于本会话，Esc 不改）；点档位同样打开 `/effort` 滑杆。每打开一次，对话里留一行 `/model` 或 `/effort`。被组织策略锁定的模型只显示文字。在那里选的档位要等下一轮报告后才显示。第一次请求之前，插件接口拿不到档位，所以这段先不显示（Claude Code 自己会在输入框上方显示）；上下文则从一开始就显示，按 `/context` 的口径统计。权限模式仍是 Claude Code 自己的标签，用 shift+tab 切换。Settings →「Status line」下的 `model`、`effort` 两项控制这两段。输入框下方右侧、Claude Code 自己的模式标签之后，binnacle 加了几个按钮：`⚑ guard N`（本会话守卫拒绝过 N 条命令时出现，点它打开详情窗口的 Permissions 页签查看）、插件加的按钮（如示例规则包的 `⚑ pack`）、`☰ binnacle`（打开详情窗口，已打开时关闭）。binnacle 不在输入框上方绘制任何内容。

**插件的状态段与整行**。插件可以在状态行末尾加一段（空间不够时最先省略），也可以在状态行下方加一整行。

**压缩**。会话压缩过 N 次后，状态行在上下文数字后面（`· msgs NN%` 之前）加 `⇣N`，除了最窄的 `ctx NN%` 写法都保留；Overview 顶部的会话卡片里也有一行 `compact N`。

5h 与 7d 额度按已用比例上色：50% 以下绿色，50% 起为强调色，80% 起变黄，90% 起变红（主题的 success、suggestion、warning、error）。上下文达到 80% 变黄、90% 变红。额度越过 90%、上下文越过 80%（以及再越过 90%）时，弹出一条 toast 提醒，停留 10 秒，只弹一次；回落后再次越过才会再弹。守卫拦下的命令显示在输入框下方右侧的 `⚑ guard N`。状态行显示距额度重置还有多久（`↻2h10m`，每周额度如 `↻2d4h`）；额度提醒给出重置时刻和倒计时（`resets 14:30 (in 1h5m)`），`/binnacle` 的 Overview 显示为 `↻14:30 (in 1h5m)`。

拿到上下文明细后（第一轮之后），`ctx` 进度条按类别分段上色，配色与 `/binnacle` 的 Overview 一致；最宽的写法还会标出占比最大的类别，例如 `ctx ███░░░░ 412k/1M 41% · msgs 75%`。

如果之前配置过 `statusLine`，可以从设置中删掉，避免重复显示。

### 守卫

![执行 git checkout -- . 之前守卫先询问，并列出会丢失的改动](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/guard-ask.png)

| 包 | 规则 | 处理 |
|---|---|---|
| files | `rm -r` 的某个目标在项目外（或就是项目根）、来自 `xargs`、在 `cd` 之后、带 `env -C` / `sudo -D`，或经 `sudo` / `doas` 执行（一律询问）；起始路径在项目外、或就是项目根（`find .`、`find *`）却没有 `-name` / `-iname` / `-path` / `-ipath` / `-regex` / `-iregex` / `-wholename` / `-iwholename` 过滤（或处于上述任一情形）的 `find … -delete` / `-exec rm -r`；目标或起始路径是 `.git` 或位于其中时，即使在项目内也询问；带有指向 `.git` 的 `-name` / `-path` 过滤的 `find … -delete` / `-exec rm -r` 也询问，即使起点是项目根；`git clean -f` | 询问，并列出将被删除的文件 |
| git | `git push --force` 或 `+ref` 到 `main`、`master`、`release*`、`HEAD` 或未写明分支（始终询问）| 询问，并列出远端会丢失的提交 |
| git | `git reset --hard`、`git checkout -- <paths>`、`git checkout .`、`git restore`（单独的 `--staged` 除外） | 询问，并列出会丢失的改动 |
| k8s | `kubectl … -A`、不带名字也不带 selector 的列表 | 拒绝 |
| k8s | `kubectl delete` | 拒绝：一律拒绝，包括套了 sudo 等包装或指定了其他集群配置的；确有需要请自己执行 |
| sql | MCP 工具参数中键名为 `sql`、`query`、`statement` 的值里，不带 `WHERE` 的 UPDATE / DELETE，或不带 `WHERE` 的 SELECT … FROM（只带普通 `LIMIT n` 的取样可以通过）| 拒绝 |

“询问”使用 Claude Code 自己的提问对话框。选 **Deny**、关闭对话框或在无界面（`-p`）下运行都会拒绝这次调用；在 **Other** 中输入的文字会作为你的理由转告 Claude。守卫只在会造成无法挽回的损失时打断你：只读预览显示不会丢失任何东西时，调用直接执行并记为 `auto-allow`，不再询问；预览无法运行时仍会询问。强推保护分支始终询问（远端跟踪分支可能已过期）；只有单独成行的普通顶层命令才可能自动放行（一行有多条命令时一律询问）：`sudo`、`doas`、`env`、`xargs` 之类的包装器、嵌套 shell 或前面的 `cd` / `export` 会让 binnacle 不带预览直接询问。`cd` 之后、使用 `xargs`、`env -C`、`sudo` / `doas`、`GIT_DIR` 或 `git -C` 时位置或用户未知，会不带预览直接询问。

命令解析支持引号、heredoc、注释、`sudo` / `env` / `timeout` / `xargs` 前缀以及 `bash -c` / `eval`，但不展开变量、别名和双引号里的命令替换。请把守卫当作安全带，而不是沙箱。路径判断是纯词法的，不解析符号链接；在 `$HOME`、其上级目录或 `/` 下启动的会话没有安全区，那里的所有删除目标都按项目外处理。

## Activity

binnacle 把每一轮、它启动的子 agent、权限与守卫判定、报错和文件改动记成一条事件流，按「轮次 → agent」嵌套。

binnacle 不在输入框上方绘制任何内容：那里 Claude Code 自己会显示 agent。详情窗口的 **Agents** 页签开头是 **Now**，即正在发生的（标题行右侧计数 `N running · N waiting`）：

| 行 | 含义 |
|---|---|
| `● Explore   find store writes   1m02s   12 steps` | 子 agent 正在运行 |
| `⏸ Explore   approval? rm -rf /tmp/x   12s` | 它的某个调用已提交批准 3 秒以上且尚未结束。插件接口拿不到询问被批准的时刻，也拿不到权限模式，所以本会话最近一次被询问的调用若是 auto 模式分类器裁决的，询问超过 15 秒就视为已批准、调用正在运行 |
| `✓ Explore   find store writes   done 25s ago` | 你上次提交后结束的后台 agent（Claude Code 为交回报告自动开始的那一轮不会清除它；你下次提交时清除） |
| `✗ 2 denied · 1 error this turn` | 你上次提交以来的拒绝与报错，包括交回报告的自动轮次 |

都没有时显示 `no agents running`。其下，窗口宽 60 列及以上时画 **Timeline**：最近 8 个 agent（不足 70 列时 4 个）各占一行，`━` 条覆盖它运行的时间段，顶行在每个轮次开始处标 `#N`；运行中的条用焦点色，完成的变暗，失败或有调用被拒的为红色；右侧是状态与时长。已保存会话的时间轴止于其最后一个事件。再往下是 **History**：按时间倒序列出本会话的每个 agent（最多 400 个，其余只计数），分列显示类型、任务、时长、步数、结果（`✓ done`、`✗ 1 denied · 2 errors`、`running`、`unfinished`）；回车显示它的任务、用到的工具、拒绝、报错和回答的前几行。该页签显示期间，若上方有运行中、等待中或刚结束（`done … ago`）的行，每秒刷新一次。

限制：Claude Code 只告诉插件「这个调用已提交批准」，不告诉由谁裁决，所以 binnacle 分不出确认框还在等、auto 模式分类器还在判，还是已批准正在执行；`⏸` 行会一直显示到调用结束。只有子 agent 的询问会出 `⏸` 行；主对话自己的询问在调用结束后像其他事件一样记入 Activity。拒绝是你还是分类器作出的，只能从报错文字尽力判断；你批准与分类器批准看起来完全一样。

历史保存在 binnacle 自己的数据目录里，每个会话一个文件，位于 `~/.claude/plugins/data/binnacle-binnacle/sessions/`，索引放在插件的存储里：每条 prompt 的前 120 个字符、agent 的任务与报告前五行、各项判定、命令摘要、文件名与增删行数。疑似密钥在保存前打码。`--resume`、`--continue` 以及 Claude Code 内的 `/resume` 接着同一个会话记录；`/clear` 开始新会话。单个会话的记录不超过 3 MiB：超过时先删最早的权限检查、guard、报错和编辑记录，轮次、agent 和压缩记录保留。开始于 90 天以前的会话会被删除，最多保留 500 个会话、合计 100 MiB，超过时从最旧的删起；当前会话从不删除。Claude Code 运行时，记录保存在内存里，每轮结束、每次压缩后和会话结束时写入文件。没有任何轮次的会话不保存。旧版本存在插件存储里的会话，会在首次启动时于后台一次性移到各自的文件里。

### 压缩与搜索

每次上下文压缩都会记下（手动还是自动、前后 token、耗时），transcript 自己的压缩记录也会被数出来：Overview → Compactions 显示次数和最近五次。fork 或后台交接出来的会话，文件开头可能带着从上一个会话复制来的那一次压缩，Overview 会注明。Settings → History → *count compactions across forks* 沿 fork 链计数、每次压缩只算一次（会读取之前会话的 transcript 文件）。

**Search** 页签在本会话或某个已保存会话的完整 transcript 里做模糊搜索（先整词，再词首、子串、按序出现的字母）。超过 24 MiB 的 transcript 只读最新的 24 MiB（用 `perl` 只读地读），并注明（`last 24 MB of …`）。它为最新的 20,000 条消息和工具调用建索引，每条截为 2,000 个字符，最多显示 400 条结果。一次搜索超过 50 ms 就提前停止并注明（`stopped early · newest N rows searched`）。索引只在内存里，搜索时更新，只读新增的部分。在结果上回车，在它下方展开整条消息（时间、第几轮；回复还附上那一轮的提问），再按一次收起；展开后的 *Open turn in Activity* 按钮打开 Activity 里对应的那一轮。建索引与显示前都会打码（尽力而为）。Find 输入框获得焦点，字母键会输入到框里而不是切换页签；按 Tab 移到 Session 列表和结果。

### Diff

Diff 页签的 Workspace 视图是 `git diff-index -p -M HEAD` 加上 `git status --porcelain` 列出的未跟踪文件。它只读，从不写入索引；确切的参数见 [SECURITY.md](SECURITY.md)。未跟踪文件只列文件名。每个文件最多绘制 90,000 个字符；更长的 diff 按整个 hunk 截断，末尾显示 `… N more hunks`。控制字符以替代符号显示，所以 CRLF 换行的文件每行末尾会显示 `^M`。

## 详情窗口与命令

| | |
|---|---|
| ![Overview](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/overview.png) | ![Activity](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/activity.png) |
| ![Agents](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/agents.png) | ![Diff](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/diff.png) |
| ![Search](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/search.png) | ![Permissions](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/permissions.png) |

`/binnacle` 打开详情窗口（全屏时停靠在对话旁）。页签：**Overview**（状态、上下文按类别明细：彩色图例逐类给出 token 数和占窗口的比例，上一轮小结）、**Permissions**（页内标题 Permissions & guard；自 Claude Code 启动以来的权限判定，以及本会话的守卫记录）、**Settings**（每个状态项、守卫规则与插件，点击或回车切换，状态项按窗口宽度换行；每条内置守卫规则下有一行说明它管哪些命令）、**Activity**（轮次及其 agent，默认展开最新一轮；若其后是 Claude Code 交回报告的自动轮次（显示为 `↩ agent hand-back · <agent>`），你最后开始的那一轮也展开；Tab 在行间移动，回车展开并显示详情；Session 列表切换到已保存的会话）、**Agents**（与 Activity 并列：上方是正在发生的，中间是最近 agent 的时间轴，下方按时间倒序列出本会话的每个 agent，分列显示类型、任务、时长、步数和结果；回车显示它的任务、用到的工具、拒绝、报错和回答；同一个 Session 列表）、**Diff**（工作区相对 `HEAD` 的改动，或某一轮改过的文件，用 Claude Code 自带的 diff 高亮绘制；按 Tab 把焦点移出 Source 选择器后，`r` 刷新）。全屏时详情窗口与 Claude Code 的 `/diff` 共用停靠区；`ctrl+x ←` 加宽，Claude Code 会记住宽度。

**Flow** 页签（在 Agents 旁边）实时画出本轮：main 一张卡片，列最近三次工具调用；main 派出的 agent 并排成卡片（每行三张），各列自己的调用，完成的缩成一行；下面是本轮的决策（规则放行、hook 放行、自动放行、询问及结果、拒绝）、异常（同一错误两次、连续两次被拒、agent 两分钟没有动静、上下文到 80%）和最近五条事件。有东西在跑时每秒刷新。它显示的工具调用只保存在内存里，不写入文件，你每开始一轮就清空。`auto` 指权限模式或分类器放行，实时分不开；要区分看 Permissions → Who decided（读 transcript）。不足 80 列时画成树形。`/binnacle flow` 打开它；有 agent 在跑时，底部的 `☰ binnacle ●N` 也直接打开它。

![Flow 页签：main、并排的三个 Explore agent 及其最近的调用、本轮决策与日志](https://raw.githubusercontent.com/mkloveyy/binnacle/assets/flow.png)

**Search**（`f`）：见上。

```
/binnacle activity                   # 打开到 Activity 页签
/binnacle activity clear             # 删除本会话以外的已保存会话（先询问；第一个选项是取消）
/binnacle flow                       # 打开到 Flow 页签
/binnacle agents                     # 打开到 Agents 页签
/binnacle diff                       # 打开到 Diff 页签
/binnacle search [words]             # 打开到 Search 页签并搜索
/binnacle status show|hide <item>    # model, effort, context, limits, duration, cost, cwd
/binnacle guard on|off <rule>
/binnacle guard list
```

## 插件

插件是独立的 Claude Code 插件，把 binnacle 声明为依赖，通过 `$.binnacle` 往 binnacle 里加东西，包括：
- 底部按钮；
- 状态行里的一段，或状态行下方的一整行；
- 设置开关；
- 带行、按钮和对齐列的页签；
- 提示；
- 守卫规则；
- 它自己守卫的拒绝原因前缀。

这些全部由 binnacle 绘制。你操作这些东西时，binnacle 通过 `binnacle.notify` 告诉插件。每个插件加的内容都可以在 Settings → Plugins 里关掉。

怎么写插件见 [docs/plugins.zh-CN.md](docs/plugins.zh-CN.md)；模板和示例规则包在市场仓库里。插件从作者自己的仓库发布（仓库本身就是一个市场），binnacle 这边什么都不用改；收录进 binnacle 市场是可选的。

## 能访问什么

binnacle 能访问的范围：
- **不联网。**
- **写文件**：不写你的文件，只写它自己保存的会话（在 `~/.claude/plugins/data/binnacle-binnacle/` 下）。
- **改设置**：点状态行里的模型或档位，会打开 Claude Code 的 `/model` 或 `/effort` 选择器。在选择器里回车，会把选中的值存为默认值，写进 `~/.claude/settings.json`；按 `s` 则只用于本会话。
- **读对话**：为了 Search 和压缩计数，会读取本会话的 transcript。

插件是各自独立的代码，它们能访问什么，见各自的 README。详见 [SECURITY.md](SECURITY.md)。

## 开发

插件本体在 `plugin/` 目录，安装时只会复制这个目录。仓库的其余部分（README、`docs/`）不会被装进去；README 用到的图片放在 `assets` 分支。

```
plugin/
  .claude-plugin/plugin.json   插件清单
  hooks/                       register.tsx（全部接线）与 modules/（纯逻辑）
  types/                       插件的类型契约
  tests/                       claude plugin test 跑这里的每个 *.test.ts
docs/                          plugins.md（插件接口）、e2e 检查清单
```

```
cd plugin
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## 致谢

命令解析参考了 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) 中 merge-gate 的思路；详情窗口借鉴了 [scasella/claude-flightdeck](https://github.com/scasella/claude-flightdeck)；上下文明细借鉴了同一合集中的 context-bar。

## 许可证

MIT
