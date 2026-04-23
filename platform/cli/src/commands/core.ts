import { Command } from "commander";
import { request } from "../client";
import { loadState, saveState, clearState, type ActiveState } from "../state";
import { sendNotification } from "../notify";
import type { HealthResponse } from "../types";
import { formatHealth } from "../formatters";

export function registerCoreCommands(program: Command): void {
  // ── active-set ─────────────────────────────────────────────────────────────
  program
    .command("active-set")
    .description("Set active channel_id and/or pipeline_id defaults")
    .option("--channel-id <id>", "Slack channel ID")
    .option("--pipeline-id <id>", "Pipeline ID")
    .action(async (opts) => {
      if (!opts.channelId && !opts.pipelineId) {
        console.error("active-set requires --channel-id and/or --pipeline-id");
        process.exit(1);
      }
      const current = loadState();
      const next: ActiveState = {
        channel_id: opts.channelId ?? current.channel_id,
        pipeline_id: opts.pipelineId ?? current.pipeline_id,
      };
      saveState(next);
      const parts = Object.entries(next)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`);
      console.log(`Active context: ${parts.join(", ")}`);
      await sendNotification({
        status: "INFO",
        command: "active-set",
        method: "LOCAL",
        path: "/cli/active-set",
        formatterSummary: `Active context updated: ${parts.join(", ")}`,
        forceCliChannel: true,
      });
    });

  // ── active-show ────────────────────────────────────────────────────────────
  program
    .command("active-show")
    .description("Show current active defaults")
    .action(() => {
      const state = loadState();
      if (state.channel_id || state.pipeline_id) {
        if (state.channel_id) console.log(`channel_id:  ${state.channel_id}`);
        if (state.pipeline_id) console.log(`pipeline_id: ${state.pipeline_id}`);
      } else {
        console.log("No active defaults set.");
      }
    });

  // ── active-clear ───────────────────────────────────────────────────────────
  program
    .command("active-clear")
    .description("Clear active defaults")
    .action(() => {
      clearState();
      console.log("Active defaults cleared.");
    });

  // ── health ─────────────────────────────────────────────────────────────────
  program
    .command("health")
    .description("Check API health")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<HealthResponse>({ path: "/health" });
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatHealth(res));
      }
      await sendNotification({
        status: "INFO",
        command: "health",
        method: "GET",
        path: "/health",
        formatterSummary: formatHealth(res),
      });
    });
}


