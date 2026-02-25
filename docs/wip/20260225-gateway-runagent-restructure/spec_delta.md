# Spec Delta

## ADDED Requirements
- [CORE] REQ-0001 在不改变外部行为前提下，新增 `src/gateway` 内 `runAgent` 顶层可读性重构计划（`src/gateway/runAgent.ts` 改为薄入口）。

## MODIFIED Requirements
- [ARCHIVE-ONLY] REQ-0002 将 `runAgent` 主逻辑按职责拆分到 `agentCoordinator.ts`、`agentContext.ts`、`agentTools.ts`、`agentPersistence.ts`。
- [CORE] REQ-0003 保持 `runAgent` 外部契约与返回语义（签名/字段/错误/日志关键文案）不变。
- [ARCHIVE-ONLY] REQ-0004 引入明确的命名与目录边界（如 `src/gateway/agent/*`），使顶层流程可读。
- [ARCHIVE-ONLY] REQ-0005 更新 `README.md`、`docs/architecture.md`、`docs/local-quickstart.md` 对应结构说明。

## REMOVED Requirements
- [ARCHIVE-ONLY] REQ-9999 目前无移除现有对外行为约束。
