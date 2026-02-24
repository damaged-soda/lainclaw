import { parseHeartbeatAddArgs, parseHeartbeatInitArgs, parseHeartbeatRunArgs } from '../parsers/heartbeat.js';
import { addHeartbeatRule, initHeartbeatFile, listHeartbeatRules, removeHeartbeatRule, setHeartbeatRuleEnabled } from '../../heartbeat/store.js';
import { runHeartbeatOnce } from '../../heartbeat/runner.js';

export async function runHeartbeatCommand(args: string[]): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (!subcommand) {
    console.error("Usage: lainclaw heartbeat <init|add|list|remove|enable|disable|run>");
    return 1;
  }

  if (subcommand === "init") {
    const parsed = parseHeartbeatInitArgs(rest);
    const initResult = await initHeartbeatFile({
      overwrite: parsed.force,
      ...(parsed.templatePath ? { templatePath: parsed.templatePath } : {}),
    });
    if (initResult.status === "skipped") {
      console.log(`Skipped: HEARTBEAT.md already exists: ${initResult.targetPath}`);
      console.log(`Use --force to overwrite with ${initResult.templatePath}`);
      return 0;
    }
    if (initResult.status === "updated") {
      console.log(`Updated: ${initResult.targetPath}`);
    } else {
      console.log(`Created: ${initResult.targetPath}`);
    }
    console.log(`Template: ${initResult.templatePath}`);
    return 0;
  }

  if (subcommand === "add") {
    const parsed = parseHeartbeatAddArgs(rest);
    if (parsed.provider && parsed.provider !== "openai-codex") {
      throw new Error(`Unsupported provider: ${parsed.provider}`);
    }
    const rule = await addHeartbeatRule({
      ruleText: parsed.ruleText,
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
      ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
      ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
    });
    console.log(`Added heartbeat rule: ${rule.id}`);
    console.log(JSON.stringify(rule, null, 2));
    return 0;
  }

  if (subcommand === "list") {
    const rules = await listHeartbeatRules();
    console.log(JSON.stringify(rules, null, 2));
    return 0;
  }

  if (subcommand === "remove") {
    const ruleId = rest[0];
    if (!ruleId) {
      console.error("Usage: lainclaw heartbeat remove <ruleId>");
      return 1;
    }
    const removed = await removeHeartbeatRule(ruleId);
    if (!removed) {
      console.error(`Heartbeat rule not found: ${ruleId}`);
      return 1;
    }
    console.log(`Removed heartbeat rule: ${ruleId}`);
    return 0;
  }

  if (subcommand === "enable" || subcommand === "disable") {
    const ruleId = rest[0];
    if (!ruleId) {
      console.error(`Usage: lainclaw heartbeat ${subcommand} <ruleId>`);
      return 1;
    }
    const enabled = subcommand === "enable";
    const updated = await setHeartbeatRuleEnabled(ruleId, enabled);
    if (!updated) {
      console.error(`Heartbeat rule not found: ${ruleId}`);
      return 1;
    }
    console.log(`Updated heartbeat rule ${ruleId}: ${enabled ? "enabled" : "disabled"}`);
    return 0;
  }

  if (subcommand === "run") {
    const parsed = parseHeartbeatRunArgs(rest);
    if (parsed.provider && parsed.provider !== "openai-codex") {
      throw new Error(`Unsupported provider: ${parsed.provider}`);
    }
    const summary = await runHeartbeatOnce({
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
      ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
      ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
      ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary.errors > 0 ? 1 : 0;
  }

  console.error(`Unknown heartbeat subcommand: ${subcommand}`);
  console.error('Usage: lainclaw heartbeat <init|add|list|remove|enable|disable|run>');
  return 1;
}
