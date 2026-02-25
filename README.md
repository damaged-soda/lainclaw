# Lainclaw CLI

A tiny TypeScript playground entry for the Lainclaw project.

## 快速进入命令行

> 本次 CLI 重构仅调整 `src/cli` 内部组织与分发层（命令注册、参数解析、执行封装），对外暴露的命令语义、返回码与文本输出保持兼容。

### 使用全局命令（推荐）

```bash
git clone <repo_root>
cd <repo_root>/src/lainclaw
npm install
npm run bootstrap

lainclaw --help
lainclaw agent 这是一个测试输入
```

本期实现默认采用 `pi-agent-core` 作为运行时编排内核：`agent` 与 `gateway` 共享同一执行流，按会话上下文与消息历史进行单次执行，不依赖跨请求恢复；工具调用通过现有 `tools` 执行链路执行（不再经过独立 sandbox 层）。外部命令行为与返回码保持兼容。

### 会话模式（第一阶段）

- 默认会话：`main`
- 指定会话：`--session <name>`
- 强制新会话：`--new-session`

```bash
lainclaw agent --session work 这是我的第一个任务
lainclaw agent --session work 我接着说一件事
lainclaw agent --new-session 重新开始新会话
```

每次成功调用会在 `~/.lainclaw/sessions/<sessionId>.jsonl` 中追加会话转写，并在输出中返回 `sessionKey` 与 `sessionId`。

### 长期记忆与压缩（第二阶段）

- 开启记忆：`--memory`
- 关闭记忆：`--no-memory` 或 `--memory=off`
- 记忆摘要写入：`~/.lainclaw/memory/<sessionKey>.md`
- compaction：当会话条目较多后自动把较早历史压缩到记忆文件，保留最近 12 条用于上下文重放。

```bash
lainclaw agent --session work --memory 这是我希望长期记住的偏好
lainclaw agent --session work --memory 今天我想复盘一下这个项目的背景
lainclaw agent --session work --no-memory 这条消息不写记忆
```

当触发 compaction 后，`agent` 输出会包含 `memoryEnabled: true` 与 `memoryUpdated: true/false`，便于确认是否写入记忆。

## 直接运行编译产物（排错）

```bash
cd <repo_root>/src/lainclaw
npm run build
node ./dist/index.js --help
node ./dist/index.js agent 这是一个测试输入
```

## 本地全局命令安装（npm link）

```bash
cd <repo_root>/src/lainclaw
npm install
npm run build
npm link
```

global 命令：

```bash
lainclaw
lainclaw agent 这是一个测试输入
```

## 在任意目录使用

`npm link` 已把可执行命令挂到全局 bin，因此安装后可直接执行：

```bash
lainclaw
lainclaw agent 你好，帮我总结一下
```

## 本地通道（local）全流程上手（无 Feishu 依赖）

如果你只想完成本地验收，不想依赖飞书，可直接走 local 通道：

```bash
cd <repo_root>/src/lainclaw
npm install
npm run build

node dist/index.js gateway start --channel local --provider openai-codex --profile <profileId> --with-tools --memory
```

更多完整步骤、inbox/outbox 示例、全流程验收清单见：

- `docs/local-quickstart.md`

## 飞书（Feishu）网关接入（WS-only）

当前的 `feishu` 通道仅支持 **WebSocket 长连接模式**（不使用 Webhook）。统一入口为 `gateway` 命令，默认通道为 `feishu`，可通过 `--channel` 覆盖（当前实现仍仅支持 `feishu`）。
> 内部说明：当前 `agent` 与 `gateway` 的运行编排已统一到顶层 `src/runtime`（`coordinator/context/tools/persistence/entrypoint` 等），`gateway` 层保留通道与服务边界，外部行为保持不变。MVP 阶段不承诺跨请求恢复未完成的执行过程。

### 启动方式

```bash
cd <repo_root>/src/lainclaw
npm install
npm run build
npm start -- gateway start --app-id <AppID> --app-secret <AppSecret>
```

### 长期服务化（后台运行）

在需要长期接入时，使用服务化子命令：

```bash
npm start -- gateway start --daemon --app-id <AppID> --app-secret <AppSecret>
npm start -- gateway status --channel feishu
npm start -- gateway stop --channel feishu
```

也可以先把启动参数写入配置，再直接 `start`：

