[English](plugins.md) | 简体中文

# 编写 binnacle 插件

binnacle 由内核和一套插件接口组成。插件就是普通的 Claude Code 插件，只需在 `dependencies` 里写上 `"binnacle"`，再通过 `$.binnacle` 往 binnacle 的界面里加东西：底部右侧的按钮、状态行里的一段、状态行下方的一整行、一个设置开关、`/binnacle` 里的一个页签、一条提示、给守卫加的规则，或者登记你自己守卫的拒绝来源。

界面全部由 binnacle 绘制，插件只传数据。当用户操作了插件加进来的东西时，binnacle 通过 `binnacle.notify` 这个事件告诉插件。

市场仓库里有这样的插件可以参考，代码就在 `template/` 旁边：
- `binnacle-example-pack`：一个规则包，带一个底部按钮和一个设置开关；

## 1. 整体关系

```
你的插件                                       binnacle
────────                                       ────────
session.start
  $.binnacle.version({})            ───────▶  { api: 1, binnacle: '0.6.0' }
  $.binnacle.button({ id, label })  ───────▶  画在底部右侧
                                               … 用户点击了它 …
on('binnacle.notify', …)            ◀───────  $.binnacle.notify({ plugin, kind: 'press', id })
  先确认来自 binnacle、且是发给自己的，
  再在调用链之后处理（见第 4 节）
```

binnacle 不知道装了哪些插件。它按 Claude Code 提供的调用方名字（`next.origin.plugin`，插件自己改不了）记录每一项注册属于谁，所以每个插件只能修改或删除自己注册的东西。

## 2. 五分钟上手

1. 把市场仓库里的 `template/` 复制到一个新仓库的根目录，然后改插件名，涉及四处：`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`、`types/index.d.ts`、`hooks/register.ts` 里的 `NAME`。
2. 从市场安装 binnacle：`claude plugin install binnacle@binnacle`。
3. 在任意项目里运行 `claude --plugin-dir <你的目录>`，底部右侧会出现 `✋ hello`，点一下试试。
4. 修改 `hooks/logic.ts` 和 `hooks/register.ts`，用 `claude plugin validate .` 和 `claude plugin test .` 检查。
5. 在真实会话里按 `CHECKLIST.md` 逐项检查一遍。

`plugin.json` 里必须写 `"dependencies": ["binnacle@binnacle"]`（收录在 binnacle 市场里的插件可以只写 `"binnacle"`）。这样 Claude Code 会：
- 安装你的插件时一并安装 binnacle，并先启动 binnacle；
- 把 binnacle 的类型放到 `.claude-plugin/types/binnacle/`，`$.binnacle` 直接有类型提示，不用复制任何文件。

依赖缺失时，你的插件根本不会被加载。

## 3. 接口

**通用规则：**
- 参数不合法或超出上限时，调用会被拒绝（promise reject），拒绝原因以 `binnacle:` 开头。
- 文字一律画成一行：控制字符换成可见形式（如 `^[`），再按上限截断。
- 颜色只接受十六进制值或主题名，其他值直接丢弃。
- id 最长 200 个字符。
- 同一个 id 再调用一次就是替换，位置不变。label、text 为空，或 forms 为空列表，就是移除。

