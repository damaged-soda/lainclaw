# Lainclaw 文档中心

本文档目录用于承载项目知识与交付边界。`Lainclaw` 是一个面向个人的轻量级 AI 助手 CLI，当前阶段目标聚焦“可用性、可维护性、行为可追踪”。

## 目录

- `overview.md`：项目简介与定位（为何存在、适配哪些场景、边界与约束）。
- `architecture.md`：架构说明（命令链路、核心模块、持久化、消息流）。
- `local-quickstart.md`：本地通道（local）完整上手与全流程验收（不依赖 feishu）。
- `test/README.md`：本地验收目录索引。
- `wip`：提案与变更草案目录（当前仓库已有 `docs/wip/20260225-runtime-simplification/`）。

## 文档治理规则

1. 文档目录结构按主题分类，落在 `docs/` 下的 Markdown 文件（例如 `docs/overview.md`、`docs/architecture.md`）。
2. 行为、接口、配置、流程变更必须在提交前同步到相关文档。
   - 运行时职责边界变更同步到 `architecture.md`，必要时同步 `overview.md` 的能力描述。
   - Provider/运行适配层变更需同步 `README.md` 示例、`local-quickstart.md` 和 `overview.md` 的配置说明。
   - 依赖边界与一体化入口改造同步到对应的 WIP 主题目录中的 `implementation_plan.md`，并补充 `implementation` 完成记录。
3. 核心路径遵循 `docs/architecture.md` 与 `src/app/coreCoordinator.ts` 一致：入口统一走 `coreCoordinator`，避免跨模块直接调用。
4. `docs/wip/` 用于一次提案的增量链路（`intent.md`/`spec_delta.md`/`tasks.md`，按主题拆分目录）。
5. 非 WIP 文档更新优先采用小步增量，避免与功能发布不同步。

## 维护建议

- 变更行为时，先在对应的 WIP 主题目录下补充 `spec_delta.md` 明确需求，再更新 `docs/overview.md` 或 `docs/architecture.md`。
- 若涉及新模块、持久化路径或运维流程，优先更新 `architecture.md`。
- 为保持一致性，任何后续“命令参考”建议放在独立文档并在此 README 纳入索引。

## 与项目目标的对齐

本项目文档以“个人 AI 助手”的使用体验为中心，强调：

- 先清楚“能做什么”，再明确“如何接入与配置”。
- 优先记录“我今天如何用它解决问题”，而不是抽象的企业级治理。
