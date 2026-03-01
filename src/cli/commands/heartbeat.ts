import { addHeartbeatRule, initHeartbeatFile, listHeartbeatRules, removeHeartbeatRule, setHeartbeatRuleEnabled } from '../../heartbeat/store.js';
import { runHeartbeatOnce } from '../../heartbeat/runner.js';
import { runCommand } from '../shared/result.js';

export type HeartbeatCommandInput =
  | { kind: 'missing' }
  | { kind: 'init'; force?: boolean; templatePath?: string }
  | { kind: 'add'; ruleText: string; provider?: string; profileId?: string; withTools?: boolean; toolAllow?: string[] }
  | { kind: 'list' }
  | { kind: 'remove'; ruleId: string }
  | { kind: 'enable'; ruleId: string }
  | { kind: 'disable'; ruleId: string }
  | { kind: 'run'; provider?: string; profileId?: string; withTools?: boolean; toolAllow?: string[]; memory?: boolean };

export async function runHeartbeatCommand(parsed: HeartbeatCommandInput): Promise<number> {
  return runCommand(async () => {
    if (parsed.kind === 'missing') {
      console.error("Usage: lainclaw heartbeat <init|add|list|remove|enable|disable|run>");
      return 1;
    }

    if (parsed.kind === 'init') {
      const initResult = await initHeartbeatFile({
        overwrite: parsed.force === true,
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

    if (parsed.kind === 'add') {
      const rule = await addHeartbeatRule({
        ruleText: parsed.ruleText,
        ...(parsed.provider ? { provider: parsed.provider } : {}),
        ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
        ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
        ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      });
      console.log(`Added heartbeat rule: ${rule.id}`);
      console.log(JSON.stringify(rule, null, 2));
      return 0;
    }

    if (parsed.kind === 'list') {
      const rules = await listHeartbeatRules();
      console.log(JSON.stringify(rules, null, 2));
      return 0;
    }

    if (parsed.kind === 'remove') {
      const ruleId = parsed.ruleId;
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

    if (parsed.kind === 'enable' || parsed.kind === 'disable') {
      const enabled = parsed.kind === 'enable';
      const ruleId = parsed.kind === 'enable' || parsed.kind === 'disable' ? parsed.ruleId : undefined;
      if (!ruleId) {
        console.error(`Usage: lainclaw heartbeat ${parsed.kind} <ruleId>`);
        return 1;
      }
      const updated = await setHeartbeatRuleEnabled(ruleId, enabled);
      if (!updated) {
        console.error(`Heartbeat rule not found: ${ruleId}`);
        return 1;
      }
      console.log(`Updated heartbeat rule ${ruleId}: ${enabled ? "enabled" : "disabled"}`);
      return 0;
    }

    if (parsed.kind === 'run') {
      const summary = await runHeartbeatOnce({
        ...(parsed.provider ? { provider: parsed.provider } : {}),
        ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
        ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
        ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
        ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
      });
      console.log(JSON.stringify(summary, null, 2));
      return summary.errors > 0 ? 1 : 0;
    }

    console.error('Usage: lainclaw heartbeat <init|add|list|remove|enable|disable|run>');
    return 1;
  });
}
