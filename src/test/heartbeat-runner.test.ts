import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveAuthDirectory } from "../auth/configStore.js";
import {
  HEARTBEAT_OK_TOKEN,
  resolveHeartbeatFilePath,
  startHeartbeatRunner,
  type StartHeartbeatRunnerOptions,
} from "../gateway/heartbeatRunner.js";
import { withTempHome } from "./helpers.js";

async function withTempWorkspace<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-heartbeat-test-"));
  try {
    return await fn(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRuntime(): StartHeartbeatRunnerOptions["runtime"] {
  return {
    provider: "codex",
    profileId: "test",
    withTools: true,
    memory: true,
  };
}

test("heartbeat runner ignores missing HEARTBEAT.md", async () => {
  await withTempHome(async () => {
    await withTempWorkspace(async (cwd) => {
      let calls = 0;
      const heartbeat = startHeartbeatRunner({
        cwd,
        runtime: createRuntime(),
        intervalMs: 20,
        runAgentFn: async () => {
          calls += 1;
          return {
            requestId: "req-1",
            sessionKey: "heartbeat",
            sessionId: "session-1",
            text: HEARTBEAT_OK_TOKEN,
          };
        },
      });

      try {
        await sleep(60);
        assert.equal(calls, 0);
      } finally {
        heartbeat.stop();
      }
    });
  });
});

test("heartbeat runner invokes agent with the fixed heartbeat session", async () => {
  await withTempHome(async (home) => {
    await withTempWorkspace(async (cwd) => {
      await fs.mkdir(resolveAuthDirectory(home), { recursive: true });
      await fs.writeFile(
        resolveHeartbeatFilePath(home),
        "# Alpha Watcher\n\n使用 alpha123-airdrop-digest skill 检查空投预告。\n",
        "utf8",
      );

      const invocation = await new Promise<Parameters<NonNullable<StartHeartbeatRunnerOptions["runAgentFn"]>>[0]>(
        (resolve) => {
          const heartbeat = startHeartbeatRunner({
            cwd,
            runtime: createRuntime(),
            intervalMs: 1000,
            runAgentFn: async (request) => {
              heartbeat.stop();
              resolve(request);
              return {
                requestId: "req-1",
                sessionKey: "heartbeat",
                sessionId: "session-1",
                text: HEARTBEAT_OK_TOKEN,
              };
            },
          });
        },
      );

      assert.equal(invocation.channelId, "heartbeat");
      assert.equal(invocation.sessionKey, "heartbeat");
      assert.equal(invocation.runtime?.cwd, cwd);
      assert.equal(invocation.runtime?.memory, false);
      assert.match(invocation.input, /HEARTBEAT\.md/);
      assert.match(invocation.input, /send_message/);
      assert.match(invocation.input, /alpha123-airdrop-digest/);
      assert.match(invocation.input, new RegExp(HEARTBEAT_OK_TOKEN));
    });
  });
});

test("heartbeat runner skips overlapping ticks while one run is still active", async () => {
  await withTempHome(async (home) => {
    await withTempWorkspace(async (cwd) => {
      await fs.mkdir(resolveAuthDirectory(home), { recursive: true });
      await fs.writeFile(resolveHeartbeatFilePath(home), "do work\n", "utf8");

      let calls = 0;
      let releaseCurrentRun: (() => void) | undefined;
      const currentRun = new Promise<void>((resolve) => {
        releaseCurrentRun = resolve;
      });

      const heartbeat = startHeartbeatRunner({
        cwd,
        runtime: createRuntime(),
        intervalMs: 10,
        runAgentFn: async () => {
          calls += 1;
          await currentRun;
          return {
            requestId: "req-1",
            sessionKey: "heartbeat",
            sessionId: "session-1",
            text: HEARTBEAT_OK_TOKEN,
          };
        },
      });

      try {
        await sleep(35);
        assert.equal(calls, 1);
        releaseCurrentRun?.();
        await sleep(5);
      } finally {
        heartbeat.stop();
        releaseCurrentRun?.();
      }
    });
  });
});
