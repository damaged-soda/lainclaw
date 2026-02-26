/**
 * Gateway 模块主入口。
 *
 * 统一对外承载 runAgent 导出，避免重复胶水层散落在多个文件。
 */
export { runAgent } from "../runtime/index.js";
