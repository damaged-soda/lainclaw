# Lainclaw CLI

A tiny TypeScript playground entry for the Lainclaw project.

## 快速进入命令行

### 使用全局命令（推荐）

```bash
git clone <repo_root>
cd <repo_root>/src/lainclaw
npm install
npm run bootstrap

lainclaw --help
lainclaw ask 这是一个测试输入
```

### 会话模式（第一阶段）

- 默认会话：`main`
- 指定会话：`--session <name>`
- 强制新会话：`--new-session`

```bash
lainclaw ask --session work 这是我的第一个任务
lainclaw ask --session work 我接着说一件事
lainclaw ask --new-session 重新开始新会话
```

每次成功调用会在 `~/.lainclaw/sessions/<sessionId>.jsonl` 中追加会话转写，并在输出中返回 `sessionKey` 与 `sessionId`。

### 长期记忆与压缩（第二阶段）

- 开启记忆：`--memory`
- 关闭记忆：`--no-memory` 或 `--memory=off`
- 记忆摘要写入：`~/.lainclaw/memory/<sessionKey>.md`
- compaction：当会话条目较多后自动把较早历史压缩到记忆文件，保留最近 12 条用于上下文重放。

```bash
lainclaw ask --session work --memory 这是我希望长期记住的偏好
lainclaw ask --session work --memory 今天我想复盘一下这个项目的背景
lainclaw ask --session work --no-memory 这条消息不写记忆
```

当触发 compaction 后，`ask` 输出会包含 `memoryEnabled: true` 与 `memoryUpdated: true/false`，便于确认是否写入记忆。

## 直接运行编译产物（排错）

```bash
cd <repo_root>/src/lainclaw
npm run build
node ./dist/index.js --help
node ./dist/index.js ask 这是一个测试输入
```

## 本地全局命令安装（npm link）

```bash
cd <repo_root>/src/lainclaw
npm install
npm run build
npm link
```

global 命令：

```bash
lainclaw
lainclaw ask 这是一个测试输入
```

## 在任意目录使用

`npm link` 已把可执行命令挂到全局 bin，因此安装后可直接执行：

```bash
lainclaw
lainclaw ask 你好，帮我总结一下
```

## 飞书（Feishu）网关接入（WS-only）

当前的 `feishu` 通道仅支持 **WebSocket 长连接模式**（不使用 Webhook）。

### 启动方式

```bash
cd <repo_root>/src/lainclaw
npm install
npm run build
npm start -- feishu --app-id <AppID> --app-secret <AppSecret>
```

可选参数：

- `--request-timeout-ms <ms>`：飞书 API 请求超时（默认 10000）

示例（10秒超时）：

```bash
npm start -- feishu --app-id <AppID> --app-secret <AppSecret> --request-timeout-ms 10000
```

也可以直接使用全局命令（安装过 `npm link` 后）：

```bash
lainclaw feishu --app-id <AppID> --app-secret <AppSecret> --request-timeout-ms 10000
```

参数会优先来自命令行，未传入时会从环境变量回退，最后从 `~/.lainclaw/feishu-gateway.json` 读取上次配置（如存在）。

- `LAINCLAW_FEISHU_APP_ID` / `FEISHU_APP_ID`
- `LAINCLAW_FEISHU_APP_SECRET` / `FEISHU_APP_SECRET`
- `LAINCLAW_FEISHU_REQUEST_TIMEOUT_MS` / `FEISHU_REQUEST_TIMEOUT_MS`

### 启动日志说明（你可以按这个判断是否成功）

- `event-dispatch is ready`：SDK event dispatcher 已就绪
- `receive events or callbacks through persistent connection ...`：表示飞书控制台已配置为长连接回调模式
- `[ws] ws client ready`：长连接建立成功
- `[feishu] websocket connection started`：`feishu` 命令的处理循环已启动
- `answered dm for open_id=...`：说明收到 DM 并成功回包（表示端到端链路通了）

### 当前限制（MVP）

- 默认只处理 DM 文本消息（非 DM 或非文本不会响应）
- 依赖 `@larksuiteoapi/node-sdk` 的 WebSocket 能力（`app_id`/`app_secret` 必须有权限）

## 仅给某个工程引用（可选）

```bash
cd <your_project_dir>
npm link lainclaw
```

## 卸载

```bash
npm unlink -g lainclaw
```
