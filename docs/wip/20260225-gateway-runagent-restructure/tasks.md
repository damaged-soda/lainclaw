# Tasks

- [ ] [CORE] [REQ-0001] 在 `src/gateway` 建立清晰的 runAgent 分层目录与文件边界（例如 `agentCoordinator.ts`、`agentContext.ts`、`agentTools.ts`、`agentPersistence.ts`），并定义对外/对内责任。
  - 影响范围：`src/gateway/`

- [ ] [CORE] [REQ-0002] 将 runAgent 顶层编排逻辑迁移到 `agentCoordinator.ts`，形成“请求接入 -> 会话/上下文 -> 工具路径 -> 结果落库 -> 返回”的可读流程。
  - 影响范围：`src/gateway/runAgent.ts`, `src/gateway/agentCoordinator.ts`

- [ ] [ARCHIVE-ONLY] [REQ-0002] 拆分工具相关能力到 `agentTools.ts`，集中手工工具、自动工具、工具调用结果的解析与映射。
  - 影响范围：`src/gateway/agentTools.ts`, `src/gateway/runAgent.ts`

- [ ] [ARCHIVE-ONLY] [REQ-0002] 拆分上下文与 session 组装逻辑到 `agentContext.ts`，集中 sessionKey/newSession、系统提示词、历史上下文截取、workspace 信息注入等职责。
  - 影响范围：`src/gateway/agentContext.ts`, `src/gateway/runAgent.ts`

- [ ] [ARCHIVE-ONLY] [REQ-0002] 拆分会话和记忆持久化相关逻辑到 `agentPersistence.ts`（仅做结构重组，不改持久化语义）。
  - 影响范围：`src/gateway/agentPersistence.ts`, `src/gateway/runAgent.ts`

- [ ] [CORE] [REQ-0003] 保证 `runAgent` 外部契约不变并补齐回归抽样：`gateway`/`local`/`heartbeat`/`cli agent` 的关键路径无语义回退。
  - 影响范围：`docs/wip/20260225-gateway-runagent-restructure/verification.md`, `src/gateway/*.ts`

- [ ] [ARCHIVE-ONLY] [REQ-0005] 更新文档 `README.md` / `docs/architecture.md` / `docs/local-quickstart.md`，同步新结构与兼容性声明。
  - 影响范围：`README.md`, `docs/architecture.md`, `docs/local-quickstart.md`
