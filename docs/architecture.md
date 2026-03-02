# 项目架构

## 全局模块图

```text
CLI（node dist/index.js）
  └─ src/
      ├─ index.ts（应用入口）
      ├─ agent/
      │   └─ invoke.ts（agent 统一入站入口）
      ├─ app/
      │   └─ coreCoordinator.ts（协调主入口）
      ├─ auth/
      │   ├─ authManager.ts
      │   ├─ configStore.ts
      │   └─ types.ts
      ├─ channels/
      │   ├─ contracts.ts
      │   ├─ feishu/
      │   │   ├─ index.ts（飞书网关）
      │   │   └─ transport.ts（WS/HTTP 适配）
      │   └─ local/
      │       ├─ index.ts（本地网关）
      │       └─ transport.ts（文件队列轮询与回写）
      ├─ cli/
      │   ├─ cli.ts（参数分发）
      │   ├─ program.ts（命令树）
      │   ├─ shared/
      │   │   ├─ options.ts
      │   │   └─ result.ts
      │   └─ commands/
      │       ├─ agent.ts
      │       ├─ auth.ts
      │       ├─ gateway.ts
      │       ├─ heartbeat.ts
      │       ├─ pairing.ts
      │       └─ tools.ts
      ├─ core/
      │   ├─ contracts.ts（核心接口/事件）
      │   ├─ errors.ts（统一错误）
      │   ├─ steps.ts（步骤编排）
      │   ├─ adapters/
      │   │   ├─ index.ts（适配器组合）
      │   │   ├─ runtime.ts
      │   │   ├─ session.ts
      │   │   └─ tools.ts
      │   └─ internal.ts
      ├─ gateway/
      │   ├─ index.ts（gateway 统一出口）
      │   ├─ service.ts（生命周期）
      │   ├─ servicePaths.ts（路径配置）
      │   ├─ serviceState.ts（状态管理）
      │   ├─ serviceController.ts（服务控制）
      │   ├─ serviceProcess.ts（进程封装）
      │   ├─ commands/
      │   │   ├─ channelRegistry.ts
      │   │   └─ start.ts
      │   └─ handlers/
      │       ├─ handleInbound.ts
      │       └─ policy/
      ├─ heartbeat/
      │   ├─ runner.ts（调度）
      │   └─ store.ts（运行时状态）
      ├─ pairing/
      │   ├─ cli.ts
      │   ├─ pairing-labels.ts
      │   ├─ pairing-messages.ts
      │   └─ pairing-store.ts
      ├─ providers/
      │   ├─ codexAdapter.ts（openai-codex 路径）
      │   ├─ stubAdapter.ts（兜底适配器）
      │   ├─ registry.ts（provider 注册）
      │   └─ codex/
      │       ├─ messageText.ts
      │       ├─ toolCallParser.ts
      │       └─ toolExecutionState.ts
      ├─ runtime/
      │   ├─ adapter.ts（请求上下文转换）
      │   ├─ context.ts（上下文定义）
      │   └─ entrypoint.ts（运行时边界）
      ├─ sessions/
      │   ├─ adapter.ts（会话适配）
      │   ├─ sessionService.ts
      │   └─ sessionStore.ts
      ├─ shared/
      │   ├─ envFlags.ts
      │   ├─ ids.ts
      │   ├─ types.ts
      │   └─ workspaceContext.ts
      └─ tools/
          ├─ adapter.ts
          ├─ executor.ts（工具执行）
          ├─ registry.ts（工具注册）
          ├─ runtimeTools.ts（内建工具聚合）
          └─ types.ts
```

## 核心职责

- `docs/wip/20260225-runtime-simplification/runtime-layering.md` 记录了当前 `src/runtime` 四大职责边界与迁移规则，当前代码实现按该约束维护。

- `src/cli/cli.ts`
  - 负责 CLI 参数解析、子命令分发与标准入口（`--help` / `--version`）输出。
  - 通过 `src/cli/program.ts` 维护命令注册，并由 `src/cli/shared/result.ts` 的 `runCommand` 风格执行层统一处理错误与返回码。
  - 提供 `agent/gateway/pairing/tools/heartbeat/auth` 的命令入口，但不变更命令语义与外部行为。
- `src/core/index.ts`
  - 统一执行业务执行入口，承接 `agent/gateway/channel/heartbeat` 的请求并编排上下文、会话、工具与运行时调用；核心层侧重协议协调与事件收口。
- `src/core/contracts.ts`
  - 定义 `CoreCoordinator` 接口、`runAgent` 输入/输出、`trace/event/log` 事件与错误码。
- `src/core/adapters/index.ts` / `src/core/adapters/session.ts` / `src/core/adapters/tools.ts` / `src/core/adapters/runtime.ts`
  - 将会话、工具、runtime 能力收敛为端口后通过依赖注入组装，避免业务层直接互相调用。
- `src/gateway/index.ts`
  - 作为主入口边界，仅委托 `agent` 标准调用入口后进入 `core` 的统一运行协议。
- `src/agent/invoke.ts`
  - 上层渠道/CLI/heartbeat 统一入站层：标准化入口参数（`sessionKey`、`toolAllow`、`memory`）后交由 `coreCoordinator.runAgent`。
- `src/runtime/context.ts`
  - 封装 request/session 上下文、时间戳与运行时元信息构建。
- `src/tools/runtimeTools.ts`
  - 承载工具清单、工具名映射、工具名适配、错误归并与 tool summary 构建能力；`runAgent` 与 `codexAdapter` 直接消费该能力。
