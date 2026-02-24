import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
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