```bash
npm start -- gateway config set --app-id <AppID> --app-secret <AppSecret> --provider openai-codex
npm start -- gateway config show
npm start -- gateway config clear
```

`gateway config set` 会把网关参数持久化到 `~/.lainclaw/gateway.json`：
- 顶层 `default` 为全局默认配置；
- `channels.<name>` 为某个频道的覆盖配置（当前运行时未显式指定频道时，默认使用 `default`）。
`provider` 与 `app-id/app-secret`、工具/配对/心跳配置都写在网关级配置内。后续 `gateway start` 可省略重复参数；`config show` 用于核对，`config clear` 用于重置。

如果你需要手动按频道持久化（当前只支持 `feishu` 运行时启动）：

```bash
npm start -- gateway config set --channel feishu --app-id <AppID> --app-secret <AppSecret>
```

默认会在 `~/.lainclaw/service/gateway-service.json` 记录运行状态（`pid/state/log` 字段内带回放的 channel 元信息）。如果传入自定义 `--pid-file` / `--log-file`，服务状态与日志都会使用该路径。

可选参数：

- `--request-timeout-ms <ms>`：飞书 API 请求超时（默认 10000）
- `--provider <provider>`：模型提供商，当前支持 `openai-codex`（默认） 
- `--profile <profileId>`：使用指定 openai-codex 登录 Profile（默认走当前 active profile）
- `--with-tools` / `--no-with-tools`：是否允许模型发起 tool-call（默认打开）
- `--memory` / `--no-memory`：是否启用会话记忆摘要合并（默认关闭）
- `--tool-allow <tool1,tool2>`：限制允许的工具白名单（默认允许所有内置工具，`gateway.json` 不配置则等于放开全部）
示例（10秒超时）：

```bash
npm start -- gateway start --app-id <AppID> --app-secret <AppSecret> --request-timeout-ms 10000
```

或使用模型配置启动（会让飞书消息走模型）：

```bash
npm start -- gateway start --provider openai-codex --with-tools --app-id <AppID> --app-secret <AppSecret>
```

也可以直接使用全局命令（安装过 `npm link` 后）：

```bash
lainclaw gateway start --app-id <AppID> --app-secret <AppSecret> --request-timeout-ms 10000
```

也可同时启动心跳：

```bash
lainclaw gateway start --app-id <AppID> --app-secret <AppSecret> \
  --heartbeat-enabled --heartbeat-target-open-id <openId> --heartbeat-interval-ms 300000
```

参数会优先来自命令行，未传入时会从环境变量回退，最后从配置作用域文件（默认 `~/.lainclaw/gateway.json`）读取上次配置（如存在）。

可选命令：
- `gateway config migrate --channel <channel> --dry-run`：仅预览将历史 `<channel>-gateway.json` 映射到 `gateway.json` 的草稿，不写入文件。

确认草稿无误后，可手动清理已不再需要的历史分片文件（本项目不会自动删除）：

```bash
rm ~/.lainclaw/<channel>-gateway.json
```

- `LAINCLAW_FEISHU_APP_ID` / `FEISHU_APP_ID`
- `LAINCLAW_FEISHU_APP_SECRET` / `FEISHU_APP_SECRET`
- `LAINCLAW_FEISHU_REQUEST_TIMEOUT_MS` / `FEISHU_REQUEST_TIMEOUT_MS`
- `LAINCLAW_FEISHU_PROVIDER` / `FEISHU_PROVIDER`：`openai-codex`
- `LAINCLAW_FEISHU_PROFILE_ID` / `FEISHU_PROFILE_ID`
- `LAINCLAW_FEISHU_TOOL_ALLOW` / `FEISHU_TOOL_ALLOW`（逗号分隔）
- `LAINCLAW_FEISHU_WITH_TOOLS` / `FEISHU_WITH_TOOLS`：`true|false`
- `LAINCLAW_FEISHU_MEMORY` / `FEISHU_MEMORY`：`true|false`
- `LAINCLAW_FEISHU_HEARTBEAT_ENABLED` / `FEISHU_HEARTBEAT_ENABLED`：`true|false`
- `LAINCLAW_FEISHU_HEARTBEAT_INTERVAL_MS` / `FEISHU_HEARTBEAT_INTERVAL_MS`
- `LAINCLAW_FEISHU_HEARTBEAT_TARGET_OPEN_ID` / `FEISHU_HEARTBEAT_TARGET_OPEN_ID`
- `LAINCLAW_FEISHU_HEARTBEAT_SESSION_KEY` / `FEISHU_HEARTBEAT_SESSION_KEY`
- `LAINCLAW_FEISHU_PAIRING_POLICY` / `FEISHU_PAIRING_POLICY`：`open|allowlist|pairing|disabled`（默认 `open`）
- `LAINCLAW_FEISHU_PAIRING_PENDING_TTL_MS` / `FEISHU_PAIRING_PENDING_TTL_MS`：待审批请求 TTL（毫秒）
- `LAINCLAW_FEISHU_PAIRING_PENDING_MAX` / `FEISHU_PAIRING_PENDING_MAX`：待审批最大未处理条数
- `LAINCLAW_FEISHU_PAIRING_ALLOW_FROM` / `FEISHU_PAIRING_ALLOW_FROM`：默认配对放行列表（逗号分隔，`*` 表示全放行）
- `LAINCLAW_CODEX_PREFIX_RESPONSE`：全局调试开关，值为 `true/1/yes/on` 时在 openai-codex 文本结果前缀附加 `[openai-codex:<profileId>]`；默认关闭时不带前缀。