| 调用 | 参数 → 返回 | 作用 | 每个插件的上限 |
|---|---|---|---|
| `version` | `{}` → `{ api, binnacle }` | `api` 只在会让旧插件出错的改动时才加一 | — |
| `button` | `{ id, label, color? }` → `{ ok }` | 底部右侧、`☰ binnacle` 前面的按钮；点击时发 `press` 通知 | 2 个；label 16 列 |
| `segment` | `{ id, text, color?, priority?, press? }` → `{ ok }` | 状态行末尾的一段。状态行放不下时，插件段先于 binnacle 自己的段被省略，`priority`（0–9，默认 5）低的先省略。设了 `press: true` 时，点击发 `press` 通知 | 3 个；text 30 列 |
| `line` | `{ id, forms, press? }` → `{ ok }` | 状态行下方的一整行。`forms` 是从宽到窄排列的几种写法，每种是一组 `{ text, color?, dim?, bold? }`；binnacle 选第一种放得下的，都放不下就截断最后一种 | 1 行；最多 4 种写法，每种 200 字符 |
| `setting` | `{ id, title, default }` → `{ ok, value }` | `/binnacle` → Settings → Plugins 里你插件名下的一个开关。值由 binnacle 保存，调用时返回当前值；切换时发 `setting` 通知 | 10 个；title 40 列 |
| `tab` | `{ id, title, rows }` → `{ ok }` | `/binnacle` 里的一个页签（快捷键 `1`–`9`）。行的结构见下面；打开页签时发 `open` 通知；`rows` 为空即移除 | 2 个页签；每个 2000 行，每行 500 字符 |
| `attention` | `{ id, level, text }` → `{ ok }` | 新出现或文字变了时，以你的插件名弹出提示；level 取 `info`、`warn`、`error` | 3 条；80 字符 |
| `guardSource` | `{ prefix, source }` → `{ ok }` | 拒绝原因形如 `<prefix><规则> · <说明>`（规则名匹配 `[a-z][a-z-]*`）时，Activity 和 Permissions 里把它显示为来自 `source` | 3 个；prefix 3–40 字符，不能以 `binnacle` 开头，每个 prefix 只能有一个插件登记 |
| `register`、`enabled`、`ask`、`record`、`shell` | 见示例规则包 | 给 binnacle 守卫用的规则：在 Settings 里列出规则、查询规则是否开启、询问用户、记录决定、拆分 shell 命令 | — |

显示条件：
- 状态段和整行：binnacle 状态行开着时才显示；
- 按钮：binnacle 状态行或守卫有一个开着就显示。

用户可以在 Settings → Plugins 里把某个插件加的东西全部关掉。这个插件的设置项仍然留在那里，方便再打开。

**页签的行**结构是 `{ id?, text?, color?, dim?, bold?, cols?, press?, buttons?, children? }`：

- `cols`：最多 6 个单元格，每个是一组 span。同一层、单元格数相同的行之间右对齐，宽度不够时先截断 text。
- `press: true`（必须同时有 `id`）：整行就是一个按钮，点击发 `{ kind: 'press', id }`。
- `buttons`：最多 6 个 `{ id, label }`（label 20 列），点击发 `{ kind: 'press', id, row }`，`row` 是这一行的 id。只有按钮、没有 text 的行会画成一排按钮。
- `children`：下一级的行，展开/折叠由 binnacle 处理。

## 4. 接收通知：`binnacle.notify`

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

下面四条规则，每条都有实测依据：

1. **先确认通知来自 binnacle。** 任何插件都能调用 `$.binnacle.notify`。在真实会话里，这种调用会送到你的订阅，`next.origin.plugin` 是调用方的名字。不是 `binnacle` 发的、或者是发给别的插件的，一律交给 `next(e)`。
2. **等调用链结束后，再调用 binnacle。** 在 `binnacle.notify` 的调用链里调用 `$.binnacle.<任何接口>`，请求不会到达 binnacle：只拿到一个占位返回值，界面也不会变。这类操作要像上面那样放进 `$.clock.after(0, …)`。调用 Claude Code 的其他接口（`$.model.fork`、`$.command.run`、`$.prompt.fill`、`$.process.run`）则可以直接在调用链里进行。
3. **加上 `.catch`。** 这个订阅属于会替别的插件作答的 hook，校验器会要求加 `.catch`。
4. **处理函数抛异常时**，这个 hook 会被跳过，Claude Code 在对话里显示一行 `<插件>: binnacle.notify hook skipped: threw …`，binnacle 照常运行。

返回值里的 `handled` 不会被 binnacle 使用，binnacle 也从不等待你的处理函数执行完。

## 5. 生命周期与状态

- 在 `session.start` 里注册。同一个 id 重复注册就是替换，所以每次启动都注册一遍也没关系。
- `/clear` 和 `/resume <id>` 只会触发 `session.end`，**之后不会**再触发 `session.start`：
  - binnacle 在整个进程里保留各插件的注册，所以你的按钮和页签不会消失；
  - 你插件自己的 atom（`$.state`）会恢复成初始值。
