import { Command } from "commander";
import { request } from "../client";
import { sendNotification } from "../notify";
import { formatCoordination, formatCoordinationList, formatGitSync, formatGitStatus } from "../formatters";
import type { CoordinationEntry, CoordinationListResponse, GitSyncResponse, GitStatusResponse } from "../types";

export function registerOtherCommands(program: Command): void {
  // ── git-sync ───────────────────────────────────────────────────────────────
  program
    .command("git-sync")
    .description("Trigger a git sync across all repos")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<GitSyncResponse>({
        method: "POST",
        path: "/git/sync",
        body: {},
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatGitSync(res));
      }

      await sendNotification({
        status: "INFO",
        command: "git-sync",
        method: "POST",
        path: "/git/sync",
        formatterSummary: formatGitSync(res),
        forceCliChannel: true,
      });
    });

  // ── git-status ─────────────────────────────────────────────────────────────
  program
    .command("git-status")
    .description("Show git repo status for all tracked repos")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<GitStatusResponse>({ path: "/git/status" });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatGitStatus(res));
      }

      await sendNotification({
        status: "INFO",
        command: "git-status",
        method: "GET",
        path: "/git/status",
        formatterSummary: formatGitStatus(res),
        forceCliChannel: true,
      });
    });

  // ── coord-create ───────────────────────────────────────────────────────────
  program
    .command("coord-create")
    .description("Create a coordination entry")
    .requiredOption("--body-json <json>", "JSON body for the coordination entry")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<CoordinationEntry>({
        method: "POST",
        path: "/coordination",
        body: JSON.parse(opts.bodyJson),
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatCoordination(res));
      }

      await sendNotification({
        status: "INFO",
        command: "coord-create",
        method: "POST",
        path: "/coordination",
        formatterSummary: formatCoordination(res),
        forceCliChannel: true,
      });
    });

  // ── coord-get ──────────────────────────────────────────────────────────────
  program
    .command("coord-get <coordinationId>")
    .description("Get a coordination entry by ID")
    .option("--json", "Output raw JSON")
    .action(async (coordinationId: string, opts) => {
      const res = await request<CoordinationEntry>({
        path: `/coordination/${coordinationId}`,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatCoordination(res));
      }

      await sendNotification({
        status: "INFO",
        command: "coord-get",
        method: "GET",
        path: `/coordination/${coordinationId}`,
        formatterSummary: formatCoordination(res),
        forceCliChannel: true,
      });
    });

  // ── coord-patch ────────────────────────────────────────────────────────────
  program
    .command("coord-patch <coordinationId>")
    .description("Patch a coordination entry")
    .requiredOption("--body-json <json>", "JSON patch body")
    .option("--json", "Output raw JSON")
    .action(async (coordinationId: string, opts) => {
      const res = await request<CoordinationEntry>({
        method: "PATCH",
        path: `/coordination/${coordinationId}`,
        body: JSON.parse(opts.bodyJson),
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatCoordination(res));
      }

      await sendNotification({
        status: "INFO",
        command: "coord-patch",
        method: "PATCH",
        path: `/coordination/${coordinationId}`,
        formatterSummary: formatCoordination(res),
        forceCliChannel: true,
      });
    });

  // ── coord-query ────────────────────────────────────────────────────────────
  program
    .command("coord-query")
    .description("Query coordination entries")
    .option("--body-json <json>", "JSON query body", "{}")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<CoordinationListResponse>({
        method: "POST",
        path: "/coordination/query",
        body: JSON.parse(opts.bodyJson),
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatCoordinationList(res));
      }

      await sendNotification({
        status: "INFO",
        command: "coord-query",
        method: "POST",
        path: "/coordination/query",
        formatterSummary: `${res.entries?.length ?? 0} coordination entry/entries found.`,
        forceCliChannel: true,
      });
    });

  // ── coord-archive ──────────────────────────────────────────────────────────
  program
    .command("coord-archive <coordinationId>")
    .description("Archive (delete) a coordination entry")
    .option("--json", "Output raw JSON")
    .action(async (coordinationId: string, opts) => {
      const res = await request<unknown>({
        method: "DELETE",
        path: `/coordination/${coordinationId}`,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Coordination entry ${coordinationId} archived.`);
      }

      await sendNotification({
        status: "INFO",
        command: "coord-archive",
        method: "DELETE",
        path: `/coordination/${coordinationId}`,
        formatterSummary: `Coordination entry ${coordinationId} archived.`,
        forceCliChannel: true,
      });
    });

  // ── request ────────────────────────────────────────────────────────────────
  program
    .command("request")
    .description("Send an arbitrary HTTP request to the API")
    .requiredOption("--method <method>", "HTTP method: GET|POST|PATCH|DELETE")
    .requiredOption("--path <path>", "API path (e.g. /health)")
    .option("--body-json <json>", "Optional JSON body")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const method = opts.method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
      const body = opts.bodyJson ? JSON.parse(opts.bodyJson) : undefined;

      const res = await request<unknown>({ method, path: opts.path, body });

      if (opts.json || true) {
        // request command always outputs JSON — it's the raw escape hatch
        console.log(JSON.stringify(res, null, 2));
      }

      await sendNotification({
        status: "INFO",
        command: "request",
        method,
        path: opts.path,
        formatterSummary: `${method} ${opts.path} → ok`,
      });
    });
}


