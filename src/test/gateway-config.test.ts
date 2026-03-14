import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  loadFeishuChannelConfigWithSources,
  persistFeishuChannelConfig,
  resolveFeishuChannelConfig,
} from "../channels/feishu/config.js";
import { runCli } from "../cli/cli.js";
import { resolveGatewayConfigPath } from "../gateway/configFile.js";
import {
  loadGatewayRuntimeConfigWithSources,
  persistGatewayRuntimeConfig,
  resolveGatewayRuntimeConfig,
} from "../gateway/runtimeConfig.js";
import { withTempHome } from "./helpers.js";

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
  }

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
    for (const [key, value] of previous.entries()) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function runCliIsolated(argv: string[]): Promise<number> {
  const previousExitCode = process.exitCode;
  try {
    return await runCli(argv);
  } finally {
    process.exitCode = previousExitCode;
  }
}

test("gateway config persists runtimeConfig and channelConfig in separate nested scopes", async () => {
  await withTempHome(async (home) => {
    await persistGatewayRuntimeConfig({
      provider: "Stub",
      withTools: false,
      memory: true,
    });
    await persistFeishuChannelConfig({
      appId: "app-id",
      appSecret: "app-secret",
      requestTimeoutMs: 5000,
    }, "feishu");

    const raw = JSON.parse(await fs.readFile(resolveGatewayConfigPath(home), "utf-8")) as Record<string, unknown>;
    assert.deepEqual(raw.default, {
      runtimeConfig: {
        provider: "stub",
        withTools: false,
        memory: true,
      },
    });
    assert.deepEqual(raw.channels, {
      feishu: {
        channelConfig: {
          appId: "app-id",
          appSecret: "app-secret",
          requestTimeoutMs: 5000,
        },
      },
    });

    const runtime = await loadGatewayRuntimeConfigWithSources();
    assert.deepEqual(runtime, {
      runtimeConfig: {
        provider: "stub",
        withTools: false,
        memory: true,
      },
      sources: {
        provider: "default",
        withTools: "default",
        memory: "default",
      },
    });

    const channel = await loadFeishuChannelConfigWithSources("feishu");
    assert.deepEqual(channel, {
      channelConfig: {
        appId: "app-id",
        appSecret: "app-secret",
        requestTimeoutMs: 5000,
      },
      sources: {
        appId: "channel",
        appSecret: "channel",
        requestTimeoutMs: "channel",
      },
    });
  });
});

test("legacy flat gateway config no longer participates in runtime or channel resolution", async () => {
  await withTempHome(async (home) => {
    const configPath = resolveGatewayConfigPath(home);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        default: {
          provider: "legacy-provider",
          withTools: false,
        },
        channels: {
          feishu: {
            appId: "legacy-app",
            appSecret: "legacy-secret",
          },
        },
      }, null, 2),
      "utf-8",
    );

    await withEnv({
      LAINCLAW_GATEWAY_PROVIDER: undefined,
      LAINCLAW_GATEWAY_PROFILE_ID: undefined,
      LAINCLAW_GATEWAY_WITH_TOOLS: undefined,
      LAINCLAW_GATEWAY_MEMORY: undefined,
      LAINCLAW_FEISHU_APP_ID: undefined,
      FEISHU_APP_ID: undefined,
      LAINCLAW_FEISHU_APP_SECRET: undefined,
      FEISHU_APP_SECRET: undefined,
      LAINCLAW_FEISHU_REQUEST_TIMEOUT_MS: undefined,
      FEISHU_REQUEST_TIMEOUT_MS: undefined,
    }, async () => {
      const runtime = await resolveGatewayRuntimeConfig(undefined);
      assert.equal(runtime.provider, undefined);
      assert.equal(runtime.withTools, true);
      assert.equal(runtime.memory, false);

      const channel = await resolveFeishuChannelConfig({}, "feishu");
      assert.equal(channel.appId, undefined);
      assert.equal(channel.appSecret, undefined);
      assert.equal(channel.requestTimeoutMs, 10000);
    });
  });
});

test("gateway runtime config resolves from gateway-scoped env vars", async () => {
  await withTempHome(async () => {
    await withEnv({
      LAINCLAW_GATEWAY_PROVIDER: "Codex",
      LAINCLAW_GATEWAY_PROFILE_ID: "profile-a",
      LAINCLAW_GATEWAY_WITH_TOOLS: "false",
      LAINCLAW_GATEWAY_MEMORY: "true",
    }, async () => {
      const runtime = await resolveGatewayRuntimeConfig(undefined);
      assert.deepEqual(runtime, {
        provider: "codex",
        profileId: "profile-a",
        withTools: false,
        memory: true,
      });
    });
  });
});

test("gateway config parser rejects mixing channelConfig and runtimeConfig scopes", async () => {
  await withTempHome(async () => {
    const [defaultScopedChannelConfig, channelScopedRuntimeConfig] = await Promise.all([
      runCliIsolated(["gateway", "config", "set", "--app-id", "app-id"]),
      runCliIsolated(["gateway", "config", "set", "--channel", "feishu", "--with-tools", "false"]),
    ]);

    assert.equal(defaultScopedChannelConfig, 1);
    assert.equal(channelScopedRuntimeConfig, 1);
  });
});

test("heartbeat command is no longer available", async () => {
  assert.equal(await runCliIsolated(["heartbeat", "list"]), 1);
});

test("gateway rejects removed heartbeat flags", async () => {
  const [startCode, configCode] = await Promise.all([
    runCliIsolated(["gateway", "start", "--heartbeat-enabled"]),
    runCliIsolated(["gateway", "config", "set", "--channel", "feishu", "--heartbeat-interval-ms", "1000"]),
  ]);

  assert.equal(startCode, 1);
  assert.equal(configCode, 1);
});

test("gateway rejects removed pairing config flags", async () => {
  const [startCode, configCode] = await Promise.all([
    runCliIsolated(["gateway", "start", "--pairing-policy", "pairing"]),
    runCliIsolated(["gateway", "config", "set", "--channel", "feishu", "--pairing-allow-from", "user-1"]),
  ]);

  assert.equal(startCode, 1);
  assert.equal(configCode, 1);
});
