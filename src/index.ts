#!/usr/bin/env node
import { initLangfuseTracing, shutdownLangfuseTracing } from "./observability/langfuse.js";
import { runCli } from './cli/cli.js';

initLangfuseTracing();

runCli(process.argv.slice(2))
  .then(async (code) => {
    await shutdownLangfuseTracing();
    process.exit(code);
  });
