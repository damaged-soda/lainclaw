# Implementation Plan: `src/gateway/runAgent` 结构化重构（保持行为不变）

Status: APPROVED_FOR_IMPLEMENT

Implementation Scope:
- 目标是将 `src/gateway/runAgent.ts` 改为可读性优先的薄入口，业务行为零变更，仅重构 `src/gateway` 内结构边界。
- 维持现有外部契约、返回语义、日志文案、错误码与入口参数不变。
- 重构文件保持在 `src/gateway/agent/*` 目录下，减少单文件体量并明确职责。

Dependencies / Assumptions:
- 目标只涉及结构重组，未引入新外部依赖。
- 不改 `service*.ts` 生命周期、不改 `CLI` 配置、不改持久化存储 schema 与压缩策略。
- 现有行为验收通过：`gateway`、`local`、`heartbeat`、`cli agent` 调用链路仍使用原有 `runAgent` 对外兼容入口。

Architecture Boundaries:
- `src/gateway/agent/coordinator.ts`: 顶层编排，定义 `runAgent` 流程。
- `src/gateway/agent/context.ts`: 上下文组装（session、提示词、历史截取、workspace 元信息）。
- `src/gateway/agent/tools.ts`: 工具解析、可执行性校验、工具执行调用、工具结果映射与工具消息构建。
- `src/gateway/agent/persistence.ts`: 消息与工具调用持久化（session log 与记忆压缩判定）。
- `src/gateway/runAgent.ts`: 只保留入口转发，避免业务细节下沉。

State / I/O:
- 输入：
  - `runAgent` 原始参数（原接口类型、HTTP/CLI 上下文对象、请求上下文）。
- 输出：
  - `runAgent` 原返回体、错误码、日志副作用与返回字段顺序保持不变。
- 状态：
  - session 与历史上下文来自现有 `gateway` 存储与消息记录接口。
  - 工具执行与持久化结果继续写入既有路径，不引入新状态源。

Boundary Conditions:
- 工具列表为空、单工具、或工具调用失败场景需沿用旧分支行为（含错误转译和降级路径）。
- 非法/未授权工具参数、工具执行抛错、记忆压缩未触发等路径沿用旧容错顺序。
- 命令路径、文案、日志关键字段不改动，避免外部监控和脚本回归。

Error Strategy:
- 重构仅调整模块组织，不新增异常分支。
- 异常传播仍保留原有“最外层统一捕获 + 已有 fallback/重试/降级/返回结构”机制。
- 涉及共享上下文的内部 helper 抽象需保持空值、防御性检查，确保不会引入新空指针崩溃路径。

Concurrency / Idempotence:
- 保持原有异步调用链及共享对象引用约束。
- 工具执行与持久化仍保持当前原子化顺序，避免修改并发写入或重复落库策略。

Rollback:
- 回滚到本次修改前提交点并恢复旧 `runAgent.ts` 与其内联逻辑。
- 若出现行为偏差，优先回退 `src/gateway/agent/*` 改动，再恢复入口导出。
- 文档变更可独立回退，不影响运行时行为。

Task list:
- [x] [CORE] [REQ-0001] 在 `src/gateway` 建立清晰的 `runAgent` 分层目录与边界（如 `agent/`），完成 `coordinator.ts`、`context.ts`、`tools.ts`、`persistence.ts` 的角色定义与导出边界确认。
  - 文件范围: `src/gateway/agent/`, `src/gateway/runAgent.ts`
  - 完成：已创建 `src/gateway/agent/{coordinator,context,tools,persistence}.ts`，`runAgent.ts` 仅导出新入口。

- [x] [CORE] [REQ-0002] 将 `runAgent` 顶层编排迁移到 `agent/coordinator.ts`，形成 `请求接入 -> 上下文组装 -> 工具路径 -> 结果落库 -> 返回` 可读流程链。
  - 文件范围: `src/gateway/runAgent.ts`, `src/gateway/agent/coordinator.ts`
  - 完成：`runAgent` 主流程改为调用 `coordinator.ts` 实现，保持参数透传与返回结构。

- [x] [ARCHIVE-ONLY] [REQ-0002] 将工具相关职责集中到 `agent/tools.ts`，统一包含工具参数解析、工具选择、执行、工具消息拼装等逻辑，避免 `runAgent` 直接承载工具实现细节。
  - 文件范围: `src/gateway/agent/tools.ts`, `src/gateway/runAgent.ts`, `src/gateway/agent/coordinator.ts`
  - 完成：工具解析/白名单/执行/上下文消息构造已集中到 `tools.ts`，`coordinator.ts` 只做流程编排。

- [x] [ARCHIVE-ONLY] [REQ-0002] 将上下文组装与会话处理责任集中到 `agent/context.ts`（`sessionKey/newSession`、系统提示词、历史裁剪、workspace 注入）并提供明确输入输出。
  - 文件范围: `src/gateway/agent/context.ts`, `src/gateway/agent/coordinator.ts`, `src/gateway/runAgent.ts`
  - 完成：`context.ts` 承担 sessionKey、提示词、上下文裁剪、审计记录和 RequestContext 构建。

- [x] [ARCHIVE-ONLY] [REQ-0002] 将消息持久化相关职责集中到 `agent/persistence.ts`，仅处理保存工具调用/会话消息、压缩判断、审计记录等不改语义的路径。
  - 文件范围: `src/gateway/agent/persistence.ts`, `src/gateway/agent/coordinator.ts`
  - 完成：`persistence.ts` 承担工具摘要、用户/助手轮次落库、路由写入与 memory compaction 判定。

- [x] [CORE] [REQ-0003] 保持 `runAgent` 外部契约与返回语义不变，补齐关键行为映射清单并确保回归对齐 `gateway`/`local`/`heartbeat`/`cli agent`。
  - 文件范围: `src/gateway/runAgent.ts`, `src/gateway/agent/`, `docs/wip/20260225-gateway-runagent-restructure/verification.md`, `src/gateway/*.ts`
  - 完成：签名与返回体未变，`npm run build` 通过；新增 `verification.md` 供关键路径抽样对齐。

- [x] [ARCHIVE-ONLY] [REQ-0005] 完成结构说明文档同步，强调“行为不变 + 文件边界重组”。
  - 文件范围: `README.md`, `docs/architecture.md`, `docs/local-quickstart.md`
  - 完成：文档同步说明 `coordinator/context/tools/persistence` 四层和兼容性边界。

Verification:
- 行为与兼容性核对（抽样）：`gateway` 路径命令执行链、`local` 路径、`heartbeat` 路径、`cli agent` 路径的返回和日志关键字段。
- 结构一致性核对：`runAgent.ts` 仅承担入口职责，核心逻辑位于 `src/gateway/agent/*`。
- 文档核对：`README.md`、`docs/architecture.md`、`docs/local-quickstart.md` 明确说明此次重构仅结构化改动、兼容旧行为。

Docs sync:
- [ARCHIVE-ONLY] `README.md` 增补新 `runAgent` 执行链路说明。
- [ARCHIVE-ONLY] `docs/architecture.md` 更新组件边界图与职责关系。
- [ARCHIVE-ONLY] `docs/local-quickstart.md` 同步“内部重构不变更行为”说明。
