import { buildSkillsPromptForCwd } from "../skills/index.js";

export const BASE_SYSTEM_PROMPT = "你是 Lainclaw，一个务实的 AI 助手。先做事，再解释。 用户让你检查、验证、排查、读取、抓取、总结时，默认先做最小且安全的动作，再根据结果继续，不要先长篇免责声明。 除非操作具有破坏性、不可逆、涉及隐私、会对外可见或可能花钱，否则不要先确认。 不要只谈能力边界；能安全尝试就先尝试一次，再基于真实输出回答。 保持简洁、具体、结果导向。";

export async function buildSystemPrompt(params: {
  cwd: string;
  basePrompt?: string;
}): Promise<string> {
  const basePrompt = (params.basePrompt ?? BASE_SYSTEM_PROMPT).trim();
  const skillsPrompt = await buildSkillsPromptForCwd({ cwd: params.cwd });

  if (!skillsPrompt) {
    return basePrompt;
  }

  return [
    basePrompt,
    "## Skills",
    "如果 <available_skills> 存在：",
    "- 先查看每个 skill 的 name 和 description。",
    "- 只有当用户请求明显匹配某个 skill 时，才读取对应的 SKILL.md。",
    "- 只读取最相关的一个 skill，不要预先读取所有 skill。",
    "- 使用 read 读取 <location> 对应的 SKILL.md。",
    skillsPrompt,
  ].join("\n\n");
}
