/**
 * Gateway 模块主入口。
 *
 * 统一对外承载边界 API，走 agent 入口层后进入 core 协议编排。
 */
export { runAgent } from "../agent/invoke.js";
