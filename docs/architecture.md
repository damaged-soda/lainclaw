# 项目架构

## 全局模块图

```text
CLI（node dist/index.js）
  └─ src/index.ts
      └─ src/cli/cli.ts（参数路由）
          ├─ src/gateway/gateway.ts（兼容入口）
          │   ├─ src/gateway/service.ts（服务生命周期）
          │   ├─ src/gateway/servicePaths.ts（服务路径）
          │   ├─ src/gateway/serviceState.ts（服务状态）
          │   ├─ src/gateway/serviceProcess.ts（子进程）
          ├─ src/runtime/
          │   ├─ index.ts（稳定 API 导出）
          │   ├─ coordinator.ts（runAgent 顶层编排）
          │   ├─ context.ts（上下文与请求基元）
          │   ├─ tools.ts（工具白名单/结果组装）
          │   ├─ persistence.ts（会话与记忆持久化）
          │   └─ entrypoint.ts（pi-agent-core 运行时编排，单次执行）
          ├─ src/adapters/codexAdapter.ts（provider adapter，当前实现为 openai-codex）
          ├─ src/adapters/stubAdapter.ts（非 codex 回退）
          ├─ src/tools/gateway.ts / src/tools/registry.ts / executor.ts（工具执行）
          ├─ src/sessions/sessionStore.ts（会话与记忆）
          ├─ src/channels/feishu/server.ts（飞书网关）
          ├─ src/channels/local/server.ts（本地网关）
          └─ src/heartbeat/*.ts（定时任务与运行日志）
```

## 核心职责

- `docs/wip/20260225-runtime-simplification/runtime-layering.md` 记录了当前 `src/runtime` 四大职责边界与迁移规则，当前代码实现按该约束维护。

- `src/cli/cli.ts`
  - 负责 CLI 参数解析、子命令分发与标准入口（`--help` / `--version`）输出。
  - 通过 `src/cli/registry.ts` 维护 `CommandRoute` 注册表，由 `runCommand` 风格执行层统一处理错误与返回码。
  - 提供 `agent/gateway/pairing/tools/heartbeat/auth` 的命令入口，但不变更命令语义与外部行为。
- `src/gateway/gateway.ts`
  - 作为通道边界入口，接受 agent/gateway 输入并向下分发到 `runtime`。
- `src/runtime/index.ts`
  - 暴露稳定的 `runAgent` API，并保持对 `gateway` 的兼容导出协议。
  - 不承载调用来源语义（来源/外部通道归属），`runAgent` 仅接收执行上下文与会话参数。
- `src/runtime/coordinator.ts`
  - 组织 `runAgent` 的顶层编排：会话上下文合并、工具清单与运行参数准备、执行结果归并。
  - 持有业务上下文边界（`session`、`memory`）并触发持久化写入；不直接处理 `tool` 执行策略细节。
- `src/runtime/context.ts`
  - 封装 request/session 上下文、时间戳与运行时元信息构建。
- `src/runtime/tools.ts`
  - 封装工具白名单与工具名映射、执行日志归并；工具真实执行由 `tools/executor` 完成。
- `src/runtime/coordinator.ts` 与 `src/runtime/entrypoint.ts` 的数据流
  - `coordinator` 负责输入准备（会话/系统提示/工具列表）与执行结果收口；
  - `entrypoint` 负责单次执行流程调度、工具回调与结果归并。
- `runtime` 可观测统一字段
  - `entrypoint` 采用 `stage` 维度打点，核心字段保留 `stage`、`sessionKey`、`durationMs`、`errorCode`（可选）。
  - `LAINCLAW_RUNTIME_TRACE=1|true` 时记录标准化调试事件；默认保持原有日志语义。
- `src/runtime/persistence.ts`
  - 封装会话轨迹、路由记录、记忆压缩相关的持久化写入。
- `src/runtime/entrypoint.ts`
  - 基于 provider adapter 的单次执行入口，按 `provider` 选择具体运行适配器。

## 运行入口收口说明（新增）

- `gateway/index.ts` 与 `gateway/gateway.ts` 直接复用 `runtime/index.ts` 的 `runAgent` 导出。
- 删除 `runtime/runAgent.ts` 与 `gateway/runAgent.ts` 这两层“仅转发”文件，减少不必要的中间封装。
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
  - 作为服务对外边界，统一导出 `GatewayService` 配置与生命周期 API。
- `src/gateway/servicePaths.ts`
  - 解析 service state/log 路径。
- `src/gateway/serviceState.ts`
  - 管理 gateway service state 的读取/写入/清理。
- `src/gateway/serviceProcess.ts`
  - 管理 gateway 子进程启动与 stop/kill 生命周期。
- `src/shared/*`
  - 公共上下文（工作区、提示词拼装、运行时共享元信息）。

## 会话与记忆数据流（简化）

1. 用户输入通过 `agent` 或网关（Feishu/本地）进入 `runAgent`。
2. `runAgent` 合并上下文：`SessionRecord` -> 最近对话 -> 历史/长期记忆提示。
3. `runAgent` 进入 `runtime` 层；`entrypoint` 基于 `pi-agent-core` 按会话上下文执行单次会话流程。
4. `runAgent` 与 `runtime` 协同选择执行策略；若为 codex 路径则调用模型。
5. 返回中如出现 tool-call，`pi-agent-core` 触发工具执行，`executor` 回填结果后继续对话。
6. 最终输出写入会话轨迹（JSONL）和记忆文件（可选）；不保留运行态恢复文件。

## CLI 层重构说明（结构优化）

- `src/cli/cli.ts`
  - 负责前置参数分支与未知命令处理（`agent/gateway/...`）；
- `src/cli/registry.ts`
  - 定义命令路由（`commandRoutes`）与运行时查找；
- `src/cli/parsers/*`
  - 负责参数校验与标准化；
- `src/cli/commands/*`
  - 负责命令执行、日志与输出；
- `src/cli/shared/result.ts`
  - 负责统一错误出口和返回码策略（成功 0，失败 1，除特殊路径外）。

该层改动只涉及组织形态与执行骨架，未新增参数语义。

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
