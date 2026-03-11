对架构性改造，默认分阶段推进；每阶段都要明确目标、边界和验收标准，并且必须单独保留一个“收口阶段”来清理迁移期兼容层与冗余代码。

调试或排障时，优先查看 `LANGFUSE_BASE_URL` 对应实例中的 trace `lainclaw.agent.run`；本项目的 debug 日志不会输出到 stdout，而是以 `EVENT/DEBUG` observation 挂在对应 trace 下，必要时可直接用已有 `LANGFUSE_*` 环境变量查询 `/api/public/traces` 和 `/api/public/observations`。
