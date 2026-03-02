# Runtime 分层边界与迁移规则（2026-02-25）

本文档是对当前仓库 `src/runtime` 与 `src/providers` 的最小边界说明，用于与 `docs/architecture.md`、`docs/overview.md` 同步。

## 一、当前四层边界

- `src/runtime/context.ts`：构建 `RequestContext` 与上下文消息，负责会话上下文的拼装前置条件。
- `src/runtime/adapter.ts`：作为 `CoreRuntimePort` 的适配层，将 `CoreRuntimeInput` 转为运行时请求上下文，负责输入合法性与路由结果封装。
- `src/runtime/entrypoint.ts`：按 provider 名称选择 provider implementation 并执行单次运行。
- `src/providers/*`：provider implementation 与 registry，承载具体模型/工具调用能力。

## 二、数据流

`core` 入口 → `runtime/adapter.ts` → `runtime/context.ts` → `runtime/entrypoint.ts` → `providers/*`，最终回填 `route/stage/result` 等执行结果。

## 三、迁移规则（最小可信）

1. `runtime` 与 `provider` 职责分离  
   - 仅当底层调用协议或通用上下文格式变更时才改 `runtime/*`。  
   - 仅新增或替换 provider 时改 `src/providers/*` 与 `src/providers/registry.ts`。
2. provider 列表约束  
   - 仅通过 `resolveProvider`/`PROVIDER_BY_PROVIDER` 白名单引入 provider。  
3. route 与可观测一致性  
   - `route` 仍走 `adapter.<provider>`；新增 provider 不更改 CLI 语义。  
4. 退出语义不变  
   - 保持 `CoreRuntimeInput`/`CoreRuntimeResult` 与 `runAgent` 行为对外兼容。

## 四、与 CLI 的约束

- 该文档仅覆盖运行时分层，不改变 CLI 参数、子命令、返回码、命名及外部执行行为。  
- 任何行为变更仍应先在 `architecture.md` 和 `overview.md` 中同步说明，再进入实现。