### 配对鉴权（Pairing）使用说明

飞书网关支持四种策略：

- `open`（默认）：不拦截 DM。
- `allowlist`：仅放行 `pairingAllowFrom` 白名单（`*` 表示全放行）。
- `pairing`：未命中白名单则进入待审批流程，用户收到配对码后可由管理员批准。
- `disabled`：拒绝所有 DM。

网关启动示例：

```bash
lainclaw gateway start --app-id <AppID> --app-secret <AppSecret> \
  --pairing-policy pairing \
  --pairing-allow-from ou_admin_001,ou_admin_002 \
  --pairing-pending-ttl-ms 5400000 \
  --pairing-pending-max 5

lainclaw gateway start --pairing-policy allowlist --pairing-allow-from "ou_admin_001,ou_admin_002"
```

配对管理命令：

```bash
lainclaw pairing list [--channel feishu] [--json]
lainclaw pairing approve [--channel feishu] <code> [--account <accountId>]
lainclaw pairing revoke [--channel feishu] <openIdOrUserId> [--account <accountId>]
```

## 心跳（Heartbeat）规则命令

```bash
lainclaw heartbeat init [--template <path>] [--force]
lainclaw heartbeat add "提醒我：每天中午检查邮件"
lainclaw heartbeat list
lainclaw heartbeat enable <ruleId>
lainclaw heartbeat disable <ruleId>
lainclaw heartbeat run
lainclaw heartbeat remove <ruleId>
```

说明：

- `init`：首次使用时手动初始化 `~/.lainclaw/HEARTBEAT.md`，默认会从源码目录下的 `template/HEARTBEAT.md` 拷贝；`--force` 可强制覆盖已有文件。  
- `add`：写入自然语言规则（按模型语义判断是否触发）  
- `list`：查看持久化规则  
- `run`：手动触发一次执行（不启动网关）  
- `enable / disable`：单独控制规则开关  
- `remove`：删除规则

### 启动日志说明（你可以按这个判断是否成功）

- `event-dispatch is ready`：SDK event dispatcher 已就绪
- `receive events or callbacks through persistent connection ...`：表示飞书控制台已配置为长连接回调模式
- `[ws] ws client ready`：长连接建立成功
- `[feishu] websocket connection started`：`feishu` 命令的处理循环已启动
- `answered dm for open_id=...`：说明收到 DM 并成功回包（表示端到端链路通了）

常见错误提示：

- 未登录 openai-codex：`No openai-codex profile found...` 会返回「请先执行 `lainclaw auth login openai-codex`」。
- 模型超时：会返回超时提示，建议检查网络与 openclaw 上下游状态。

### 当前限制（MVP）

- 默认只处理 DM 文本消息（非 DM 或非文本不会响应）
- 依赖 `@larksuiteoapi/node-sdk` 的 WebSocket 能力（`app_id`/`app_secret` 必须有权限）

## 仅给某个工程引用（可选）

```bash
cd <your_project_dir>
npm link lainclaw
```

## 卸载

```bash
npm unlink -g lainclaw
```
