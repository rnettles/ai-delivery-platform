import { Command } from "commander";
import { request } from "../client";
import { loadState, saveState } from "../state";
import { sendNotification } from "../notify";
import {
  formatPipeline,
  formatPipelineSummary,
  formatPipelineList,
  formatPipelineCurrent,
  formatStagedPhases,
  formatStagedSprints,
  formatStagedTasks,
} from "../formatters";
import type {
  PipelineRun,
  PipelineStatusSummary,
  CurrentPipelineStatusResult,
  ChannelPipelineStatusListResult,
  StagedPhasesResult,
  StagedSprintsResult,
  StagedTasksResult,
  CreatePipelineRequest,
} from "../types";
import type { ExecutionListResponse } from "../types";

function resolveChannelId(explicit?: string): string {
  return explicit ?? loadState().channel_id ?? "";
}

function resolvePipelineId(explicit?: string): string {
  return explicit ?? loadState().pipeline_id ?? "";
}

function requirePipelineId(explicit?: string): string {
  const id = resolvePipelineId(explicit);
  if (!id) {
    console.error("Missing required --pipeline-id (or set one via: adp active-set --pipeline-id <id>)");
    process.exit(1);
  }
  return id;
}

function requireChannelId(explicit?: string): string {
  const id = resolveChannelId(explicit);
  if (!id) {
    console.error("Missing required --slack-channel (or set one via: adp active-set --channel-id <id>)");
    process.exit(1);
  }
  return id;
}

