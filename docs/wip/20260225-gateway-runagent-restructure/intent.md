# Intent: src/gateway/runAgent 顶层可读性重构（保持行为不变）

## 背景与动机（Why）
上一次重构后 `src/gateway/runAgent.ts` 仍然集中于单文件，顶层职责不够清晰。当前目标是在不改动任何外部行为的前提下，按“主流程-上下文-工具-持久化”分层，让代码意图一眼可读、便于审计和后续维护。

## Goals / Non-Goals

### Goals
- 仅做 `src/gateway` 内部结构优化：把 `runAgent.ts` 按职责划分为更明确的子模块。
- 保持 `runAgent` 外部可见行为不变：
  - 函数签名不变
  - 返回体、错误码、日志文本、返回码、命令语义不变
  - 命令路径与文档兼容不变
- 将 `runAgent` 从“单文件堆砌”改为“薄入口 + 明确职责模块”：
  - `src/gateway/agentCoordinator.ts`（顶层编排）
  - `src/gateway/agentContext.ts`（会话与上下文组装）
  - `src/gateway/agentTools.ts`（工具解析、校验、执行与结果拼装）
  - `src/gateway/agentPersistence.ts`（会话持久化/记录）

### Non-Goals
- 不改功能、不改 API。
- 不改 `gateway` 服务生命周期（`service*.ts`）
- 不引入新外部依赖。
- 不改 CLI 参数、配置字段、持久化格式。

## 验收标准（Acceptance Criteria）
- [CORE] `src/gateway/runAgent.ts` 形成薄入口，主要行为由子模块承接，顶层调用链路清晰。
- [CORE] `gateway`/`local`/`heartbeat`/`cli agent` 等调用路径在行为上可用现有回归与文档快速对齐（无语义偏差）。
- [ARCHIVE-ONLY] 新增/迁移的子模块有清晰文件边界，单文件体量显著下降。
- [ARCHIVE-ONLY] `README.md`、`docs/architecture.md`、`docs/local-quickstart.md` 同步说明新结构与兼容性。

## 文档影响与同步计划（Docs Impact）
- `README.md`：补充本次 runAgent 结构优化说明（执行链路按子模块化）。
- `docs/architecture.md`：更新 `runAgent` 及子模块职责关系图。
- `docs/local-quickstart.md`：补充“内部重构仅影响结构，行为不变”说明（如需）。
- 责任人：本次提案/实施执行人（你我协作）。
