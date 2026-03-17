import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeTool } from "../tools/executor.js";
import { listTools } from "../tools/registry.js";
import { resolveBuiltinSkillsDir } from "../skills/index.js";
import { clearOutboundChannels, registerOutboundChannel } from "../tools/outboundRegistry.js";
import { resolvePaths } from "../paths/index.js";
import { withTempHome } from "./helpers.js";

async function withTempWorkspace<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-tools-test-"));
  try {
    return await fn(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

function createContext(cwd: string, sessionKey = "test-session") {
  return {
    requestId: "test-request",
    sessionId: "test-session",
    sessionKey,
    cwd,
  };
}

test("tool registry only exposes the new built-in tool set", () => {
  assert.deepEqual(
    listTools().map((tool) => tool.name),
    ["apply_patch", "edit", "exec", "glob", "list_dir", "path_describe", "process", "read", "send_message", "write"],
  );
});

test("file tools support write, edit aliases, read, and apply_patch", async () => {
  await withTempHome(async (home) => {
    const cwd = resolvePaths(home).workspace;
    const context = createContext(cwd);

    const writeResult = await executeTool(
      {
        id: "write-1",
        name: "write",
        args: { path: "demo.txt", content: "hello world", createDir: true },
      },
      context,
    );
    assert.equal(writeResult.result.ok, true);

    const editResult = await executeTool(
      {
        id: "edit-1",
        name: "edit",
        args: {
          file_path: "demo.txt",
          old_string: "world",
          new_string: "lainclaw",
        },
      },
      context,
    );
    assert.equal(editResult.result.ok, true);

    const readResult = await executeTool(
      {
        id: "read-1",
        name: "read",
        args: { file_path: "demo.txt", limit: 20 },
      },
      context,
    );
    assert.equal(readResult.result.ok, true);
    assert.equal(readResult.result.content, "hello lainclaw");

    const patchResult = await executeTool(
      {
        id: "patch-1",
        name: "apply_patch",
        args: {
          input: `*** Begin Patch
*** Add File: second.txt
+two
*** Update File: demo.txt
@@
-hello lainclaw
+hello tools
*** End Patch`,
        },
      },
      context,
    );
    assert.equal(patchResult.result.ok, true);
    assert.equal(await fs.readFile(path.join(cwd, "demo.txt"), "utf8"), "hello tools\n");
    assert.equal(await fs.readFile(path.join(cwd, "second.txt"), "utf8"), "two\n");
  });
});

test("exec and process manage background sessions within the same session scope", async () => {
  await withTempHome(async (home) => {
    const cwd = resolvePaths(home).workspace;
    await fs.mkdir(cwd, { recursive: true });
    const context = createContext(cwd);

    const execResult = await executeTool(
      {
        id: "exec-1",
        name: "exec",
        args: {
          command:
            "node -e \"process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{process.stdout.write('final:'+d);process.exit(0);});setInterval(()=>{},1000)\"",
          background: true,
        },
      },
      context,
    );
    assert.equal(execResult.result.ok, true);
    const sessionId = (execResult.result.data as { sessionId?: string } | undefined)?.sessionId;
    assert.ok(sessionId);

    const writeResult = await executeTool(
      {
        id: "process-write-1",
        name: "process",
        args: { action: "write", sessionId, data: "done\n", eof: true },
      },
      context,
    );
    assert.equal(writeResult.result.ok, true);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const pollResult = await executeTool(
      {
        id: "process-poll-1",
        name: "process",
        args: { action: "poll", sessionId, timeout: 100 },
      },
      context,
    );
    assert.equal(pollResult.result.ok, true);
    assert.deepEqual(pollResult.result.data, {
      sessionId,
      status: "completed",
      stdout: "final:done\n",
      stderr: "",
      exitCode: 0,
      exitSignal: null,
    });
  });
});

test("read can access built-in skill files outside the current workspace", async () => {
  await withTempHome(async (home) => {
    const cwd = resolvePaths(home).workspace;
    const context = createContext(cwd);
    const builtInSkillPath = path.join(
      resolveBuiltinSkillsDir(),
      "alpha123-airdrop-digest",
      "SKILL.md",
    );

    const readResult = await executeTool(
      {
        id: "read-skill-1",
        name: "read",
        args: { path: builtInSkillPath, limit: 40 },
      },
      context,
    );

    assert.equal(readResult.result.ok, true);
    assert.match(readResult.result.content ?? "", /alpha123-airdrop-digest/);
    assert.match(readResult.result.content ?? "", /今日空投/);
  });
});

test("file tools can read and write inside the visible memory path", async () => {
  await withTempHome(async (home) => {
    const paths = resolvePaths(home);
    const context = createContext(paths.workspace);
    const memoryFile = path.join(paths.memory, "notes.md");

    const writeResult = await executeTool(
      {
        id: "write-memory-1",
        name: "write",
        args: {
          path: memoryFile,
          content: "first",
          createDir: true,
        },
      },
      context,
    );
    assert.equal(writeResult.result.ok, true);
    assert.equal(await fs.readFile(memoryFile, "utf8"), "first");

    const editResult = await executeTool(
      {
        id: "edit-memory-1",
        name: "edit",
        args: {
          path: memoryFile,
          oldText: "first",
          newText: "second",
        },
      },
      context,
    );
    assert.equal(editResult.result.ok, true);

    const readResult = await executeTool(
      {
        id: "read-memory-1",
        name: "read",
        args: {
          path: memoryFile,
        },
      },
      context,
    );
    assert.equal(readResult.result.ok, true);
    assert.equal(readResult.result.content, "second");
  });
});

test("file tools cannot escape to the legacy HOME directory", async () => {
  await withTempHome(async (home) => {
    const context = createContext(resolvePaths(home).workspace);
    const legacyHome = process.env.HOME;
    assert.ok(legacyHome);

    const writeResult = await executeTool(
      {
        id: "write-legacy-home-1",
        name: "write",
        args: {
          path: path.join(legacyHome, "escape.txt"),
          content: "forbidden",
          createDir: true,
        },
      },
      context,
    );

    assert.equal(writeResult.result.ok, false);
    assert.match(writeResult.result.error?.message ?? "", /path escapes workspace root/);
  });
});

test("list_dir, glob, and path_describe expose visible runtime paths", async () => {
  await withTempHome(async (home) => {
    const paths = resolvePaths(home);
    await fs.mkdir(path.join(paths.workspace, "sub"), { recursive: true });
    await fs.writeFile(path.join(paths.workspace, "a.md"), "alpha", "utf8");
    await fs.writeFile(path.join(paths.workspace, "sub", "b.md"), "beta", "utf8");

    const context = createContext(paths.workspace);
    const listResult = await executeTool(
      {
        id: "list-dir-1",
        name: "list_dir",
        args: {
          root: "workspace",
        },
      },
      context,
    );
    assert.equal(listResult.result.ok, true);
    assert.match(listResult.result.content ?? "", /\[file\] a\.md/);
    assert.match(listResult.result.content ?? "", /\[directory\] sub/);

    const globResult = await executeTool(
      {
        id: "glob-1",
        name: "glob",
        args: {
          root: "workspace",
          pattern: "**/*.md",
        },
      },
      context,
    );
    assert.equal(globResult.result.ok, true);
    assert.match(globResult.result.content ?? "", /a\.md/);
    assert.match(globResult.result.content ?? "", /sub\/b\.md/);

    const describeResult = await executeTool(
      {
        id: "path-describe-1",
        name: "path_describe",
        args: {
          key: "memory",
        },
      },
      context,
    );
    assert.equal(describeResult.result.ok, true);
    assert.deepEqual(describeResult.result.data, {
      key: "memory",
      path: paths.memory,
      kind: "directory",
      visibility: "visible",
      ops: ["read", "write", "edit", "list_dir", "glob"],
      purpose: "长期记忆和人工沉淀",
    });
  });
});

test("send_message only works inside heartbeat sessions", async () => {
  await withTempWorkspace(async (cwd) => {
    const result = await executeTool(
      {
        id: "send-message-1",
        name: "send_message",
        args: {
          channel: "feishu",
          to: "ou_test",
          text: "hello",
        },
      },
      createContext(cwd),
    );

    assert.equal(result.result.ok, false);
    assert.equal(result.result.error?.code, "execution_error");
    assert.match(result.result.error?.message ?? "", /heartbeat sessions/);
  });
});

test("send_message uses registered outbound channels in heartbeat sessions", async () => {
  await withTempWorkspace(async (cwd) => {
    const sent: Array<{ replyTo: string; text: string }> = [];
    clearOutboundChannels();
    registerOutboundChannel("feishu", async (replyTo, text) => {
      sent.push({ replyTo, text });
    });

    try {
      const result = await executeTool(
        {
          id: "send-message-2",
          name: "send_message",
          args: {
            channel: "feishu",
            to: "ou_test",
            text: "airdrop alert",
          },
        },
        createContext(cwd, "heartbeat"),
      );

      assert.equal(result.result.ok, true);
      assert.deepEqual(sent, [{ replyTo: "ou_test", text: "airdrop alert" }]);
    } finally {
      clearOutboundChannels();
    }
  });
});

test("send_message can send directly via Feishu webhook", async () => {
  await withTempWorkspace(async (cwd) => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({
        code: 0,
        msg: "success",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    try {
      const result = await executeTool(
        {
          id: "send-message-webhook-1",
          name: "send_message",
          args: {
            channel: "feishu",
            webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook-token",
            webhookSecret: "bot-secret",
            text: "airdrop alert",
          },
        },
        createContext(cwd, "heartbeat"),
      );

      assert.equal(result.result.ok, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.url, "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook-token");
      assert.equal(requests[0]?.body.msg_type, "text");
      assert.deepEqual(requests[0]?.body.content, { text: "airdrop alert" });
      assert.equal(typeof requests[0]?.body.timestamp, "string");
      assert.equal(typeof requests[0]?.body.sign, "string");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