export function registerPipelineCommands(program: Command): void {
  // ── pipeline-create ────────────────────────────────────────────────────────
  program
    .command("pipeline-create")
    .description("Create and start a new pipeline (auto-sets active pipeline_id on success)")
    .option("--entry-point <role>", "Entry point: planner|sprint-controller|implementer|verifier", "planner")
    .option("--execution-mode <mode>", "next|next-flow|full-sprint")
    .option("--description <text>", "Pipeline description", "local test feature")
    .option("--slack-channel <id>", "Slack channel ID")
    .option("--actor <name>", "Actor name", "operator")
    .option("--body-json <json>", "Raw JSON body (overrides other options)")
    .option("--json", "Output raw JSON")
    .option("--no-set-active", "Do not update active pipeline_id after create")
    .action(async (opts) => {
      let body: CreatePipelineRequest | string;

      if (opts.bodyJson) {
        body = opts.bodyJson;
      } else {
        const channelId = requireChannelId(opts.slackChannel);
        const metadata: Record<string, unknown> = { source: "api" };
        if (channelId) metadata.slack_channel = channelId;

        const req: CreatePipelineRequest = {
          entry_point: opts.entryPoint,
          input: { description: opts.description },
          metadata,
        };
        if (opts.executionMode) req.execution_mode = opts.executionMode;
        body = req;
      }

      const res = await request<PipelineRun>({
        method: "POST",
        path: "/pipeline",
        body,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipeline(res));
      }

      // Auto-persist the new pipeline as active unless opted out
      if (opts.setActive !== false) {
        saveState({ ...loadState(), pipeline_id: res.pipeline_id });
        if (!opts.json) console.log(`Active pipeline set to: ${res.pipeline_id}`);
      }

      // Only pass channel_id when the user explicitly specified --slack-channel
      await sendNotification({
        status: "INFO",
        command: "pipeline-create",
        method: "POST",
        path: "/pipeline",
        formatterSummary: formatPipeline(res),
        channelId: opts.slackChannel ?? undefined,
      });
    });

  // ── pipeline ───────────────────────────────────────────────────────────────
  program
    .command("pipeline")
    .description("Get a pipeline by ID")
    .option("--pipeline-id <id>", "Pipeline ID (falls back to active)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const pipelineId = requirePipelineId(opts.pipelineId);
      const res = await request<PipelineRun>({ path: `/pipeline/${pipelineId}` });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipeline(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipeline",
        method: "GET",
        path: `/pipeline/${pipelineId}`,
        formatterSummary: formatPipeline(res),
      });
    });

  // ── pipelines (alias for pipeline-list) ────────────────────────────────────
  program
    .command("pipelines")
    .description("List pipelines for a channel (alias for pipeline-list)")
    .option("--channel-id <id>", "Channel ID (falls back to active)")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const channelId = resolveChannelId(opts.channelId);
      if (!channelId) {
        console.error("Missing required --channel-id (or set via: adp active-set --channel-id <id>)");
        process.exit(1);
      }

      const res = await request<ChannelPipelineStatusListResult>({
        path: "/pipeline/status-summary/by-channel",
        query: { channel_id: channelId, limit: opts.limit },
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipelineList(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipelines",
        method: "GET",
        path: "/pipeline/status-summary/by-channel",
        formatterSummary: formatPipelineList(res),
      });
    });

  // ── pipeline-list ──────────────────────────────────────────────────────────
  program
    .command("pipeline-list")
    .description("List pipelines for a channel")
    .option("--channel-id <id>", "Channel ID (falls back to active)")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const channelId = resolveChannelId(opts.channelId);
      if (!channelId) {
        console.error("Missing required --channel-id (or set via: adp active-set --channel-id <id>)");
        process.exit(1);
      }

      const res = await request<ChannelPipelineStatusListResult>({
        path: "/pipeline/status-summary/by-channel",
        query: { channel_id: channelId, limit: opts.limit },
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipelineList(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipeline-list",
        method: "GET",
        path: "/pipeline/status-summary/by-channel",
        formatterSummary: formatPipelineList(res),
      });
    });

  // ── pipeline-current ───────────────────────────────────────────────────────
  program
    .command("pipeline-current")
    .description("Get the current active pipeline")
    .option("--channel-id <id>", "Channel ID (falls back to active)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const channelId = resolveChannelId(opts.channelId);
      const query: Record<string, string> = {};
      if (channelId) query.channel_id = channelId;

      const res = await request<CurrentPipelineStatusResult>({
        path: "/pipeline/status-summary/current",
        query,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipelineCurrent(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipeline-current",
        method: "GET",
        path: "/pipeline/status-summary/current",
        formatterSummary: formatPipelineCurrent(res),
      });
    });

  // ── pipeline-summary ───────────────────────────────────────────────────────
  program
    .command("pipeline-summary")
    .description("Get enriched status summary for a pipeline")
    .option("--pipeline-id <id>", "Pipeline ID (falls back to active)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const pipelineId = requirePipelineId(opts.pipelineId);
      const res = await request<PipelineStatusSummary>({
        path: `/pipeline/${pipelineId}/status-summary`,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipelineSummary(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipeline-summary",
        method: "GET",
        path: `/pipeline/${pipelineId}/status-summary`,
        formatterSummary: formatPipelineSummary(res),
      });
    });

  // ── staged-phases ──────────────────────────────────────────────────────────
  program
    .command("staged-phases")
    .description("List staged phase plans (triggers git refresh first)")
    .option("--channel-id <id>", "Channel ID (falls back to active)")
    .option("--project-id <id>", "Filter by project ID")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const channelId = resolveChannelId(opts.channelId);
      const query: Record<string, string | number> = { limit: opts.limit };
      if (channelId) query.channel_id = channelId;
      if (opts.projectId) query.project_id = opts.projectId;

      const res = await request<StagedPhasesResult>({
        path: "/pipeline/staged/phases",
        query,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatStagedPhases(res));
      }

      await sendNotification({
        status: "INFO",
        command: "staged-phases",
        method: "GET",
        path: "/pipeline/staged/phases",
        formatterSummary: formatStagedPhases(res),
      });
    });

  // ── staged-sprints ─────────────────────────────────────────────────────────
  program
    .command("staged-sprints")
    .description("List staged sprint plans (triggers git refresh first)")
    .option("--channel-id <id>", "Channel ID (falls back to active)")
    .option("--project-id <id>", "Filter by project ID")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const channelId = resolveChannelId(opts.channelId);
      const query: Record<string, string | number> = { limit: opts.limit };
      if (channelId) query.channel_id = channelId;
      if (opts.projectId) query.project_id = opts.projectId;

      const res = await request<StagedSprintsResult>({
        path: "/pipeline/staged/sprints",
        query,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatStagedSprints(res));
      }

      await sendNotification({
        status: "INFO",
        command: "staged-sprints",
        method: "GET",
        path: "/pipeline/staged/sprints",
        formatterSummary: formatStagedSprints(res),
      });
    });

  // ── staged-tasks ───────────────────────────────────────────────────────────
  program
    .command("staged-tasks")
    .description("List staged tasks from sprint plans (triggers git refresh first)")
    .option("--channel-id <id>", "Channel ID (falls back to active)")
    .option("--project-id <id>", "Filter by project ID")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const channelId = resolveChannelId(opts.channelId);
      const query: Record<string, string | number> = { limit: opts.limit };
      if (channelId) query.channel_id = channelId;
      if (opts.projectId) query.project_id = opts.projectId;

      const res = await request<StagedTasksResult>({
        path: "/pipeline/staged/tasks",
        query,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatStagedTasks(res));
      }

      await sendNotification({
        status: "INFO",
        command: "staged-tasks",
        method: "GET",
        path: "/pipeline/staged/tasks",
        formatterSummary: formatStagedTasks(res),
      });
    });

  // ── sprint ─────────────────────────────────────────────────────────────────
  program
    .command("sprint")
    .description("Show sprint plan and task list for a pipeline")
    .option("--pipeline-id <id>", "Pipeline ID (falls back to active, then current)")
    .option("--channel-id <id>", "Channel ID used when resolving current pipeline")
    .action(async (opts) => {
      // Resolve pipeline ID: explicit > active state > current for channel
      let pipelineId = resolvePipelineId(opts.pipelineId);

      if (!pipelineId) {
        const channelId = resolveChannelId(opts.channelId);
        const query: Record<string, string> = {};
        if (channelId) query.channel_id = channelId;

        const current = await request<CurrentPipelineStatusResult>({
          path: "/pipeline/status-summary/current",
          query,
        });

        if (current.kind === "none") {
          console.log("No active pipeline. Provide --pipeline-id to inspect a specific pipeline.");
          return;
        }
        if (current.kind === "multiple") {
          console.log("Multiple active pipelines — provide --pipeline-id to select one.");
          return;
        }
        pipelineId = current.run.pipeline_id;
      }

      // Fetch executions to find sprint-controller + implementer runs
      const executions = await request<ExecutionListResponse>({
        path: "/executions",
        query: { limit: 100 },
      });

      const sprintExec = executions.records.find(
        (r) =>
          ["role.sprint-controller", "sprint-controller"].includes(r.target.name) &&
          (r.metadata as Record<string, unknown>).pipeline_id === pipelineId &&
          r.status === "completed"
      );

      if (!sprintExec) {
        console.log(`No completed sprint-controller execution found for pipeline: ${pipelineId}`);
        return;
      }

      const out = sprintExec.output as Record<string, unknown>;
      const sprintId = String(out.sprint_id ?? "");
      const phaseId = String(out.phase_id ?? "");
      const sprintPlanPath = String(out.sprint_plan_path ?? "");

      // Find completed task IDs from implementer executions
      const completedTaskIds = new Set(
        executions.records
          .filter(
            (r) =>
              ["role.implementer", "implementer"].includes(r.target.name) &&
              (r.metadata as Record<string, unknown>).pipeline_id === pipelineId &&
              r.status === "completed"
          )
          .map((r) => String((r.output as Record<string, unknown>)?.task_id ?? ""))
          .filter(Boolean)
      );

      // Try to fetch the full sprint plan artifact for the complete task list
      let tasks: Array<{ task_id: string; description: string; status: string }> | null = null;
      if (sprintPlanPath) {
        try {
          const planText = await request<string>({
            path: `/pipeline/${pipelineId}/artifact`,
            query: { path: sprintPlanPath },
          });

          // Parse markdown table rows: | TASK-ID | description | status |
          tasks = String(planText)
            .split("\n")
            .filter((line) => /\|\s*[A-Z0-9]+-\d+/.test(line))
            .map((line) => {
              const cols = line
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean);
              return cols.length >= 3
                ? { task_id: cols[0], description: cols[1], status: cols[2] }
                : null;
            })
            .filter((t): t is NonNullable<typeof t> => t !== null);

          if (tasks.length === 0) tasks = null;
        } catch {
          // Artifact not accessible — fall back to first_task
          tasks = null;
        }
      }

      console.log("");
      console.log(`=== Sprint: ${sprintId}  (Phase: ${phaseId})  Pipeline: ${pipelineId} ===`);
      console.log("");

      if (tasks) {
        console.log("Tasks:");
        for (const t of tasks) {
          const status = completedTaskIds.has(t.task_id) ? "completed" : t.status;
          console.log(`  ${t.task_id.padEnd(16)}  ${t.description}  [${status}]`);
        }
      } else {
        console.log("Tasks (first task only — full plan artifact not accessible):");
        const ft = out.first_task as Record<string, unknown> | undefined;
        if (ft) {
          const ftId = String(ft.task_id ?? "");
          const ftStatus = completedTaskIds.has(ftId) ? "completed" : String(ft.status ?? "unknown");
          console.log(`  ${ftId.padEnd(16)}  ${String(ft.title ?? "")}  [${ftStatus}]`);
        }
      }

      console.log("");
    });

  // ── pipeline-approve ───────────────────────────────────────────────────────
  registerPipelineAction(program, "pipeline-approve", "Approve a waiting pipeline gate", "approve");
  registerPipelineAction(program, "pipeline-cancel", "Cancel a pipeline", "cancel");
  registerPipelineAction(program, "pipeline-takeover", "Pause a pipeline for manual takeover", "takeover");
  registerPipelineAction(program, "pipeline-retry", "Retry a failed pipeline step", "retry");

  // ── pipeline-handoff ───────────────────────────────────────────────────────
  program
    .command("pipeline-handoff")
    .description("Hand off a pipeline step with an artifact")
    .option("--pipeline-id <id>", "Pipeline ID (falls back to active)")
    .option("--actor <name>", "Actor name", "operator")
    .option("--artifact-path <path>", "Artifact path to hand off")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const pipelineId = requirePipelineId(opts.pipelineId);
      const body: Record<string, string> = { actor: opts.actor };
      if (opts.artifactPath) body.artifact_path = opts.artifactPath;

      const res = await request<PipelineRun>({
        method: "POST",
        path: `/pipeline/${pipelineId}/handoff`,
        body,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipeline(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipeline-handoff",
        method: "POST",
        path: `/pipeline/${pipelineId}/handoff`,
        formatterSummary: formatPipeline(res),
      });
    });

  // ── pipeline-skip ──────────────────────────────────────────────────────────
  program
    .command("pipeline-skip")
    .description("Skip the current pipeline step with a justification")
    .option("--pipeline-id <id>", "Pipeline ID (falls back to active)")
    .option("--actor <name>", "Actor name", "operator")
    .option("--justification <text>", "Reason for skipping", "skip via adp cli")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const pipelineId = requirePipelineId(opts.pipelineId);

      const res = await request<PipelineRun>({
        method: "POST",
        path: `/pipeline/${pipelineId}/skip`,
        body: { actor: opts.actor, justification: opts.justification },
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipeline(res));
      }

      await sendNotification({
        status: "INFO",
        command: "pipeline-skip",
        method: "POST",
        path: `/pipeline/${pipelineId}/skip`,
        formatterSummary: formatPipeline(res),
      });
    });
}

/** Registers a simple pipeline action command (approve/cancel/takeover/retry). */
function registerPipelineAction(
  program: Command,
  commandName: string,
  description: string,
  action: string
): void {
  program
    .command(commandName)
    .description(description)
    .option("--pipeline-id <id>", "Pipeline ID (falls back to active)")
    .option("--actor <name>", "Actor name", "operator")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const pipelineId = requirePipelineId(opts.pipelineId);

      const res = await request<PipelineRun>({
        method: "POST",
        path: `/pipeline/${pipelineId}/${action}`,
        body: { actor: opts.actor },
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatPipeline(res));
      }

      await sendNotification({
        status: "INFO",
        command: commandName,
        method: "POST",
        path: `/pipeline/${pipelineId}/${action}`,
        formatterSummary: formatPipeline(res),
      });
    });
}


