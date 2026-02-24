# 项目架构

## 全局模块图

```text
CLI（node dist/index.js）
  └─ src/index.ts
      └─ src/cli/cli.ts（参数路由）
          ├─ src/gateway/gateway.ts（agent 主链路）
          │   ├─ src/pipeline/pipeline.ts（路由决策）
          │   │   ├─ src/adapters/codexAdapter.ts（openai-codex）
          │   │   └─ src/adapters/stubAdapter.ts（非 codex 回退）
          │   ├─ src/tools/gateway.ts / src/tools/registry.ts / executor.ts（工具执行）
          │   └─ src/sessions/sessionStore.ts（会话与记忆）
          ├─ src/channels/feishu/server.ts（飞书网关）
          ├─ src/channels/local/server.ts（本地网关）
          └─ src/heartbeat/*.ts（定时任务与运行日志）
```

## 核心职责

- `src/cli/cli.ts`
  - 负责 CLI 参数解析、子命令分发。
  - 提供 `agent/gateway/pairing/tools/heartbeat/auth` 的命令入口。
- `src/gateway/gateway.ts`
  - 统一封装一次请求到模型的执行上下文。
  - 负责 session 获取、上下文注入、工具循环、回复输出组装。
- `src/pipeline/pipeline.ts`
  - 当前主要按 `provider` 与输入特征决定路由（如 openai-codex / summary / echo）。
- `src/adapters/codexAdapter.ts`
  - 对接模型 SDK（`@mariozechner/pi-ai`），处理工具 schema 映射与 tool-call 解析。
- `src/adapters/stubAdapter.ts`
  - 作为非模型的兜底行为。
- `src/sessions/sessionStore.ts`
  - 管理 session 目录、索引文件与记忆文件。
- `src/tools/*`
  - `registry` 管理工具元数据与白名单；`executor` 统一校验与执行，`gateway.ts` 做调用编排。
- `src/channels/feishu/*` / `src/channels/local/*`
  - 分别处理飞书 WS 入/出站与 local channel 文件队列。
- `src/pairing/*`
  - 飞书配对策略与挂起码流程。
- `src/heartbeat/*`
  - HEARTBEAT 规则管理、触发与运行日志。
- `src/auth/*`
  - OAuth 登录、profile 选择、会话中 credential 读取与续期。
- `src/gateway/service.ts`
  - 网关服务的后台化启动、进程状态、日志与 stop/kill 生命周期。
- `src/shared/*`
  - 公共上下文（工作区、提示词拼装、审计结构）。

## 会话与记忆数据流（简化）

1. 用户输入通过 `agent` 或网关（Feishu/本地）进入 `runAgent`。
2. `runAgent` 合并上下文：`SessionRecord` -> 最近对话 -> 历史/长期记忆提示。
3. `pipeline` 选择适配器；若为 codex 则调用模型。
4. 返回中如出现 tool-call，`tools` 会执行并将结果回填给模型继续对话。
5. 最终输出写入会话轨迹（JSONL）和记忆文件（可选）。

## local 网关文件队列执行语义

- local 网关使用 `src/channels/local/server.ts` 轮询 `inbox`，按追加行读取并逐行处理。
- 每条可解析消息会映射到 `runAgent`：
  - 优先使用 payload 的 `sessionKey`；
  - 其次使用 `accountId` 映射到 `local:<accountId>`；
  - 再退化到 `LAINCLAW_LOCAL_SESSION_KEY`，否则为 `local:main`。
- 接口格式兼容两种输入：
  - 纯文本行（自动当作 `input`）。
  - JSON 行（支持 `input`、`sessionKey`、`accountId`、`requestId`）。
- 处理结果会写入 `outbox.jsonl`，关键可观测字段：
  - `route`、`stage`、`result`、`provider`、`memoryEnabled`、`memoryUpdated`。
- 对无效 JSON 或空内容会跳过，不会阻塞主循环。
- 生命周期行为：
  - `gateway start --channel local --daemon` 由 `gateway-service.json` 管理进程；
  - `gateway status --channel local` 查询运行状态；
  - `gateway stop --channel local` 回收服务。
- 可通过环境变量定制运行路径与行为：
  - `LAINCLAW_LOCAL_INBOX_PATH` / `LAINCLAW_LOCAL_OUTBOX_PATH`
  - `LAINCLAW_LOCAL_SESSION_KEY` / `LAINCLAW_LOCAL_POLL_MS`

## 持久化路径（默认）

路径来源：`~/.lainclaw` 根目录（`src/auth/configStore.ts`）。

- 会话目录：`~/.lainclaw/sessions/`
  - 会话索引：`~/.lainclaw/sessions/sessions.json`
  - 轨迹文件：`~/.lainclaw/sessions/<sessionId>.jsonl`
- 记忆文件：`~/.lainclaw/memory/<sessionKey>.md`
- Auth：`~/.lainclaw/auth-profiles.json`
- Gateway 配置：`~/.lainclaw/gateway.json`
- Gateway 服务状态：`~/.lainclaw/service/gateway-service.json`
- Gateway 日志：`~/.lainclaw/service/gateway-service.log`
- Heartbeat 运行日志：`~/.lainclaw/heartbeat-run.log`
- Local Gateway 文件队列：`~/.lainclaw/local-gateway/local-gateway-inbox.jsonl` 与 `~/.lainclaw/local-gateway/local-gateway-outbox.jsonl`
- 配对与网关配置兼容历史文件：`~/.lainclaw/<channel>-gateway.json`（迁移场景下存在）

> 说明：workspace 级别文档（如 `HEARTBEAT.md`）由运行时上下文决定，通常位于工作区根目录，不固定在 `~/.lainclaw`。

## 主要运行入口（简化）

- `agent`：同步调用模型、写入会话。
- `gateway start`：启动飞书 WS 或 local gateway。
- `gateway config`：读取/设置/清理网关参数；`gateway status/stop` 管理生命周期。
- `heartbeat`：初始化规则、增删改查、单次/循环执行。
- `tools`：查看、执行内置工具；用于排查和手工触发。
