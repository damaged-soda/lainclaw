import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { runCli } from "../cli/cli.js";
import {
  approveFeishuPairingCode,
  buildFeishuPairingReply,
  isFeishuPaired,
  issueFeishuPairingCode,
  resolveFeishuPairingStatePath,
} from "../channels/feishu/pairing.js";
import { withTempHome } from "./helpers.js";

async function runCliIsolated(argv: string[]): Promise<number> {
  const previousExitCode = process.exitCode;
  try {
    return await runCli(argv);
  } finally {
    process.exitCode = previousExitCode;
  }
}

test("pairing issues a stable code until approval", async () => {
  await withTempHome(async () => {
    const first = await issueFeishuPairingCode("user-1");
    assert.equal(first.created, true);
    assert.match(first.code, /^[A-Z0-9]{8}$/);

    const second = await issueFeishuPairingCode("user-1");
    assert.equal(second.created, false);
    assert.equal(second.code, first.code);
    assert.equal(await isFeishuPaired("user-1"), false);
  });
});

test("pairing approval marks openId as paired and clears pending request", async () => {
  await withTempHome(async (home) => {
    const pending = await issueFeishuPairingCode("user-2");

    const approvedOpenId = await approveFeishuPairingCode(pending.code);
    assert.equal(approvedOpenId, "user-2");
    assert.equal(await isFeishuPaired("user-2"), true);
    assert.equal(await approveFeishuPairingCode(pending.code), null);

    const state = JSON.parse(await fs.readFile(resolveFeishuPairingStatePath(home), "utf-8")) as {
      approvedOpenIds?: string[];
      pending?: Array<unknown>;
    };
    assert.deepEqual(state.approvedOpenIds ?? [], ["user-2"]);
    assert.deepEqual(state.pending ?? [], []);
  });
});

test("pairing approve command executes end to end", async () => {
  await withTempHome(async () => {
    const pending = await issueFeishuPairingCode("user-3");

    const code = await runCliIsolated(["pairing", "approve", pending.code]);
    assert.equal(code, 0);
    assert.equal(await isFeishuPaired("user-3"), true);
  });
});

test("pairing reply only exposes the minimal approve command", () => {
  const reply = buildFeishuPairingReply("user-4", "ABCDEFGH");
  assert.match(reply, /lainclaw pairing approve ABCDEFGH/);
  assert.doesNotMatch(reply, /--channel/);
});

test("removed pairing subcommands and flags are rejected", async () => {
  assert.equal(await runCliIsolated(["pairing", "list"]), 1);
  assert.equal(await runCliIsolated(["pairing", "revoke", "user-1"]), 1);
  assert.equal(await runCliIsolated(["pairing", "approve", "--channel", "feishu", "ABCDEFGH"]), 1);
});

test("model command parser rejects removed tool max steps flag", () => {
  return runCliIsolated(["agent", "--tool-max-steps", "5", "hello"]).then((code) => assert.equal(code, 1));
});

test("agent args parser rejects removed tool max steps flag", () => {
  return runCliIsolated(["agent", "--tool-max-steps", "5", "hello"]).then((code) => {
    assert.equal(code, 1);
  });
});
