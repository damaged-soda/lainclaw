# verification.md
- WIP: `docs/wip/20260225-gateway-runagent-restructure/`
- Date / Reviewer: 2026-02-25 / Codex
- Test scope: `smoke`, `docs`
- Result: `GO`
- Docs updated: `README.md`, `docs/architecture.md`, `docs/local-quickstart.md`, `docs/wip/20260225-gateway-runagent-restructure/implementation_plan.md`

| REQ-ID | Task ref | Type | Check Command | Expected | Actual/Notes | Evidence | Result | Blocker |
|---|---|---|---|---|---|---|---|---|
| REQ-0001 | [CORE] [REQ-0001] Task-01 | auto | `rg -n "export \{ runAgent \} from \"./agent/coordinator.js\"" src/gateway/runAgent.ts` | 导出仅保留薄入口 | 命中一行 `export { runAgent } from "./agent/coordinator.js";` | runAgent 文件仅保留单行导出 | Pass | none |
| REQ-0002 | [CORE] [REQ-0002] Task-02 | auto | `npm -s run build` | 编译通过 | TypeScript 编译通过，返回码 0 | `npm run -s build` 输出空（成功） | Pass | none |
| REQ-0002 | [ARCHIVE-ONLY] [REQ-0002] Task-03~05 | auto | `rg -n "agent/(coordinator|context|tools|persistence)\.ts" src/gateway/agent/*.ts src/gateway/runAgent.ts` | 结构职责分层并且路径引用无断裂 | 发现四个职责文件存在，runAgent 为薄入口，coordinator 聚合流程 | `runAgent.ts` 只有导出语句；`coordinator.ts`/`context.ts`/`tools.ts`/`persistence.ts` 均被加载引用 | 模块边界符合计划定义 | Pass | none |
| REQ-0002 | [ARCHIVE-ONLY] [REQ-0004] Task-01~05 | manual | `rg -n "agent/" docs/architecture.md README.md docs/local-quickstart.md` | 文档记录目录边界与行为兼容说明 | 文档已包含 `agent/coordinator/context/tools/persistence` 与“内部重构仅结构调整”说明 | `docs/architecture.md` 架构图及职责段落；`README.md` 与 `docs/local-quickstart.md` 提示兼容声明 | Pass | none |
| REQ-0003 | [CORE] [REQ-0003] Task-06 | mixed | `node dist/index.js agent "hello"` | 返回体字段与行为保持 stub 路径一致，不抛错 | 返回成功 JSON，包含 `success/requestId/route/stage/result/sessionKey/sessionId/memoryEnabled` 等约定字段 | 输出为 `adapter.stub.echo`，`success: true` | Pass | none |
| REQ-0003 | [CORE] [REQ-0003] Task-06 | mixed | `node dist/index.js agent "/new"` | `/new` 行为保持新会话输出语义 | 返回 `route=system`、`stage=gateway.new_session` 与 `result` 包含 `sessionId` | 命中 `gateway.new_session` 语义 | Pass | none |
| REQ-0003 | [CORE] [REQ-0003] Task-06 | manual | `node dist/index.js heartbeat add "测试心跳"` && `node dist/index.js heartbeat run --memory` && `node dist/index.js gateway status --channel local --pid-file ...` | heartbeat 命令链路可达，返回结构正常 | heartbeat rule 创建与执行可成功；gateway status 在启动/停止场景可解析 | `heartbeat add` 与 `heartbeat run --memory` 返回结构化结果；`gateway status` 返回运行态 JSON | Pass | none |
| REQ-0003 | [CORE] [REQ-0003] Task-06 | manual | `node dist/index.js gateway start --channel local --daemon` && `node dist/index.js gateway stop --channel local` && `node dist/index.js gateway status --channel local` | local 网关服务可启动/停止，状态准确 | 服务能 daemon 启动、停止并返回 `stopped` 状态 | 启动 pid、status 运行态、stop 成功、最终 status stopped | Pass | none |
| REQ-0005 | [ARCHIVE-ONLY] [REQ-0005] Task-07 | manual | `cat docs/wip/20260225-gateway-runagent-restructure/implementation_plan.md` 与文档差异 | 文档同步完成并说明兼容性 | 文档已同步到 3 个目标文件和计划文件 | 文案包含 `agent/` 四层、兼容性声明 | Pass | none |

## Blockers
- 需要关注的边界说明：`tasks.md` 当前仍沿用旧模块命名（`agentCoordinator.ts` 等），与实际目录结构(`agent/coordinator.ts`)存在文案不一致，但不影响执行。

## Verification coverage
- Full test suite executed: no (`npm test` 运行了 4 条 pairing-store 回归；未覆盖新拆分 runAgent 全量场景)
- Docs consistency checked: yes (`README.md`, `docs/architecture.md`, `docs/local-quickstart.md`, `implementation_plan.md`)
- Docs update status: done (文档已更新)
- Open gaps: gateway/local/heartbeat 的全量语义回归（含实际路由差异、工具链回归）未做自动化回放，仅做烟雾级可达性验证。

## GO/NO-GO
- Result: `GO`
- 说明：`src/gateway/runAgent` 重构在编译、主路径 smoke、文档同步方面通过；尚需安排一轮更完整的回归（含真实 gateway/local 长链路）以便满足发布前全量验证。
