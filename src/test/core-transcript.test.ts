import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { createCoreCoordinator } from "../core/index.js";
import { createRuntimeAdapter } from "../runtime/adapter.js";
import { createSessionAdapter } from "../sessions/adapter.js";
import { getSessionTranscriptPath } from "../sessions/sessionStore.js";
import { createToolsAdapter } from "../tools/adapter.js";
import { withTempHome } from "./helpers.js";

test("core coordinator still appends transcript messages and tool summaries", async () => {
  await withTempHome(async () => {
    const coordinator = createCoreCoordinator({
      sessionAdapter: createSessionAdapter(),
      toolsAdapter: createToolsAdapter(),
      runtimeAdapter: createRuntimeAdapter({
        run: async (input) => ({
          route: "adapter.stub",
          stage: "adapter.stub.test",
          result: "assistant reply",
          toolCalls: [
            {
              id: "tool-1",
              name: "write",
              args: {
                path: "output.txt",
                content: "hello",
              },
            },
          ],
          toolResults: [
            {
              call: {
                id: "tool-1",
                name: "write",
              },
              result: {
                ok: true,
                content: "Wrote output.txt",
                meta: {
                  tool: "write",
                  durationMs: 5,
                },
              },
            },
          ],
          provider: input.provider,
          profileId: input.profileId,
        }),
      }),
    });

    const result = await coordinator.runAgent("please write this", {
      provider: "stub",
      profileId: "default",
      sessionKey: "transcript-session",
      withTools: true,
      memory: true,
    });
    const transcriptPath = getSessionTranscriptPath(result.sessionId);
    const raw = await fs.readFile(transcriptPath, "utf-8");
    const lines = raw.trim().split("\n").map((line) => JSON.parse(line) as {
      type: string;
      message: {
        role: string;
        content: string;
      };
    });

    assert.equal(lines.length, 3);
    assert.equal(lines[0]?.message.role, "system");
    assert.match(lines[0]?.message.content ?? "", /toolResults:/);
    assert.equal(lines[1]?.message.role, "user");
    assert.equal(lines[1]?.message.content, "please write this");
    assert.equal(lines[2]?.message.role, "assistant");
    assert.equal(lines[2]?.message.content, "assistant reply");
  });
});
