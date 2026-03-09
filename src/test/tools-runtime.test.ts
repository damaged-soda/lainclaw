import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeTool } from "../tools/executor.js";
import { listTools } from "../tools/registry.js";

async function withTempWorkspace<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-tools-test-"));
  try {
    return await fn(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

function createContext(cwd: string) {
  return {
    requestId: "test-request",
    sessionId: "test-session",
    sessionKey: "test-session",
    cwd,
  };
}

test("tool registry only exposes the new built-in tool set", () => {
  assert.deepEqual(
    listTools().map((tool) => tool.name),
    ["apply_patch", "edit", "exec", "process", "read", "write"],
  );
});

test("file tools support write, edit aliases, read, and apply_patch", async () => {
  await withTempWorkspace(async (cwd) => {
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
  await withTempWorkspace(async (cwd) => {
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
