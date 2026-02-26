/**
 * Gateway 模块主入口。
 *
 * 统一对外承载 runAgent 导出，直接走 bootstrap 组装后的 CoreCoordinator。
 */
export { runAgent } from "../bootstrap/coreCoordinator.js";
export type { CoreRunAgentOptions } from "../core/contracts.js";
