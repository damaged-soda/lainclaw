import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildSkillsPrompt, loadSkills } from "../skills/index.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-skills-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeSkill(dir: string, name: string, description: string): Promise<string> {
  const skillDir = path.join(dir, name);
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  await fs.writeFile(
    skillPath,
    `---
name: ${name}
description: ${description}
---

# ${name}
`,
    "utf8",
  );
  return skillPath;
}

test("workspace skills override built-in skills with the same name", async () => {
  await withTempDir(async (cwd) => {
    const builtinDir = path.join(cwd, "builtin");
    const workspaceDir = path.join(cwd, "skills");
    await fs.mkdir(builtinDir, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });

    const builtinSkillPath = await writeSkill(
      builtinDir,
      "alpha123-airdrop-digest",
      "builtin description",
    );
    const workspaceSkillPath = await writeSkill(
      workspaceDir,
      "alpha123-airdrop-digest",
      "workspace description",
    );

    const skills = await loadSkills({
      cwd,
      builtinSkillsDir: builtinDir,
    });

    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, "alpha123-airdrop-digest");
    assert.equal(skills[0]?.description, "workspace description");
    assert.equal(skills[0]?.source, "workspace");
    assert.equal(skills[0]?.filePath, workspaceSkillPath);
    assert.notEqual(skills[0]?.filePath, builtinSkillPath);
  });
});

test("skills prompt renders compact available_skills xml", async () => {
  const prompt = buildSkillsPrompt([
    {
      name: "alpha123-airdrop-digest",
      description: "访问 alpha123.uk 获取今日空投和空投预告",
      filePath: "/tmp/skills/alpha123-airdrop-digest/SKILL.md",
      baseDir: "/tmp/skills/alpha123-airdrop-digest",
      source: "builtin",
    },
  ]);

  assert.match(prompt, /<available_skills>/);
  assert.match(prompt, /<name>alpha123-airdrop-digest<\/name>/);
  assert.match(prompt, /<location>\/tmp\/skills\/alpha123-airdrop-digest\/SKILL\.md<\/location>/);
});
