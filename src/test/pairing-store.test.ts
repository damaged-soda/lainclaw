import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../cli/cli.js";
import { resolveFeishuGatewayConfig } from "../channels/feishu/config.js";
import {
  approveChannelPairingCode,
  listChannelPairingRequests,
  readChannelAllowFromStore,
  removeChannelAllowFromStoreEntry,
  upsertChannelPairingRequest,
} from "../pairing/pairing-store.js";

type TestEnv = NodeJS.ProcessEnv & { HOME: string };

async function withTempHome<T>(fn: (env: TestEnv) => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-pairing-"));
  const env: TestEnv = { ...process.env, HOME: home };

  try {
    return await fn(env);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTempHomeAndEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-feishu-"));
  const keys = new Set<string>(["HOME", ...Object.keys(overrides)]);
  const previous = new Map<string, string | undefined>();

  for (const key of keys) {
    previous.set(key, process.env[key]);
  }

  process.env.HOME = home;
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("pairing store isolates requests by account id", async () => {
  await withTempHome(async (env) => {
    await upsertChannelPairingRequest({
      channel: "feishu",
      id: "openA",
      accountId: "acc-a",
      env,
    });
    await upsertChannelPairingRequest({
      channel: "feishu",
      id: "openB",
      accountId: "acc-b",
      env,
    });

    const requestsA = await listChannelPairingRequests("feishu", env, "acc-a");
    const requestsB = await listChannelPairingRequests("feishu", env, "acc-b");

    assert.equal(requestsA.length, 1);
    assert.equal(requestsB.length, 1);
    assert.equal(requestsA[0]?.id, "openA");
    assert.equal(requestsB[0]?.id, "openB");
  });
});

test("pairing approval is account-scoped and adds allow-from entry", async () => {
  await withTempHome(async (env) => {
    const pending = await upsertChannelPairingRequest({
      channel: "feishu",
      id: "openC",
      accountId: "acc-c",
      env,
    });

    const mismatch = await approveChannelPairingCode({
      channel: "feishu",
      code: pending.code,
      accountId: "acc-d",
      env,
    });
    assert.equal(mismatch, null);

    const pendingAfterMismatch = await listChannelPairingRequests("feishu", env, "acc-c");
    assert.equal(pendingAfterMismatch.length, 1);

    const approved = await approveChannelPairingCode({
      channel: "feishu",
      code: pending.code,
      accountId: "acc-c",
      env,
    });
    assert.ok(approved);
    assert.equal(approved?.id, "openC");

    const allowFrom = await readChannelAllowFromStore("feishu", env, "acc-c");
    assert.equal(allowFrom.length, 1);
    assert.equal(allowFrom[0], "openc");

    const pendingAfterApproved = await listChannelPairingRequests("feishu", env, "acc-c");
    assert.equal(pendingAfterApproved.length, 0);
  });
});

test("pairing queue capacity is enforced before adding new request", async () => {
  await withTempHome(async (env) => {
    const first = await upsertChannelPairingRequest({
      channel: "feishu",
      id: "openD",
      accountId: "acc-e",
      limits: {
        maxPending: 1,
      },
      env,
    });
    assert.equal(first.created, true);
    assert.match(first.code, /^[A-Z0-9]{8}$/);

    const second = await upsertChannelPairingRequest({
      channel: "feishu",
      id: "openE",
      accountId: "acc-e",
      limits: {
        maxPending: 1,
      },
      env,
    });
    assert.equal(second.code, "");
    assert.equal(second.created, false);
  });
});

test("expired pairing requests are pruned and revoked entries can be removed", async () => {
  await withTempHome(async (env) => {
    const ttlMs = 25;
    const pending = await upsertChannelPairingRequest({
      channel: "feishu",
      id: "openF",
      accountId: "acc-f",
      limits: {
        ttlMs,
      },
      env,
    });

    const immediate = await listChannelPairingRequests("feishu", env, "acc-f", {
      ttlMs,
    });
    assert.equal(immediate.length, 1);
    assert.equal(immediate[0]?.id, "openF");

    await delay(ttlMs * 5);
    const afterTTL = await listChannelPairingRequests("feishu", env, "acc-f", {
      ttlMs,
    });
    assert.equal(afterTTL.length, 0);

    const approved = await approveChannelPairingCode({
      channel: "feishu",
      code: pending.code,
      accountId: "acc-f",
      env,
    });
    assert.equal(approved, null);

    const revoked = await removeChannelAllowFromStoreEntry({
      channel: "feishu",
      entry: "openF",
      accountId: "acc-f",
      env,
    });
    assert.equal(revoked.changed, false);
    assert.equal(revoked.allowFrom.length, 0);
  });
});

test("model command parser rejects removed tool max steps flag", () => {
  return runCli(["agent", "--tool-max-steps", "5", "hello"]).then((code) => assert.equal(code, 1));
});

test("agent args parser rejects removed tool max steps flag", () => {
  return runCli(["agent", "--tool-max-steps", "5", "hello"]).then((code) => {
    assert.equal(code, 1);
  });
});

test("heartbeat parser rejects removed tool max steps flag", async () => {
  await Promise.all([
    runCli(["heartbeat", "run", "--tool-max-steps=5"]).then((code) => assert.equal(code, 1)),
    runCli(["heartbeat", "add", "--tool-max-steps", "5", "summary"]).then((code) => assert.equal(code, 1)),
  ]);
});

test("feishu config ignores legacy tool max steps env vars", async () => {
  await withTempHomeAndEnv({
    LAINCLAW_FEISHU_TOOL_MAX_STEPS: "10",
    FEISHU_TOOL_MAX_STEPS: "12",
  }, async () => {
    const config = await resolveFeishuGatewayConfig();
    assert.equal(config.provider, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(config, "toolMaxSteps"), false);
  });
});

test("feishu config drops legacy toolMaxSteps from stored config", async () => {
  await withTempHomeAndEnv({}, async () => {
    const file = path.join(process.env.HOME ?? "", ".lainclaw", "gateway.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        default: {
          withTools: false,
          toolMaxSteps: 3,
        },
      }, null, 2),
      "utf-8",
    );

    const config = await resolveFeishuGatewayConfig();
    assert.equal(config.withTools, false);
    assert.equal(Object.prototype.hasOwnProperty.call(config, "toolMaxSteps"), false);
  });
});
