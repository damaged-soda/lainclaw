import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../cli/cli.js";
import {
  buildPathsShowReport,
  getPathReportEntry,
  resolveLainclawHome,
  resolvePaths,
} from "../paths/index.js";
import { withTempHome } from "./helpers.js";

function withCapturedStdout<T>(fn: () => Promise<T>): Promise<{ output: string; result: T }> {
  const originalLog = console.log;
  const chunks: string[] = [];
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((value) => String(value)).join(" "));
  };

  return fn()
    .then((result) => ({
      output: chunks.join("\n"),
      result,
    }))
    .finally(() => {
      console.log = originalLog;
    });
}

async function runCliIsolated(argv: string[]): Promise<number> {
  const previousExitCode = process.exitCode;
  try {
    return await runCli(argv);
  } finally {
    process.exitCode = previousExitCode;
  }
}

async function withEnvValue<T>(key: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[key];
  if (typeof value === "string") {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }

  try {
    return await fn();
  } finally {
    if (typeof previous === "string") {
      process.env[key] = previous;
    } else {
      delete process.env[key];
    }
  }
}

test("resolveLainclawHome rejects missing and blank env", () => {
  assert.throws(() => resolveLainclawHome({}), /LAINCLAW_HOME is required/);
  assert.throws(() => resolveLainclawHome({ LAINCLAW_HOME: "   " }), /LAINCLAW_HOME is required/);
});

test("paths show fails fast when LAINCLAW_HOME is missing", async () => {
  await withEnvValue("LAINCLAW_HOME", undefined, async () => {
    const captured = await withCapturedStdout(() => runCliIsolated(["paths", "show"]));
    assert.equal(captured.result, 1);
  });
});

test("resolvePaths derives all runtime paths from LAINCLAW_HOME", async () => {
  await withTempHome(async (home) => {
    const paths = resolvePaths(home);
    assert.equal(resolveLainclawHome(process.env), home);
    assert.equal(paths.workspace, `${home}/workspace`);
    assert.equal(paths.memory, `${home}/memory`);
    assert.equal(paths.authProfiles, `${home}/auth-profiles.json`);
    assert.equal(paths.gatewayConfig, `${home}/gateway.json`);
    assert.equal(paths.sessions, `${home}/sessions`);
    assert.equal(paths.agentState, `${home}/agent-state`);
    assert.equal(paths.service, `${home}/service`);
    assert.equal(paths.heartbeat, `${home}/HEARTBEAT.md`);
    assert.equal(paths.feishuPairing, `${home}/feishu-pairing.json`);
    assert.equal(paths.localGateway, `${home}/local-gateway`);
  });
});

test("path report only exposes visible paths to agent-facing describe", async () => {
  await withTempHome(async (home) => {
    const paths = resolvePaths(home);
    assert.deepEqual(getPathReportEntry("workspace", paths, { visibility: "visible" }), {
      key: "workspace",
      path: paths.workspace,
      kind: "directory",
      visibility: "visible",
      ops: ["read", "write", "edit", "apply_patch", "exec", "list_dir", "glob"],
      purpose: "agent 默认工作目录",
    });
    assert.equal(getPathReportEntry("authProfiles", paths, { visibility: "visible" }), undefined);
  });
});

test("paths show prints the resolved path report", async () => {
  await withTempHome(async (home) => {
    const report = buildPathsShowReport();
    assert.equal(report.lainclawHome, home);
    assert.deepEqual(report.visiblePathKeys, ["workspace", "memory"]);

    const captured = await withCapturedStdout(() => runCliIsolated(["paths", "show"]));
    assert.equal(captured.result, 0);
    const output = JSON.parse(captured.output) as typeof report;
    assert.equal(output.lainclawHome, home);
    assert.equal(output.workspace, `${home}/workspace`);
    assert.deepEqual(output.visiblePathKeys, ["workspace", "memory"]);
    assert.equal(output.paths.find((entry) => entry.key === "workspace")?.agentVisible, true);
    assert.equal(output.paths.find((entry) => entry.key === "authProfiles")?.agentVisible, false);
  });
});
