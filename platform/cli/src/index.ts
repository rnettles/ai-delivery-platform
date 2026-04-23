#!/usr/bin/env node
import { Command } from "commander";
import { configureClient } from "./client";
import { loadEnvFile } from "./env";
import { registerCoreCommands } from "./commands/core";
import { registerExecutionCommands } from "./commands/execution";
import { registerPipelineCommands } from "./commands/pipeline";
import { registerProjectCommands } from "./commands/project";
import { registerOtherCommands } from "./commands/other";

// ── Bootstrap config from environment ────────────────────────────────────────
configureClient({
  baseUrl: process.env.ADP_API_BASE_URL ?? "http://localhost:3000",
  apiKey: process.env.ADP_API_KEY ?? "",
});

// ── Program definition ────────────────────────────────────────────────────────
const program = new Command();

program
  .name("adp")
  .description("AI Delivery Platform CLI")
  .version("0.1.0")
  .option("--base-url <url>", "API base URL (overrides ADP_API_BASE_URL)")
  .option("--api-key <key>", "API key (overrides ADP_API_KEY)")
  .option("--env-file <path>", "Load environment variables from a .env file before executing")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts<{
      envFile?: string;
      baseUrl?: string;
      apiKey?: string;
    }>();

    // Load env file first so that --base-url and --api-key can override it
    if (opts.envFile) {
      loadEnvFile(opts.envFile);
    }

    configureClient({
      baseUrl: opts.baseUrl ?? process.env.ADP_API_BASE_URL ?? "http://localhost:3000",
      apiKey: opts.apiKey ?? process.env.ADP_API_KEY ?? "",
    });
  });

// ── env-load as standalone command ────────────────────────────────────────────
program
  .command("env-load")
  .description("Load and print env variables from a .env file")
  .option("--env-file <path>", "Path to .env file", "platform/backend-api/.env.local")
  .action((opts) => {
    loadEnvFile(opts.envFile);
  });

// ── Register all command groups ───────────────────────────────────────────────
registerCoreCommands(program);
registerExecutionCommands(program);
registerPipelineCommands(program);
registerProjectCommands(program);
registerOtherCommands(program);

// ── Global error handler ──────────────────────────────────────────────────────
program.configureOutput({
  outputError(str, write) {
    write(`\x1b[31mError:\x1b[0m ${str}`);
  },
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
  process.exit(1);
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
  process.exit(1);
});
