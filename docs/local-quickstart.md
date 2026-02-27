# 本地通道（local）完整运行与验收文档

本指南用于在不依赖飞书（`feishu`）的情况下完成 `lainclaw` 本地全流程运行与验收。

> 说明：当前实现基于 `pi-agent-core` 运行时重写，`agent` 与 `gateway` 本地入口共享同一执行模型，逻辑集中在顶层 `src/runtime`，按会话上下文单次执行，不依赖 `run/plan/step` 恢复机制。

## 1. 快速准备

- 安装依赖并编译产物：
```bash
cd src/lainclaw
npm install
npm run build
```

- 说明：本地通道可用于两种模式
  - `provider` 模式：完整模型 + 工具链路（需有效的 `auth` profile）
  - `stub` 模式：不走模型，使用内置回显逻辑（仅用于流程联通性验证）

## 2. 启动 local gateway（推荐两种）

- 前台启动（便于观察）：
```bash
node dist/index.js gateway start --channel local --provider <provider> --profile <profileId> --with-tools --memory
```

- 后台启动：
```bash
node dist/index.js gateway start --channel local --provider <provider> --profile <profileId> --daemon
```

- 查询状态：
```bash
node dist/index.js gateway status --channel local
```

- 停止服务：
```bash
node dist/index.js gateway stop --channel local
```

说明：若无 `feishu` 凭据，仅做流程验证，可先去掉 `--provider`，或显式使用 `--provider stub`（进入 `stub` 回路）。  
`stub` 模式不依赖模型与远端服务，但可验证消息队列、会话持久化与响应格式。

## 3. 消息入口与响应出口（inbox / outbox）

默认路径（可通过环境变量覆盖）：
- inbox: `~/.lainclaw/local-gateway/local-gateway-inbox.jsonl`
- outbox: `~/.lainclaw/local-gateway/local-gateway-outbox.jsonl`

### 3.1 向 inbox 写入请求

纯文本消息（最简）：
```bash
printf '%s\n' '测试一下 local 入口' >> ~/.lainclaw/local-gateway/local-gateway-inbox.jsonl
```

JSON 消息（推荐）：
```bash
cat <<'EOF' >> ~/.lainclaw/local-gateway/local-gateway-inbox.jsonl
{"input":"请告诉我当前时间","sessionKey":"local:demo","requestId":"t-001","accountId":"acct-local-01"}
EOF
```

### 3.2 读取 outbox 响应

```bash
cat ~/.lainclaw/local-gateway/local-gateway-outbox.jsonl
```

期望示例（`run success`）：
```json
{
  "channel": "local",
  "recordedAt": "2026-02-24T10:00:00.000Z",
  "requestId": "lc-1708761600000-abcd",
  "requestSource": "t-001",
  "sessionKey": "local:demo",
  "input": "请告诉我当前时间",
  "output": "...真实回复..."
}
```

说明：`channel` 为入口层可见字段，由 `local` 网关在写入 `outbox` 时统一注入，不在 runtime 里解释来源语义。

错误示例（`run failure`）：
```json
{
  "channel": "local",
  "recordedAt": "2026-02-24T10:00:00.000Z",
  "requestId": "err-1708761600000-abcd",
  "requestSource": "t-002",
  "sessionKey": "local:demo",
  "input": "bad message",
  "error": "agent input required"
}
```

## 4. 全流程验收清单（可复用为集成验收）

### 4.1 生命周期
- 启动 local gateway。
- 发送一条 inbox 消息。
- 在 outbox 读取到成功记录且 `output` 有返回文本内容。
- 查询 `gateway status` 显示当前状态（daemon 场景）。
- `gateway stop` 后再次确认进程停止。

### 4.2 会话与上下文
- 固定 `sessionKey` 连续发送两条消息：
  - 第一次：`你好，我要测试上下文`
  - 第二次：`上面我刚才说了什么`
- outbox 中第二次响应应体现已读取上下文（若 provider 有记忆配置且可用）。
- 单次执行核验：
  - 同一 `sessionKey` 的多轮消息应在返回中可见上下文影响，且不依赖 `~/.lainclaw/runtime` 中的恢复文件。

### 4.3 工具调用
- 在 local 模式下发送：
```json
{"input":"tool:time.now","sessionKey":"local:demo","requestId":"t-tool"}
```
- 与：
```json
{"input":"tool:fs.pwd","sessionKey":"local:demo","requestId":"t-tool-pwd"}
```
- 应有 outbox 记录，`output` 为响应文本；如需调试工具调用，需查看运行日志或会话记录中的工具摘要。

### 4.4 记忆（Memory）
- 启动时附加 `--memory`。
- 发送至少两轮消息后，若开启记忆与会话压缩可观察到内存相关副作用（会体现在会话状态与记忆文件），本地 outbox 仅保留文本 `output`。

### 4.5 异常场景
- 写入非法 JSON 到 inbox（例如单行 `{bad`），服务应不会阻塞主循环，可继续处理后续有效消息。
- 触发工具链连续执行场景，确认输出含有可追溯错误并返回错误记录。

### 4.6 文档收口检查（可选）
- 查看当前 WIP 文档中的提案与实施计划，确认 runtime 行为与文档说明保持一致。

## 5. 环境变量（排障与定制）

- `LAINCLAW_LOCAL_INBOX_PATH`：覆盖 inbox 路径，便于临时环境隔离测试。
- `LAINCLAW_LOCAL_OUTBOX_PATH`：覆盖 outbox 路径。
- `LAINCLAW_LOCAL_SESSION_KEY`：默认会话键（未显式设置 `sessionKey` 时生效）。
- `LAINCLAW_LOCAL_POLL_MS`：本地轮询间隔（默认 1000ms）。

示例：
```bash
LAINCLAW_LOCAL_INBOX_PATH=/tmp/lainclaw/inbox.jsonl \
LAINCLAW_LOCAL_OUTBOX_PATH=/tmp/lainclaw/outbox.jsonl \
node dist/index.js gateway start --channel local --daemon
```

## 6. 清理与回收

- 进程清理：
```bash
node dist/index.js gateway stop --channel local
```
- 临时会话文件可按需清理（谨慎）：
  - `~/.lainclaw/sessions/` 会话轨迹与索引（默认会持续保留）
  - `~/.lainclaw/local-gateway/` 队列文件
  - `~/.lainclaw/service/gateway-service.json` 服务状态文件（若 daemon 启动时创建）
