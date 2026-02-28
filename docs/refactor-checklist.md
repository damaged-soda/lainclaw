# 重构回归检查清单（最小版）

本清单用于每次重构后快速确认 CLI 行为是否仍可用。

## 1. 先决条件：构建与测试

- 运行构建：
  - `npm run build`
  - 预期现象：命令成功返回，生成 `dist/`，并且 `dist/index.js` 存在且可执行。

- 运行测试：
  - `npm test`
  - 预期现象：命令成功返回，测试通过（`npm test` 内部会先构建）。

## 2. 手工冒烟检查（至少 6 条）

每条建议都只做“命令 + 预期现象”，不要求完全一致的输出文本。

1. `npm run build && node dist/index.js --help`
   - 预期现象：命令成功，进程退出码 0；输出 CLI 顶层帮助，至少包含 `agent`、`gateway`、`pairing`、`tools`、`heartbeat`、`auth` 这些子命令入口信息（或可直接看到可用命令列表）。

2. `npm run build && node dist/index.js --help`
   - 预期现象：与上一条一致（兼容 `node dist/index.js` 与 `lainclaw` 同入口），可视为等效入口冒烟。

3. `npm run build && node dist/index.js gateway start --help`
   - 预期现象：显示 `gateway start` 的参数/用法说明，未尝试实际启动进程。

4. `npm run build && node dist/index.js gateway config show`
   - 预期现象：命令成功（通常退出码 0），输出网关配置视图（即使为空也应给出当前已知配置或空配置提示，不应崩溃）。

5. `npm run build && node dist/index.js gateway config clear --help`
   - 预期现象：显示 `gateway config clear` 的帮助信息，提示参数/确认逻辑（不要求文案完全一致）。

6. `npm run build && node dist/index.js gateway status --help`
   - 预期现象：显示 `gateway status` 帮助信息，并能看到状态查询入口与可选参数。

7. `npm run build && node dist/index.js gateway stop --help`
   - 预期现象：显示停止网关的参数与用法说明，不执行真实停止逻辑。

8. `npm run build && node dist/index.js heartbeat status --help`
   - 预期现象：显示 heartbeat 命令组帮助，确认命令路由仍然可达（与重构后的入口层保持一致）。