- 状态放在哪：要在 `/clear` 之后保留的，放模块内存或 `$.store`；只属于一次对话的，放 atom。
- 用了 atom 的插件，要在自己的类型契约里声明：`declare module 'claude-code' { interface PluginState { '<插件名>': { … } } }`，同时在 `plugin.json` 里写上 `"types"`。
- `/reload-plugins` 会重新执行你的 `session.start`，此时模块内存是空的，atom 保留原值。

## 6. 兼容性

- 在 `session.start` 里检查 `(await $.binnacle.version({})).api`，不是你开发时用的那个版本号，就什么都不注册。
- 在 `dependencies` 里写 `"binnacle@^0.6"` 能通过校验，但实际不会生效，所以要检查 api 版本号。
- 每一次 `$.binnacle` 调用都要放在 `try` 里，或者加 `.catch`。

## 7. 测试

`claude plugin test` 不会加载依赖。把模板里的 `tests/binnacle-mock.tsx` 复制到你的 `tests/` 目录，和你的插件一起加载，它会代替 binnacle：

```ts
import { MOCK_PANE, binnacleMock } from './binnacle-mock.tsx'

test('hello 按钮会打招呼', { plugins: [binnacleMock] }, async ($, on) => {
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

- 插件的每次调用都会以提示的形式记录下来，格式是 `binnacle-mock: <接口> <插件> <参数>`。
- mock 的面板会为你注册的每样东西画一个按钮：`press-<插件>-<id>`、`setting-<插件>-<id>`、`open-<插件>-<页签>`、`row-<插件>-<页签>-<行>`、`rowbutton-<插件>-<页签>-<行>-<按钮>`。
- 点这些按钮时，mock 会以 binnacle 的身份发出 `binnacle.notify`，等你的处理函数执行完才返回。用 `$.clock.after` 推迟的操作，要在 `mock.clock(on).settle()` 之后才会执行。
- 不加载 mock 的话，订阅了 `binnacle.notify` 的插件在 `claude plugin test` 里根本加载不起来。
- mock 测不到的部分，留到真实会话里按 `CHECKLIST.md` 检查：比如 binnacle 自己画出来的界面、其他插件冒充 binnacle 的情况。

## 8. 发布

**从你自己的仓库发布（binnacle 这边什么都不用改）。** 模板仓库本身就是一个市场：`.claude-plugin/marketplace.json` 列出这个插件（`"source": "./"`），并声明允许依赖 binnacle 市场：

```json
{ "name": "my-plugin", "owner": { "name": "me" }, "allowCrossMarketplaceDependenciesOn": ["binnacle"],
  "plugins": [{ "name": "my-plugin", "source": "./", "description": "…" }] }
```

用户这样安装：

```
claude plugin marketplace add <binnacle 市场地址>    # 只需一次，用来装 binnacle 本身
claude plugin marketplace add <你的仓库地址>
claude plugin install my-plugin@my-plugin            # binnacle 会一起装上
```

实测结果：
- 写了放行声明：装你的插件时会自动装上 binnacle；
- 没写：插件能装上，但要等用户手动装了 binnacle 才会加载；
- 用户没添加 binnacle 市场：插件不会加载，Claude Code 会提示原因。

**同时收录进 binnacle 市场（可选）。** 这样只添加了 binnacle 市场的用户也能找到你的插件。在它的目录里加一条，写明你的仓库地址和完整的 40 位提交 `sha`，然后提 MR（公司内网）或 PR（GitHub）：

```json
{ "name": "my-plugin", "source": { "source": "git-subdir", "url": "https://github.com/me/my-repo.git", "path": "my-plugin", "sha": "<40 位十六进制>" }, "description": "…" }
```

如果整个仓库就是这个插件，写 `{ "source": "github", "repo": "me/my-plugin", "sha": "…" }`。

无论哪种方式，每次发版都要改 `plugin.json` 里的 `version`：版本号没变的插件，Claude Code 不会更新。

## 9. 插件能做什么

- 只传数据。所有文字都会被 binnacle 处理，所有列表都有上限（见第 3 节）。
- binnacle 会拒绝修改其他插件注册的东西。
- 任何已安装的插件都能订阅 `binnacle.<接口>`，篡改别的插件传过来的内容，但改不了调用方是谁。插件本来就能读写文件、执行命令，所以装插件就等于信任它。只装你信任的插件；binnacle 市场里收录的插件经过审核，并固定到了具体的提交。
