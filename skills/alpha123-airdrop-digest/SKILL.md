---
name: alpha123-airdrop-digest
description: 访问 alpha123.uk 获取币安 Alpha 今日空投和空投预告；在 heartbeat 场景下负责比较新增或变更的空投项目、主动发送提醒并维护自己的 memory.md
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

1. 读取 `/home/leavan/.lainclaw/skills/alpha123-airdrop-digest/memory.md`。
   - 调用 `read` / `write` / `edit` 这类文件工具时，直接使用绝对路径 `/home/leavan/.lainclaw/skills/alpha123-airdrop-digest/memory.md`
   - 读写这个 memory 文件时，优先使用 `read`、`write`、`edit`，不要用 `exec + cat` 代替
2. 如果文件不存在，按首次运行处理。
3. 只关注“空投预告”这组数据，不处理“今日空投”。
4. 从当前数据中只保留这些字段：
   - `token`
   - `name`
   - `date`
   - `time`
   - `points`
   - `type`
   - `pretge`
   - `status`
5. 用当前“空投预告”列表和 memory 中上次保存的列表比较，判断是否出现了新增或变更的空投项目。
6. 另外判断当前时间是否落在某个空投项目的“发放前 1 小时提醒窗口”内。

### 新增或变更空投项目的判断

比较时不要直接比较整条文案。使用下面规则：

- 每条记录的唯一标识使用 `token + name`
- 比较时对 `token` 和 `name` 做 `trim` 和小写归一化
- 只要当前预告列表中出现了 memory 里从未出现过的 `token + name` 组合，就视为“有新增空投项目”
- 如果某个已存在的 `token + name` 组合，其对应的 `date`、`time`、`points`、`type`、`pretge`、`status` 任意一个值发生变化，就视为“有变更空投项目”
- `token + name` 是判重主键；`date`、`time`、`points`、`type`、`pretge`、`status` 是变更比较字段
- 如果 `pretge` 为 `true`，提醒文案里的类型应写成 `pretge`
- 否则提醒文案里的类型使用 `type` 的原始值或其小写归一化值

### 发放前 1 小时再次提醒

除了“新增”或“变更”之外，还要额外执行下面这条规则：

- 对每个空投项目，把 `date + time` 组合成发放时间
- 如果源数据里的 `date`、`time` 没有显式时区信息，一律按北京时间 `Asia/Shanghai` 解释
- 如果 heartbeat prompt 里的当前时间没有特别说明，也一律按北京时间 `Asia/Shanghai` 解释；当前项目里 heartbeat prompt 已明确给出北京时间
- 判断这条规则时，必须使用 heartbeat prompt 里的“本次 heartbeat 当前时间”，不要使用历史上下文里的旧时间
- 判断这条规则时，必须先使用 `exec` 做精确时间差计算；不要凭自然语言估算，不要主观心算
- 推荐使用 Python 计算 `delta_seconds = 发放时间 - heartbeat 当前时间`
- 只有当 `delta_seconds >= 0` 且 `delta_seconds <= 3600` 时，才视为命中发放前 1 小时提醒窗口
- 如果 `delta_seconds > 3600`，绝对不能发送这类提醒
- 如果 `delta_seconds < 0`，说明发放时间已过，也不能发送这类提醒
- 例如空投时间是 `2026-03-16 20:00`，heartbeat 时间是 `2026-03-16T18:03:30+08:00`，两者相差 `1 小时 56 分 30 秒`，不属于 1 小时内，不能发送提醒
- 例如空投时间是 `2026-03-16 20:00`，那么 `2026-03-16 19:00` 到 `2026-03-16 20:00` 之间触发的 heartbeat，都应该再次提醒这个空投项目
- 这条规则独立于“新增/变更”判断；即使项目没有新增、字段也没有变化，只要进入这 1 小时窗口，仍然要发送提醒
- 这类提醒文案里要明确说明“即将发放”或“距离发放不足 1 小时”

### Heartbeat 输出要求

如果发现新增、变更，或者进入了发放前 1 小时提醒窗口：

1. 根据当前 heartbeat 指令里的目标渠道和目标用户，调用 `send_message` 主动发送提醒。
2. 提醒内容要简洁，至少包含：
   - 对应项目名
   - 对应 token
   - 日期和时间
   - points
   - 类型文案（来自 `type`/`pretge`，仅用于说明，不用于判重）
3. 如果是变更项目，要明确说明发生变化的字段；最好写成旧值 -> 新值。
4. 如果是发放前 1 小时提醒，要明确说明这是“临近发放提醒”。
5. 发送完成后，用最新快照覆盖写回 `/home/leavan/.lainclaw/skills/alpha123-airdrop-digest/memory.md`。

如果没有新增、没有变更，也没有项目进入发放前 1 小时提醒窗口：

1. 仍然用最新快照覆盖写回 `/home/leavan/.lainclaw/skills/alpha123-airdrop-digest/memory.md`。
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
  points: 241
  type: tge
  pretge: true
  status: announced
```

注意：

- 只写本 skill 需要的最小字段，不要把完整原始 JSON 全量写进去。
- 如果目录不存在，可以先创建目录再写入。
- heartbeat 场景下，最终文本只承担执行痕迹，不承担业务协议。
