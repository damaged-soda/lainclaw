---
name: alpha123-airdrop-digest
description: 访问 alpha123.uk 获取币安 Alpha 今日空投和空投预告
---

# alpha123 空投摘要 Skill

当用户提到以下意图时使用本 skill：

- alpha123
- 币安 Alpha
- 今日空投
- 空投预告
- 未来空投

执行步骤：

1. 先访问 `https://alpha123.uk/zh/` 确认页面可达。
2. 然后优先请求 `https://alpha123.uk/api/data?fresh=1`，因为页面实际数据来自这个接口。
3. 如果 API 失败或被拦截，就退回页面抓取，并按页面内联脚本中的 `todayAirdrops` 与 `upcomingAirdrops` 规则整理数据。
4. 输出时必须同时包含两组结果：
   - 今日空投
   - 空投预告
5. 每组结果尽量包含：
   - 项目名
   - 日期或时间
   - 类型
   - 阶段
6. 如果某一组没有数据，要明确写“今日空投暂无数据”或“空投预告暂无数据”，不能只返回另一组。

推荐做法：

- 先用 `exec` 执行 `curl -L --max-time 20 -A 'Mozilla/5.0' 'https://alpha123.uk/zh/'`
- 如果接口可达，再尝试 `curl -L --max-time 20 -A 'Mozilla/5.0' 'https://alpha123.uk/api/data?fresh=1'`
- 如果接口不可用，就从页面结构和页面内联脚本里提取当前需要的信息

优先使用现有工具完成，不要发明新的抓取方式。
