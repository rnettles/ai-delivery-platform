import { Command } from "commander";
import { request } from "../client";
import { sendNotification } from "../notify";
import {
  formatExecution,
  formatExecutionRecord,
  formatExecutionList,
  formatScripts,
} from "../formatters";
import type {
  ExecutionResponseEnvelope,
  ExecutionRecord,
  ExecutionListResponse,
  ScriptsDiscoveryResponse,
} from "../types";

export function registerExecutionCommands(program: Command): void {
  // ── scripts ────────────────────────────────────────────────────────────────
  program
    .command("scripts")
    .description("List available scripts and roles")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<ScriptsDiscoveryResponse>({ path: "/scripts" });
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatScripts(res));
      }
      await sendNotification({
        status: "INFO",
        command: "scripts",
        method: "GET",
        path: "/scripts",
        formatterSummary: `${res.scripts.length} script(s), ${res.roles.length} role(s) discovered.`,
      });
    });

  // ── execute ────────────────────────────────────────────────────────────────
  program
    .command("execute")
    .description("Execute a script or role")
    .option("--target-type <type>", "Target type: script|role", "script")
    .option("--script-name <name>", "Script name", "test.echo")
    .option("--script-version <version>", "Script version", "2026.04.18")
    .option("--message <msg>", "Input message", "hello-local")
    .option("--body-json <json>", "Raw JSON body (overrides other options)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const body = opts.bodyJson
        ? JSON.parse(opts.bodyJson)
        : {
            target: {
              type: opts.targetType,
              name: opts.scriptName,
              version: opts.scriptVersion,
            },
            input: { message: opts.message },
          };

      const res = await request<ExecutionResponseEnvelope>({
        method: "POST",
        path: "/execute",
        body,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatExecution(res));
      }

      await sendNotification({
        status: res.ok ? "INFO" : "ERROR",
        command: "execute",
        method: "POST",
        path: "/execute",
        formatterSummary: formatExecution(res),
      });
    });

  // ── executions ─────────────────────────────────────────────────────────────
  program
    .command("executions")
    .description("List recent executions")
    .option("--correlation-id <id>", "Filter by correlation ID")
    .option("--target-name <name>", "Filter by target name")
    .option("--status <status>", "Filter by status: completed|failed")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<ExecutionListResponse>({
        path: "/executions",
        query: {
          correlation_id: opts.correlationId,
          target_name: opts.targetName,
          status: opts.status,
          limit: opts.limit,
        },
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatExecutionList(res));
      }

      await sendNotification({
        status: "INFO",
        command: "executions",
        method: "GET",
        path: "/executions",
        formatterSummary: `${res.records?.length ?? 0} execution(s) returned.`,
      });
    });

  // ── execution ──────────────────────────────────────────────────────────────
  program
    .command("execution <executionId>")
    .description("Get a single execution by ID")
    .option("--json", "Output raw JSON")
    .action(async (executionId: string, opts) => {
      const res = await request<ExecutionRecord>({
        path: `/executions/${executionId}`,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatExecutionRecord(res));
      }

      await sendNotification({
        status: "INFO",
        command: "execution",
        method: "GET",
        path: `/executions/${executionId}`,
        formatterSummary: formatExecutionRecord(res),
      });
    });

  // ── replay ─────────────────────────────────────────────────────────────────
  program
    .command("replay <executionId>")
    .description("Replay a failed execution")
    .option("--json", "Output raw JSON")
    .action(async (executionId: string, opts) => {
      const res = await request<ExecutionResponseEnvelope>({
        method: "POST",
        path: `/executions/${executionId}/replay`,
        body: {},
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatExecution(res));
      }

      await sendNotification({
        status: res.ok ? "INFO" : "ERROR",
        command: "replay",
        method: "POST",
        path: `/executions/${executionId}/replay`,
        formatterSummary: formatExecution(res),
      });
    });
}