- `src/runtime/adapter.ts` 与 `src/runtime/entrypoint.ts` 的数据流
  - `adapter` 负责 `CoreRuntimeInput` 到 `RequestContext` 的转换并切入 provider implementation；
  - `entrypoint` 提供 provider 底座执行与结果收口。
- `runtime` 可观测统一字段
  - `core` 通过 `emitEvent` 统一输出 trace/event/log 结构。
- `src/sessions/sessionService.ts`
  - 会话生命周期、会话历史与长期记忆读写、tool summary 写入、路由记录和 compact 写入的服务编排中心。
- `src/runtime/entrypoint.ts`
  - 基于 provider implementation 的单次执行底座，按 `provider` 选择具体运行适配器。

## 运行入口收口说明（新增）

- `gateway/index.ts`、`cli/commands/agent.ts`、`channels/*`、`heartbeat` 入口统一复用 `agent/invoke.ts` 的 `runAgent`。
- `运行时代码不再作为业务模块交接点`，`runtime/adapter.ts` 与 `runtime/entrypoint.ts` 仅负责 protocol context 与 provider 适配执行。
- `src/providers/codexAdapter.ts`
  - 对接模型 SDK（`@mariozechner/pi-ai`），处理工具 schema 映射与 tool-call 解析。
- `src/providers/stubAdapter.ts`
  - 作为非模型的兜底行为。
- `src/sessions/sessionStore.ts`
  - 管理 session 目录、索引文件与记忆文件。
- `src/tools/adapter.ts` / `src/tools/executor.ts` / `src/tools/registry.ts` / `src/tools/runtimeTools.ts` / `src/tools/types.ts`
  - `registry` 管理工具元数据与白名单；`executor` 统一校验与执行，`runtimeTools.ts` 与核心协调器协作处理 tool summary/名称映射。
- `src/channels/feishu/index.ts` / `src/channels/local/index.ts`（核心入口）及配套 `transport.ts`
  - 分别处理飞书 WS 入/出站与 local channel 文件队列。
- `src/pairing/cli.ts` / `src/pairing/pairing-labels.ts` / `src/pairing/pairing-messages.ts` / `src/pairing/pairing-store.ts`
  - 飞书配对策略与挂起码流程。
- `src/heartbeat/runner.ts` / `src/heartbeat/store.ts`
  - HEARTBEAT 规则管理、触发与运行日志。
- `src/auth/authManager.ts` / `src/auth/configStore.ts` / `src/auth/types.ts`
  - OAuth 登录、profile 选择、会话中 credential 读取与续期。
- `src/gateway/service.ts`
  - 作为服务对外边界，统一导出 `GatewayService` 配置与生命周期 API。
- `src/gateway/servicePaths.ts`
  - 解析 service state/log 路径。
- `src/gateway/serviceState.ts`
  - 管理 gateway service state 的读取/写入/清理。
- `src/gateway/serviceProcess.ts`
  - 管理 gateway 子进程启动与 stop/kill 生命周期。
- `src/shared/envFlags.ts` / `src/shared/ids.ts` / `src/shared/types.ts` / `src/shared/workspaceContext.ts`
  - 公共上下文（工作区、提示词拼装、运行时共享元信息）。

## 会话与记忆数据流（简化）

1. 用户输入通过 `agent` 或网关（Feishu/本地）进入 `core` 的 `runAgent`。
2. `CoreCoordinator` 合并上下文：`SessionRecord` -> 最近对话 -> 历史/长期记忆提示。
3. `CoreCoordinator` 进入 `runtime/adapter`，由 adapter 构建 context 后交给 `runtime/entrypoint`（provider 底座）进行单次会话执行。
4. `runAgent` 与 `runtime` 协同选择执行策略；若为 codex 路径则调用模型。
5. 返回中如出现 tool-call，`pi-agent-core` 触发工具执行，`executor` 回填结果后继续对话。
6. 最终输出写入会话轨迹（JSONL）和记忆文件（可选）；不保留运行态恢复文件。

## CLI 层重构说明（结构优化）

- `src/cli/cli.ts`
  - 负责前置参数分支与未知命令处理（`agent/gateway/...`）；
- `src/cli/program.ts`
  - 定义并挂载命令树（`agent/gateway/pairing/tools/heartbeat/auth`）；
- `src/cli/shared/options.ts`
  - 负责参数标准化与共享选项；
- `src/cli/commands/agent.ts` / `src/cli/commands/auth.ts` / `src/cli/commands/gateway.ts` / `src/cli/commands/heartbeat.ts` / `src/cli/commands/pairing.ts` / `src/cli/commands/tools.ts`
  - 负责命令执行、日志与输出；
- `src/cli/shared/result.ts`
  - 负责统一错误出口和返回码策略（成功 0，失败 1，除特殊路径外）。

该层改动只涉及组织形态与执行骨架，未新增参数语义。

## local 网关文件队列执行语义

- local 网关使用 `src/channels/local/transport.ts` 轮询 `inbox`，按追加行读取并逐行处理。
- 每条可解析消息会映射到 `runAgent`：
  - 发送方优先使用 `accountId`/`actorId` 映射到 `actorId`；
  - 会话键优先使用 `conversationId`/`sessionHint`；
  - 均缺失时退化到 `local:main`；
  - 回写 `outbox` 使用 `conversationId` 或 `requestId`。
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
