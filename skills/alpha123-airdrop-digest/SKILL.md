---
name: alpha123-airdrop-digest
description: 访问 alpha123.uk 获取币安 Alpha 今日空投和空投预告；在 heartbeat 场景下负责比较新增空投项目、主动发送提醒并维护自己的 memory.md
---

# alpha123 空投摘要 Skill

这个 skill 用于 heartbeat 场景下的 alpha123 空投预告巡检。

## 数据获取

始终按下面顺序执行：

1. 先访问 `https://alpha123.uk/zh/`，确认页面可达。
2. 再使用浏览器化请求获取 `https://alpha123.uk/api/data?fresh=0`。
3. 如果 API 失败或被拦截，再退回页面分析。

推荐请求方式：

- `curl -L --max-time 20 -A 'Mozilla/5.0' -H 'Referer: https://alpha123.uk/zh/' -H 'Accept: application/json, text/plain, */*' 'https://alpha123.uk/api/data?fresh=0'`

不要默认使用 `fresh=1`。

## Heartbeat 模式

如果当前是 heartbeat 触发：

1. 读取 `~/.lainclaw/skills/alpha123-airdrop-digest/memory.md`。
2. 如果文件不存在，按首次运行处理。
3. 只关注“空投预告”这组数据，不处理“今日空投”。
4. 从当前数据中只保留这些字段：
   - `token`
   - `name`
   - `date`
   - `time`
   - `type`
   - `pretge`
   - `status`
5. 用当前“空投预告”列表和 memory 中上次保存的列表比较，判断是否出现了新增空投项目。

### 新增空投项目的判断

比较时不要直接比较整条文案。使用下面规则：

- 每条记录的唯一标识使用 `token + name`
- 比较时对 `token` 和 `name` 做 `trim` 和小写归一化
- 只要当前预告列表中出现了 memory 里从未出现过的 `token + name` 组合，就视为“有新增空投项目”
- `date`、`time`、`type`、`pretge`、`status` 都不是判重主键，它们只用于快照和提醒文案
- 如果 `pretge` 为 `true`，提醒文案里的类型应写成 `pretge`
- 否则提醒文案里的类型使用 `type` 的原始值或其小写归一化值

### Heartbeat 输出要求

如果发现新增空投项目：

1. 根据当前 heartbeat 指令里的目标渠道和目标用户，调用 `send_message` 主动发送提醒。
2. 提醒内容要简洁，至少包含：
   - 对应项目名
   - 对应 token
   - 日期和时间
   - 类型文案（来自 `type`/`pretge`，仅用于说明，不用于判重）
3. 发送完成后，用最新快照覆盖写回 `~/.lainclaw/skills/alpha123-airdrop-digest/memory.md`。

如果没有新增空投项目：

1. 仍然用最新快照覆盖写回 `~/.lainclaw/skills/alpha123-airdrop-digest/memory.md`。
2. 最终回复 `HEARTBEAT_OK`。

## memory.md 约定

`memory.md` 是这个 skill 的运行态状态文件，不是长篇日志。每次执行都覆盖写回，不要追加历史。

推荐格式：

```md
# alpha123-airdrop-digest memory

last_checked_at: 2026-03-16T12:34:56+08:00
scope: upcoming

- token: KAT
  name: Katana
  date: 2026-03-16
  time: 20:00
  type: tge
  pretge: true
  status: announced
```

注意：

- 只写本 skill 需要的最小字段，不要把完整原始 JSON 全量写进去。
- 如果目录不存在，可以先创建目录再写入。
- heartbeat 场景下，最终文本只承担执行痕迹，不承担业务协议。
