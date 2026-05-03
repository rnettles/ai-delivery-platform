import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { pipelineRuns, state } from "../db/schema";
import { AdminOpsAction, AdminOpsGitSummary, AdminOpsJob, AdminOpsStatus } from "../domain/admin-ops.types";
import {
  CreatePipelineRequest,
  GateOutcome,
  PipelineHandoffRequest,
  PipelineNotification,
  PipelineRole,
  PipelineRun,
  PipelineSkipRequest,
  PipelineSlackMetadata,
  PipelineStepRecord,
  PipelineStatus,
} from "../domain/pipeline.types";
import { HttpError } from "../utils/http-error";
import { logger } from "./logger.service";
import { artifactService } from "./artifact.service";
import { projectGitService } from "./project-git.service";
import { Project, projectService } from "./project.service";
import { pipelineNotifierService } from "./pipeline-notifier.service";
import { executionRecordModel } from "../domain/execution.model";

const TERMINAL_SUCCESS_STATUSES: PipelineStatus[] = ["complete", "awaiting_pr_review"];

export interface PipelineStatusSummary extends PipelineRun {
  repo_url?: string;
  control_state?: {
    refreshed_at: string;
    source: "artifacts";
    git_head_commit?: string;
    current_task?: Record<string, unknown>;
    verification?: Record<string, unknown>;
    closeout?: Record<string, unknown>;
  };
  last_error?: { code: string; message: string; details?: unknown };
  prior_step_detail?: PipelineStepRecord;
  current_step_detail?: PipelineStepRecord;
  execution_signals?: PipelineExecutionSignal[];
  latest_operation?: PipelineLatestOperationSummary;
}

export interface PipelineLatestOperationSummary {
  operation_id: string;
  action: AdminOpsAction;
  status: AdminOpsStatus;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  escalation_reason?: string;
  escalation_summary?: string;
  human_action_checklist?: string[];
  attempted_steps?: Array<{
    name: string;
    status: string;
    started_at: string;
    completed_at?: string;
  }>;
  before_git?: AdminOpsGitSummary;
  after_git?: AdminOpsGitSummary;
}

export interface PipelineExecutionSignal {
  level: "waiting" | "warning" | "error";
  code: string;
  message: string;
  since?: string;
  minutes?: number;
}

export interface PipelineStatusChoice {
  pipeline_id: string;
  status: PipelineStatus;
  current_step: PipelineRole | "complete";
  current_actor?: string;
  project_id?: string;
  repo_url?: string;
  sprint_branch?: string;
  updated_at: string;
  wait_state?: string;
}

export interface AwaitingPrReviewRun {
  pipeline_id: string;
  project_id?: string;
  pr_number?: number;
  sprint_branch?: string;
}

export interface PipelineOperationLink {
  operation_id: string;
  action: string;
  status: string;
  created_at: string;
  details?: Record<string, unknown>;
}

export type CurrentPipelineStatusResult =
  | { kind: "none"; message: string }
  | { kind: "single"; run: PipelineStatusSummary }
  | { kind: "multiple"; runs: PipelineStatusChoice[] };

export interface ChannelPipelineStatusListResult {
  channel_id: string;
  runs: PipelineStatusChoice[];
}

export interface ProjectBranchSummary {
  sprint_branch: string;
  latest_pipeline_id: string;
  status: PipelineStatus;
  current_step: PipelineRole | "complete";
  updated_at: string;
}

export interface StagedPhaseRecord {
  phase_id: string;
  name?: string;
  status: string;
  artifact_path: string;
  sourced_from: PipelineRole;
  completed_at?: string;
}

export interface StagedSprintRecord {
  sprint_id: string;
  phase_id?: string;
  name?: string;
  status: string;
  sprint_plan_path: string;
  sourced_from: PipelineRole;
  completed_at?: string;
}

export interface StagedTaskRecord {
  sprint_id: string;
  phase_id?: string;
  task_id: string;
  label: string;
  status: "done" | "pending";
  sprint_plan_path: string;
  sourced_from: PipelineRole;
  completed_at?: string;
}

export interface StagedPhasesResult {
  pipeline_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  phases: StagedPhaseRecord[];
}

export interface StagedSprintsResult {
  pipeline_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  sprints: StagedSprintRecord[];
}

export interface StagedTasksResult {
  pipeline_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  tasks: StagedTaskRecord[];
}

export interface RepoStagedPhasesResult {
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  project_id: string;
  channel_id?: string;
  phases: StagedPhaseRecord[];
}

export interface RepoStagedSprintsResult {
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  project_id: string;
  channel_id?: string;
  sprints: StagedSprintRecord[];
}

export interface RepoStagedTasksResult {
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  project_id: string;
  channel_id?: string;
  tasks: StagedTaskRecord[];
}

// Ordered pipeline role sequence
const ROLE_SEQUENCE: PipelineRole[] = [
  "planner",
  "sprint-controller",
  "implementer",
  "verifier",
];

// Roles that require a human gate before advancing.
// Gates are bypassed in full-sprint mode (fully autonomous).
// In next / next-flow modes the operator reviews the artifact before the pipeline advances.
const GATED_ROLES = new Set<PipelineRole>(["planner"]);

// Maximum number of Implementer attempts (initial + retries) before escalation (ADR-030)
const MAX_IMPLEMENTER_ATTEMPTS = 3;

// Roles that have a "next" in the default happy path
const NEXT_ROLE: Partial<Record<PipelineRole, PipelineRole>> = {
  planner: "sprint-controller",
  "sprint-controller": "implementer",
  implementer: "verifier",
  verifier: "sprint-controller", // task close-out pass
};

function nextRoleAfter(role: PipelineRole): PipelineRole | "complete" {
  return NEXT_ROLE[role] ?? "complete";
}

function rowToRun(row: typeof pipelineRuns.$inferSelect): PipelineRun {
  return {
    pipeline_id: row.pipeline_id,
    entry_point: row.entry_point as PipelineRole,
    current_step: row.current_step as PipelineRole | "complete",
    status: row.status as PipelineStatus,
    steps: (row.steps as PipelineStepRecord[]) ?? [],
    metadata: (row.metadata as PipelineRun["metadata"]) ?? { source: "api" },
    input: (row.input as Record<string, unknown>) ?? undefined,
    project_id: row.project_id ?? undefined,
    sprint_branch: row.sprint_branch ?? undefined,
    pr_number: row.pr_number ?? undefined,
    pr_url: row.pr_url ?? undefined,
    implementer_attempts: row.implementer_attempts ?? 0,
    lock_version: row.lock_version ?? 0,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function minutesSince(iso: string | undefined, nowMs: number): number | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return undefined;
  return Math.floor((nowMs - ts) / 60000);
}

function summarizeWaitState(run: PipelineRun): string | undefined {
  if (run.status === "awaiting_approval") return "Waiting for approval";
  if (run.status === "awaiting_pr_review") return "Waiting for PR review";
  if (run.status === "paused_takeover") return "Waiting for human handoff";

  if (run.status === "running") {
    const idleMinutes = minutesSince(run.updated_at, Date.now());
    if (idleMinutes !== undefined && idleMinutes >= 10) {
      return `No state update for ${idleMinutes}m`;
    }
  }

  return undefined;
}

function buildExecutionSignals(run: PipelineRun, summary: PipelineStatusSummary): PipelineExecutionSignal[] {
  const signals: PipelineExecutionSignal[] = [];
  const nowMs = Date.now();

  if (summary.last_error) {
    signals.push({
      level: "error",
      code: summary.last_error.code,
      message: summary.last_error.message,
    });
  }

  if (summary.latest_operation?.status === "blocked") {
    signals.push({
      level: "error",
      code: "LATEST_OPERATION_BLOCKED",
      message: summary.latest_operation.escalation_summary ?? "Latest admin recovery operation is blocked and needs human action.",
      since: summary.latest_operation.updated_at,
    });
  }

  if (summary.latest_operation?.status === "failed") {
    signals.push({
      level: "error",
      code: "LATEST_OPERATION_FAILED",
      message: "Latest admin recovery operation failed before reaching a stable result.",
      since: summary.latest_operation.updated_at,
    });
  }

  if (run.status === "awaiting_approval") {
    signals.push({
      level: "waiting",
      code: "WAITING_APPROVAL",
      message: "Pipeline is waiting for approval before it can continue.",
    });
  }

  if (run.status === "awaiting_pr_review") {
    signals.push({
      level: "waiting",
      code: "WAITING_PR_REVIEW",
      message: "Pipeline is waiting for PR review completion.",
    });
  }

  if (run.status === "paused_takeover") {
    signals.push({
      level: "waiting",
      code: "WAITING_HANDOFF",
      message: "Pipeline is paused in takeover and waiting for handoff.",
    });
  }

  const current = summary.current_step_detail;
  if (run.status === "running" && current?.status === "running") {
    const stepAgeMinutes = minutesSince(current.started_at, nowMs);
    const idleMinutes = minutesSince(run.updated_at, nowMs);

    if (stepAgeMinutes !== undefined && stepAgeMinutes >= 10) {
      signals.push({
        level: "warning",
        code: "STEP_RUNNING_LONG",
        message: `Current step has been running for ${stepAgeMinutes}m.`,
        since: current.started_at,
        minutes: stepAgeMinutes,
      });
    }

    if (idleMinutes !== undefined && idleMinutes >= 10) {
      signals.push({
        level: "warning",
        code: "NO_STATE_PROGRESS",
        message: `No pipeline state change detected for ${idleMinutes}m while step is running.`,
        since: run.updated_at,
        minutes: idleMinutes,
      });
    }
  }

  return signals;
}

function summarizeOperationJob(job: AdminOpsJob): PipelineLatestOperationSummary {
  return {
    operation_id: job.job_id,
    action: job.action,
    status: job.status,
    updated_at: job.updated_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    escalation_reason: job.outcome?.escalation_reason,
    escalation_summary: job.outcome?.escalation_summary,
    human_action_checklist: job.outcome?.human_action_checklist,
    attempted_steps: job.telemetry?.attempted_steps?.map((step) => ({
      name: step.name,
      status: step.status,
      started_at: step.started_at,
      completed_at: step.completed_at,
    })),
    before_git: job.outcome?.before_git,
    after_git: job.outcome?.after_git,
  };
}

export class PipelineService {
  private normalizeLimit(limit = 20): number {
    return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;
  }

  private markdownField(markdown: string, fieldName: string): string | undefined {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match both **Key:** Value (bold) and bare Key: Value forms
    const match = new RegExp(
      `^(?:\\*\\*${escaped}:\\*\\*|${escaped}:)\\s*(.+?)\\s*$`,
      "im"
    ).exec(markdown);
    return match?.[1]?.trim() || undefined;
  }

  private parsePhasePlan(markdown: string, artifactPath: string): { phase_id: string; name?: string; status: string } {
    const titleMatch = /^#\s*Phase\s*Plan:\s*(.+?)\s*$/im.exec(markdown);
    const pathMatch = /phase_plan_([^/.]+)\.md$/i.exec(artifactPath);
    // Prefer explicit "Phase ID:" field, then filename match, then the (possibly long) title
    const fieldId = this.markdownField(markdown, "Phase ID");

    return {
      phase_id: fieldId || pathMatch?.[1] || titleMatch?.[1]?.trim() || "",
      name: this.markdownField(markdown, "Name") ?? titleMatch?.[1]?.trim(),
      status: this.markdownField(markdown, "Status") || "staged",
    };
  }

  private parseSprintPlan(markdown: string, artifactPath: string): { sprint_id: string; phase_id?: string; name?: string; status: string } {
    const titleMatch = /^#\s*Sprint\s*Plan:\s*(.+?)\s*$/im.exec(markdown);
    const pathMatch = /sprint_plan_([^/.]+)\.md$/i.exec(artifactPath);

    return {
      sprint_id: titleMatch?.[1]?.trim() || pathMatch?.[1] || "",
      phase_id: this.markdownField(markdown, "Phase"),
      name: this.markdownField(markdown, "Name"),
      status: this.markdownField(markdown, "Status") || "staged",
    };
  }

  private parseSprintTasks(markdown: string): Array<{ task_id: string; label: string; status: "done" | "pending" }> {
    const lines = markdown.split(/\r?\n/);
    const tasks: Array<{ task_id: string; label: string; status: "done" | "pending" }> = [];
    let inTasks = false;

    for (const line of lines) {
      // Recognise both "## Tasks" and "## Task Checklist"
      if (!inTasks && /^##\s+Tasks(?:\s+Checklist)?\b/i.test(line)) {
        inTasks = true;
        continue;
      }

      if (inTasks && /^##\s+/i.test(line)) {
        break;
      }

      if (!inTasks) {
        continue;
      }

      // Match checklist items: - [x] TASK: label  or  - [ ] TASK: label  or  - TASK
      const checklistMatch = /^\s*-\s+\[(x| )\]\s+(.+?)\s*$/i.exec(line);
      if (checklistMatch) {
        const checked = checklistMatch[1].toLowerCase() === "x";
        const rest = checklistMatch[2].trim();
        const taskIdMatch = /[A-Za-z]\S*-\d+\w*/i.exec(rest);
        tasks.push({
          task_id: taskIdMatch?.[0] ?? rest,
          label: rest,
          status: checked ? "done" : "pending",
        });
        continue;
      }

      // Plain list item (no checkbox)
      const match = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (!match) {
        continue;
      }

      const label = match[1].trim();
      const taskIdMatch = /[A-Z]{2,}-\d+/.exec(label);
      tasks.push({
        task_id: taskIdMatch?.[0] || label,
        label,
        status: "pending",
      });
    }

    return tasks;
  }

  private collectArtifactEntries(
    run: PipelineRun,
    matcher: (path: string) => boolean
  ): Array<{ artifact_path: string; sourced_from: PipelineRole; completed_at?: string }> {
    const entries: Array<{ artifact_path: string; sourced_from: PipelineRole; completed_at?: string }> = [];
    const seen = new Set<string>();

    for (const step of [...run.steps].reverse()) {
      for (const artifactPath of step.artifact_paths ?? []) {
        if (!matcher(artifactPath) || seen.has(artifactPath)) {
          continue;
        }

        seen.add(artifactPath);
        entries.push({
          artifact_path: artifactPath,
          sourced_from: step.role,
          completed_at: step.completed_at,
        });
      }
    }

    return entries;
  }

  private async getArtifactDrivenRun(pipelineId: string): Promise<{ run: PipelineRun; git_head_commit?: string; refreshed_at: string }> {
    let run = await this.get(pipelineId);
    const gitRefresh = await this.refreshGitForStatus(run);

    if (gitRefresh.headCommit) {
      try {
        run = await this.save(run, {
          metadata: {
            ...run.metadata,
            last_status_git_head: gitRefresh.headCommit,
            last_status_git_refresh_at: new Date().toISOString(),
          },
        });
      } catch (err) {
        if (err instanceof HttpError && err.code === "CONCURRENT_WRITE") {
          logger.warn("getArtifactDrivenRun: metadata save skipped due to concurrent write", { pipeline_id: pipelineId });
        } else {
          throw err;
        }
      }
    }

    run = await this.reconcileRunFromControlArtifacts(run);

    return {
      run,
      git_head_commit: gitRefresh.headCommit,
      refreshed_at: new Date().toISOString(),
    };
  }

  private async listRepoMarkdownFiles(repoRoot: string, relativeDir: string, matcher: RegExp): Promise<string[]> {
    const dir = path.join(repoRoot, relativeDir);
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files = entries
      .filter((e) => e.isFile() && matcher.test(String(e.name)))
      .map((e) => path.join(dir, String(e.name)));

    const withTimes = await Promise.all(
      files.map(async (file) => ({
        file,
        mtimeMs: (await fs.stat(file)).mtimeMs,
      }))
    );

    withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return withTimes.map((x) => x.file);
  }

  private toRelPath(absPath: string): string {
    return path.relative(process.cwd(), absPath).replace(/\\/g, "/");
  }

  private async resolveArtifactProject(channelId?: string, projectId?: string): Promise<{
    project: Project;
    git_head_commit?: string;
    refreshed_at: string;
  }> {
    const normalizedChannel = channelId?.trim();
    const normalizedProject = projectId?.trim();

    let project: Project | null = null;

    if (normalizedProject) {
      project = await projectService.getById(normalizedProject);
    } else if (normalizedChannel) {
      project = await projectService.getByChannel(normalizedChannel);
    }

    if (!project) {
      project = await projectService.getByName("default");
    }

    if (!project) {
      throw new HttpError(404, "PROJECT_NOT_FOUND", "No project resolved for staged artifact lookup.");
    }

    const git = await projectGitService.ensureReady(project, { forcePull: true, caller: "staged-artifact-lookup" });
    return {
      project,
      git_head_commit: git.head_commit,
      refreshed_at: new Date().toISOString(),
    };
  }

  private async refreshGitForStatus(run: PipelineRun): Promise<{ project: Project | null; headCommit?: string }> {
    if (!run.project_id) {
      return { project: null };
    }

    try {
      const project = await projectService.getById(run.project_id);
      if (!project) {
        return { project: null };
      }

      // Skip git pull for terminal pipelines — artifacts are frozen and a pull adds
      // significant latency when listing many pipelines (one pull per row).
      // "failed" is included: retries create a new pipeline row, so the old failed run is frozen.
      const terminalStatuses: PipelineStatus[] = ["complete", "cancelled", "awaiting_pr_review", "failed"];
      if (terminalStatuses.includes(run.status)) {
        const cachedHead = typeof run.metadata?.last_status_git_head === "string"
          ? run.metadata.last_status_git_head
          : undefined;
        logger.info("Status git refresh skipped (terminal)", {
          pipeline_id: run.pipeline_id,
          status: run.status,
          cached_head: cachedHead,
        });
        return { project, headCommit: cachedHead };
      }

      const git = await projectGitService.ensureReady(project, { forcePull: true, caller: "status-refresh" });
      return { project, headCommit: git.head_commit };
    } catch (err) {
      logger.info("Status git refresh skipped", {
        pipeline_id: run.pipeline_id,
        project_id: run.project_id,
        error: String(err),
      });
      return { project: null };
    }
  }

  private latestArtifactPath(run: PipelineRun, matcher: (path: string) => boolean): string | undefined {
    const all = run.steps
      .slice()
      .reverse()
      .flatMap((s) => s.artifact_paths ?? []);
    return all.find((p) => matcher(p));
  }

  private async readArtifactJson(run: PipelineRun, matcher: (path: string) => boolean): Promise<Record<string, unknown> | undefined> {
    const artifactPath = this.latestArtifactPath(run, matcher);
    if (!artifactPath) {
      return undefined;
    }

    try {
      const content = await artifactService.read(artifactPath);
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private async reconcileRunFromControlArtifacts(run: PipelineRun): Promise<PipelineRun> {
    const closeout = await this.readArtifactJson(run, (p) => p.endsWith("sprint_closeout.json"));
    if (!closeout) {
      return run;
    }

    const nextPatch: {
      status?: PipelineStatus;
      current_step?: PipelineRole | "complete";
      pr_number?: number;
      pr_url?: string;
      sprint_branch?: string;
    } = {};

    if (
      run.status !== "awaiting_pr_review" &&
      run.status !== "complete" &&
      run.status !== "cancelled" &&
      run.status !== "failed"
    ) {
      nextPatch.status = "awaiting_pr_review";
      nextPatch.current_step = "complete";
    }

    const prNumber = closeout.pr_number;
    const prUrl = closeout.pr_url;
    const sprintBranch = closeout.sprint_branch;

    if (typeof prNumber === "number" && run.pr_number !== prNumber) {
      nextPatch.pr_number = prNumber;
    }
    if (typeof prUrl === "string" && run.pr_url !== prUrl) {
      nextPatch.pr_url = prUrl;
    }
    if (typeof sprintBranch === "string" && run.sprint_branch !== sprintBranch) {
      nextPatch.sprint_branch = sprintBranch;
    }

    if (Object.keys(nextPatch).length === 0) {
      return run;
    }

    logger.info("Status reconciled from control artifacts", {
      pipeline_id: run.pipeline_id,
      patch: nextPatch,
    });

    return this.save(run, nextPatch);
  }

  // ─── CREATE ───────────────────────────────────────────────────────────────

  async create(req: CreatePipelineRequest): Promise<PipelineRun> {
    const pipelineId = `pipe-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const metadata: PipelineSlackMetadata & Record<string, unknown> = {
      source: req.metadata?.source ?? "api",
      ...req.metadata,
    };

    // Persist execution mode and caller-context stack so completeStep can make deterministic
    // downstream chaining decisions (ADR-022).
    if (req.execution_mode) {
      metadata.execution_mode = req.execution_mode;
    }
    // Caller-context stack: tracks the originating entry_point for nested flow return semantics.
    metadata.caller_context_stack = [req.entry_point];

    const requestedSlackChannel =
      typeof metadata.slack_channel === "string" ? metadata.slack_channel.trim() : "";
    if (!requestedSlackChannel) {
      throw new HttpError(
        400,
        "SLACK_CHANNEL_REQUIRED",
        "metadata.slack_channel is required for pipeline creation"
      );
    }

    const mappedProject = await projectService.getByChannel(requestedSlackChannel);
    if (!mappedProject) {
      throw new HttpError(
        400,
        "INVALID_SLACK_CHANNEL",
        "metadata.slack_channel is not mapped to any project",
        { slack_channel: requestedSlackChannel }
      );
    }

    const projectId = mappedProject.project_id;

    // ── Prior-pipeline inheritance (ADR-037 UC2: failure recovery) ────────────
    // If the caller supplies prior_pipeline_id in input, inherit sprint_branch
    // from the prior pipeline so the continuation runs on the same branch.
    const priorPipelineId =
      req.input && typeof req.input["prior_pipeline_id"] === "string"
        ? req.input["prior_pipeline_id"]
        : undefined;

    if (priorPipelineId) {
      const priorRun = await this.get(priorPipelineId);
      if (!req.sprint_branch && priorRun.sprint_branch) {
        req.sprint_branch = priorRun.sprint_branch;
      }
    }

    // ── Active-branch guard (ADR-037) ─────────────────────────────────────────
    // A branch with an active pipeline cannot start a second pipeline.
    // A failed branch is explicitly allowed through (continuation use-case).
    if (req.sprint_branch) {
      const activeBranchStatuses: PipelineStatus[] = [
        "running",
        "awaiting_approval",
        "awaiting_pr_review",
        "paused_takeover",
      ];
      const [existingRow] = await db
        .select({ pipeline_id: pipelineRuns.pipeline_id })
        .from(pipelineRuns)
        .where(
          and(
            eq(pipelineRuns.project_id, projectId),
            eq(pipelineRuns.sprint_branch, req.sprint_branch),
            inArray(pipelineRuns.status, activeBranchStatuses)
          )
        )
        .limit(1);

      if (existingRow) {
        throw new HttpError(
          409,
          "BRANCH_ALREADY_ACTIVE",
          `Pipeline ${existingRow.pipeline_id} is already active on branch ${req.sprint_branch}. Cancel it before starting a new pipeline on the same branch.`
        );
      }
    }

    // Build step history: mark all roles before entry_point as not_applicable
    const entryIdx = ROLE_SEQUENCE.indexOf(req.entry_point);
    const steps: PipelineStepRecord[] = ROLE_SEQUENCE.slice(0, entryIdx).map((role) => ({
      role,
      status: "not_applicable",
      gate_outcome: null,
      artifact_paths: [],
      actor: "system",
      started_at: now,
      completed_at: now,
    }));

    // Add running step for entry point
    steps.push({
      role: req.entry_point,
      status: "running",
      gate_outcome: null,
      artifact_paths: [],
      actor: "system",
      started_at: now,
    });

    const [row] = await db
      .insert(pipelineRuns)
      .values({
        pipeline_id: pipelineId,
        entry_point: req.entry_point,
        current_step: req.entry_point,
        status: "running",
        steps: steps as object[],
        metadata: metadata as Record<string, unknown>,
        input: (req.input ?? {}) as Record<string, unknown>,
        implementer_attempts: 0,
        project_id: projectId,
        sprint_branch: req.sprint_branch ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    logger.info("Pipeline run created", { pipeline_id: pipelineId, entry_point: req.entry_point });

    return rowToRun(row);
  }

  // ─── LIST BRANCHES BY PROJECT ─────────────────────────────────────────────

  async listBranchesByProject(projectId: string): Promise<ProjectBranchSummary[]> {
    // Fetch the most-recent pipeline per distinct sprint_branch for this project.
    // We use a subquery to get the latest pipeline_id per branch, then join back.
    const rows = await db
      .select({
        sprint_branch: pipelineRuns.sprint_branch,
        pipeline_id: pipelineRuns.pipeline_id,
        status: pipelineRuns.status,
        current_step: pipelineRuns.current_step,
        updated_at: pipelineRuns.updated_at,
      })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.project_id, projectId),
          sql`${pipelineRuns.sprint_branch} IS NOT NULL`
        )
      )
      .orderBy(desc(pipelineRuns.updated_at));

    // Keep only the first (most-recent) row per branch.
    const seen = new Set<string>();
    const branches: ProjectBranchSummary[] = [];
    for (const row of rows) {
      const branch = row.sprint_branch ?? "";
      if (!branch || seen.has(branch)) continue;
      seen.add(branch);
      branches.push({
        sprint_branch: branch,
        latest_pipeline_id: row.pipeline_id,
        status: row.status as PipelineStatus,
        current_step: row.current_step as PipelineRole | "complete",
        updated_at: row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
      });
    }

    return branches;
  }

  // ─── GET ──────────────────────────────────────────────────────────────────

  async get(pipelineId: string): Promise<PipelineRun> {
    const [row] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipeline_id, pipelineId));

    if (!row) {
      throw new HttpError(404, "PIPELINE_NOT_FOUND", `Pipeline run not found: ${pipelineId}`);
    }

    return rowToRun(row);
  }

  // ─── COMPLETE STEP (called by execution layer after agent role finishes) ──

  async completeStep(
    pipelineId: string,
    role: PipelineRole,
    executionId: string,
    artifactPaths: string[],
    failed: boolean,
    verificationPassed?: boolean,
    errorMessage?: string
  ): Promise<PipelineRun> {
    const run = await this.get(pipelineId);

    this.assertCurrentStep(run, role);
    this.assertStatus(run, ["running"]);

    const steps = [...run.steps];
    const stepIdx = steps.findIndex((s) => s.role === role && s.status === "running");
    if (stepIdx === -1) {
      throw new HttpError(409, "STEP_NOT_RUNNING", `Step ${role} is not running`);
    }

    const now = new Date().toISOString();

    if (failed) {
      steps[stepIdx] = {
        ...steps[stepIdx],
        status: "failed",
        execution_id: executionId,
        artifact_paths: artifactPaths,
        completed_at: now,
        ...(errorMessage ? { error_message: errorMessage } : {}),
      };

      return this.save(run, {
        current_step: role,
        status: "failed",
        steps,
      });
    }

    // Determine if a gate is required.
    // In full-sprint mode all gates are bypassed so the pipeline runs autonomously end-to-end.
    const executionMode = run.metadata.execution_mode as string | undefined;
    const gateRequired = GATED_ROLES.has(role) && executionMode !== "full-sprint";

    steps[stepIdx] = {
      ...steps[stepIdx],
      status: "complete",
      execution_id: executionId,
      artifact_paths: artifactPaths,
      completed_at: now,
      gate_outcome: gateRequired ? null : "auto",
    };

    const nextStep = nextRoleAfter(role);

    if (gateRequired) {
      logger.info("Pipeline paused for operator approval", {
        pipeline_id: run.pipeline_id,
        role,
        execution_mode: executionMode,
      });
      return this.save(run, {
        current_step: role,
        status: "awaiting_approval",
        steps,
      });
    }

    // ── Execution mode: "next" ────────────────────────────────────────────────
    // Stop immediately after the entry role completes — do not advance downstream.
    // Pause at awaiting_approval so the pipeline stays open and the operator can
    // invoke the next role manually. Non-verifier roles stop unconditionally.
    // Verifier is handled by PASS/FAIL blocks below.
    if (executionMode === "next" && role === run.entry_point && role !== "verifier") {
      logger.info("Pipeline pausing after entry role (mode=next) — awaiting operator approval to continue", {
        pipeline_id: run.pipeline_id,
        role,
        next_step: nextStep,
      });
      return this.save(run, { current_step: role, status: "awaiting_approval", steps });
    }

    // ── Implementer complete in next mode — pause for operator handoff to verifier ────────
    // When implementer is part of a manual loop (verifier was the entry or appears in history),
    // pause instead of auto-advancing so operator can review before verifier re-runs.
    if (
      role === "implementer" &&
      executionMode === "next" &&
      steps.some((s) => s.role === "verifier")
    ) {
      logger.info("Implementer complete in next mode — pausing for operator handoff to verifier", {
        pipeline_id: run.pipeline_id,
      });
      const paused = await this.save(run, { current_step: role, status: "paused_takeover", steps });
      pipelineNotifierService.notify({
        pipeline_id: paused.pipeline_id,
        step: paused.current_step,
        status: paused.status,
        gate_required: true,
        artifact_paths: [],
        metadata: paused.metadata,
        agent_caller: "System",
      }).catch((err) => logger.error("Failed to send paused_takeover notification (implementer→verifier)", { error: String(err) }));
      return paused;
    }

    // Verifier FAIL: pause for operator handoff back to implementer (ADR-030)
    if (role === "verifier" && verificationPassed === false) {
      const attempts = (run.implementer_attempts ?? 0) + 1;
      if (attempts >= MAX_IMPLEMENTER_ATTEMPTS) {
        logger.info("Implementer retry limit reached — pausing for operator takeover", {
          pipeline_id: run.pipeline_id,
          implementer_attempts: attempts,
        });
        const paused = await this.save(run, { current_step: role, status: "paused_takeover", steps });
        pipelineNotifierService.notify({
          pipeline_id: paused.pipeline_id,
          step: paused.current_step,
          status: paused.status,
          gate_required: true,
          artifact_paths: [],
          metadata: paused.metadata,
          agent_caller: "System",
        }).catch((err) => logger.error("Failed to send takeover notification (fixer limit)", { error: String(err) }));
        return paused;
      }
      // In next mode: pause and record the intended next step so handoff() routes correctly.
      // In auto-flow modes (full-sprint, next-flow): advance directly.
      if (executionMode === "next") {
        logger.info("Verifier FAIL in next mode — pausing for operator handoff to implementer", {
          pipeline_id: run.pipeline_id,
          implementer_attempts: attempts,
        });
        const metadata = { ...run.metadata, pending_next_step: "implementer" } as typeof run.metadata;
        const paused = await this.save(run, { current_step: role, status: "paused_takeover", steps, metadata, implementer_attempts: attempts });
        pipelineNotifierService.notify({
          pipeline_id: paused.pipeline_id,
          step: paused.current_step,
          status: paused.status,
          gate_required: true,
          artifact_paths: [],
          metadata: paused.metadata,
          agent_caller: "System",
        }).catch((err) => logger.error("Failed to send paused_takeover notification (verifier FAIL)", { error: String(err) }));
        return paused;
      }
      steps.push(this.newRunningStep("implementer", now));
      return this.save(run, { current_step: "implementer", status: "running", steps, implementer_attempts: attempts });
    }

    // Verifier PASS in next mode: pause for operator handoff to sprint-controller
    if (role === "verifier" && verificationPassed !== false && executionMode === "next") {
      logger.info("Verifier PASS in next mode — pausing for operator handoff to sprint-controller", {
        pipeline_id: run.pipeline_id,
      });
      const paused = await this.save(run, { current_step: role, status: "paused_takeover", steps });
      pipelineNotifierService.notify({
        pipeline_id: paused.pipeline_id,
        step: paused.current_step,
        status: paused.status,
        gate_required: true,
        artifact_paths: [],
        metadata: paused.metadata,
        agent_caller: "System",
      }).catch((err) => logger.error("Failed to send paused_takeover notification (verifier PASS)", { error: String(err) }));
      return paused;
    }

    // ── Execution mode: "next-flow" (non-planner entry) ─────────────────────────
    // Verifier PASS is the terminal success state for next-flow with a non-planner entry.
    // Sprint close-out (PR creation) is reserved for planner or full-sprint initiated flows.
    if (
      role === "verifier" &&
      verificationPassed !== false &&
      executionMode === "next-flow" &&
      run.entry_point !== "planner"
    ) {
      logger.info("Pipeline stopping after verifier PASS (mode=next-flow, non-planner entry)", {
        pipeline_id: run.pipeline_id,
        entry_point: run.entry_point,
        execution_mode: executionMode,
      });
      return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "complete", steps });
    }

    // ── Execution mode: "full-sprint" ──────────────────────────────────────────
    // After verifier PASS, route back to sprint-controller for task close-out.
    // Planner performs final sprint close-out after sprint-controller emits gate artifacts.
    if (
      role === "verifier" &&
      verificationPassed !== false &&
      executionMode === "full-sprint"
    ) {
      logger.info("Verifier PASS in full-sprint mode — routing to sprint-controller task close-out", {
        pipeline_id: run.pipeline_id,
        entry_point: run.entry_point,
      });
      steps.push(this.newRunningStep("sprint-controller", now));
      return this.save(run, { current_step: "sprint-controller", status: "running", steps });
    }

    // Sprint Controller task close-out: verifier already passed -> create PR and await merge.
    // Detected by presence of a completed verifier step in the history.
    // ADR-030: Sprint Controller is the PR gate point; no Planner step in close-out.
    if (role === "sprint-controller") {
      const verifierPassed = steps.some((s) => s.role === "verifier" && s.status === "complete");
      if (verifierPassed) {
        logger.info("Sprint Controller task close-out complete: transitioning to awaiting_pr_review", {
          pipeline_id: run.pipeline_id,
        });
        steps[stepIdx] = { ...steps[stepIdx], gate_outcome: "awaiting_pr_review" };
        return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "awaiting_pr_review", steps });
      }
    }

    // Auto-advance
    if (nextStep === "complete") {
      return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "complete", steps });
    }

    steps.push(this.newRunningStep(nextStep, now));
    return this.save(run, { current_step: nextStep, status: "running", steps });
  }

  // ─── APPROVE ──────────────────────────────────────────────────────────────

  async approve(pipelineId: string, actor: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["awaiting_approval"]);

    const steps = [...run.steps];
    const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
    const now = new Date().toISOString();

    steps[stepIdx] = { ...steps[stepIdx], gate_outcome: "approved", actor };

    // Sprint Controller task close-out: if verifier already passed, transition to
    // awaiting_pr_review instead of following NEXT_ROLE (which maps sprint-controller→implementer).
    // Mirrors the same check in advanceStep() to handle the operator-approval path consistently.
    if (run.current_step === "sprint-controller") {
      const verifierPassed = steps.some((s) => s.role === "verifier" && s.status === "complete");
      if (verifierPassed) {
        steps[stepIdx] = { ...steps[stepIdx], gate_outcome: "awaiting_pr_review" };
        return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "awaiting_pr_review", steps });
      }
    }

    const next = nextRoleAfter(run.current_step as PipelineRole);

    if (next === "complete") {
      return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "complete", steps });
    }

    steps.push(this.newRunningStep(next, now));
    return this.save(run, { current_step: next, status: "running", steps });
  }

  // ─── TAKEOVER ─────────────────────────────────────────────────────────────

  async cancel(pipelineId: string, actor: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["running", "awaiting_approval", "paused_takeover", "awaiting_pr_review", "failed"]);

    const steps = [...run.steps];

    // When awaiting_pr_review or failed, the step is already in a terminal state —
    // nothing to stamp; just flip the pipeline status to cancelled.
    if (run.status !== "awaiting_pr_review" && run.status !== "failed") {
      const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
      steps[stepIdx] = { ...steps[stepIdx], actor, status: "complete", completed_at: new Date().toISOString() };
    }

    return this.save(run, { status: "cancelled", steps });
  }

  async takeover(pipelineId: string, actor: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["awaiting_approval", "running", "failed"]);

    const steps = [...run.steps];
    const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
    steps[stepIdx] = { ...steps[stepIdx], actor, status: "running" };

    return this.save(run, { status: "paused_takeover", steps });
  }

  async retry(pipelineId: string, actor: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["failed"]);

    const steps = [...run.steps];
    const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
    const now = new Date().toISOString();
    
    // Reset the failed step to running state for retry, clearing stale fields from failed attempt
    // Keep original actor for audit trail; this is automated recovery, not human control
    steps[stepIdx] = {
      ...steps[stepIdx],
      status: "running",
      started_at: now,
      completed_at: undefined,
      execution_id: undefined,
      artifact_paths: [],
      gate_outcome: null,
    };

    // Resume pipeline execution (system takes control, not the operator)
    return this.save(run, { status: "running", steps });
  }

  // ─── HANDOFF ──────────────────────────────────────────────────────────────

  async handoff(pipelineId: string, req: PipelineHandoffRequest): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["paused_takeover"]);

    const steps = [...run.steps];
    const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
    const now = new Date().toISOString();

    steps[stepIdx] = {
      ...steps[stepIdx],
      status: "complete",
      gate_outcome: "human_complete",
      actor: req.actor,
      completed_at: now,
      artifact_paths: req.artifact_path
        ? [...steps[stepIdx].artifact_paths, req.artifact_path]
        : steps[stepIdx].artifact_paths,
    };

    // Check for a pending_next_step override (set by verifier FAIL in next mode to route
    // back to implementer instead of following NEXT_ROLE which maps verifier→sprint-controller).
    const pendingNext = run.metadata.pending_next_step as PipelineRole | undefined;
    const next: PipelineRole | "complete" = pendingNext ?? nextRoleAfter(run.current_step as PipelineRole);

    // Clear the override from metadata before saving
    const updatedMetadata = pendingNext
      ? (Object.fromEntries(
          Object.entries(run.metadata).filter(([k]) => k !== "pending_next_step")
        ) as typeof run.metadata)
      : undefined;

    if (next === "complete") {
      return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "complete", steps, ...(updatedMetadata ? { metadata: updatedMetadata } : {}) });
    }

    steps.push(this.newRunningStep(next, now));
    return this.save(run, { current_step: next, status: "running", steps, ...(updatedMetadata ? { metadata: updatedMetadata } : {}) });
  }

  // ─── PR MANAGEMENT (ADR-030) ──────────────────────────────────────────────

  /**
   * Record PR details after Sprint Controller (close-out) creates the PR.
   * Called by the Sprint Controller script once the GitHub PR is opened.
   */
  async setPrDetails(pipelineId: string, prNumber: number, prUrl: string, sprintBranch: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["running", "awaiting_pr_review"]);
    logger.info("Pipeline PR details set", { pipeline_id: pipelineId, pr_number: prNumber, pr_url: prUrl });
    return this.save(run, { pr_number: prNumber, pr_url: prUrl, sprint_branch: sprintBranch });
  }

  /**
   * Persist sprint branch as soon as Sprint Controller (setup) creates it.
   */
  async setSprintBranch(pipelineId: string, sprintBranch: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["running", "awaiting_pr_review", "paused_takeover"]);
    logger.info("Pipeline sprint branch set", { pipeline_id: pipelineId, sprint_branch: sprintBranch });
    return this.save(run, { sprint_branch: sprintBranch });
  }

  /**
   * Mark the pipeline complete when the PR is merged.
   * Called by webhook handler or polling job.
   */
  async markPrMerged(pipelineId: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["awaiting_pr_review"]);
    logger.info("Pipeline PR merged — marking complete", { pipeline_id: pipelineId, pr_number: run.pr_number });
    return this.saveAndMaybeCleanup(run, { status: "complete" });
  }

  /**
   * Mark the pipeline failed when the sprint PR is closed without being merged.
   * Called by the PR merge poller when it detects pr.state === "closed" && !pr.merged.
   */
  async markPrClosed(pipelineId: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["awaiting_pr_review"]);
    logger.info("Pipeline PR closed without merge — marking failed", { pipeline_id: pipelineId, pr_number: run.pr_number });
    return this.save(run, { status: "failed" });
  }

  async linkOperation(pipelineId: string, link: PipelineOperationLink): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    const metadata = (run.metadata ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(metadata["operations"]) ? (metadata["operations"] as PipelineOperationLink[]) : [];

    const next = [
      ...existing,
      link,
    ].slice(-50);

    return this.save(run, {
      metadata: {
        source: (metadata["source"] as "slack" | "api") ?? "api",
        ...metadata,
        operations: next,
        last_operation_id: link.operation_id,
        last_operation_action: link.action,
        last_operation_status: link.status,
      },
    });
  }

  async listAwaitingPrReviewRuns(): Promise<AwaitingPrReviewRun[]> {
    const rows = await db
      .select({
        pipeline_id: pipelineRuns.pipeline_id,
        project_id: pipelineRuns.project_id,
        pr_number: pipelineRuns.pr_number,
        sprint_branch: pipelineRuns.sprint_branch,
      })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.status, "awaiting_pr_review"));

    return rows.map((row) => ({
      pipeline_id: row.pipeline_id,
      project_id: row.project_id ?? undefined,
      pr_number: row.pr_number ?? undefined,
      sprint_branch: row.sprint_branch ?? undefined,
    }));
  }

  // ─── SKIP ─────────────────────────────────────────────────────────────────

  /**
   * Used by the artifact GC sweep to determine whether a pipeline's artifact directory
   * is safe to delete.  Returns true when the pipeline is in a terminal-failure state
   * (failed / cancelled) OR when no DB row exists at all (orphaned directory).
   */
  async isTerminalFailureOrOrphan(pipelineId: string): Promise<boolean> {
    try {
      const run = await this.get(pipelineId);
      return run.status === "failed" || run.status === "cancelled";
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 404) {
        return true; // No matching row — orphaned artifact dir
      }
      throw err;
    }
  }

  async skip(pipelineId: string, req: PipelineSkipRequest): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["running", "awaiting_approval", "paused_takeover"]);

    const steps = [...run.steps];
    const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
    const now = new Date().toISOString();

    steps[stepIdx] = {
      ...steps[stepIdx],
      status: "complete",
      gate_outcome: "skipped",
      actor: req.actor,
      completed_at: now,
      justification: req.justification,
    };

    const next = nextRoleAfter(run.current_step as PipelineRole);

    if (next === "complete") {
      return this.saveAndMaybeCleanup(run, { current_step: "complete", status: "complete", steps });
    }

    steps.push(this.newRunningStep(next, now));
    return this.save(run, { current_step: next, status: "running", steps });
  }

  // ─── INTERNAL HELPERS ─────────────────────────────────────────────────────

  private newRunningStep(role: PipelineRole, now: string): PipelineStepRecord {
    return {
      role,
      status: "running",
      gate_outcome: null,
      artifact_paths: [],
      actor: "system",
      started_at: now,
    };
  }

  private currentStepIdx(steps: PipelineStepRecord[], role: PipelineRole): number {
    // findLastIndex not available in ES2022 lib — use reduce to find last match
    const idx = steps.reduce((found, s, i) => (s.role === role ? i : found), -1);
    if (idx === -1) {
      throw new HttpError(409, "STEP_NOT_FOUND", `No step record for role: ${role}`);
    }
    return idx;
  }

  private assertCurrentStep(run: PipelineRun, role: PipelineRole): void {
    if (run.current_step !== role) {
      throw new HttpError(
        409,
        "WRONG_STEP",
        `Expected current step ${role}, but pipeline is at ${run.current_step}`
      );
    }
  }

  /**
   * Record a step failure directly, bypassing assertCurrentStep.
   *
   * Used in error-recovery paths where a concurrent write has already moved
   * current_step to a different role (e.g. a getStatusSummary metadata save
   * that re-stamped current_step=sprint-controller while the implementer was
   * running). Instead of losing the failure silently, this method finds the
   * most-recent running step for the given role in the steps array and stamps
   * it failed, then corrects current_step and status in the DB row.
   *
   * Returns the updated PipelineRun on success, or null when no running step
   * for the role exists (non-throwing — caller logs and continues).
   */
  async failStepDirect(
    pipelineId: string,
    role: PipelineRole,
    executionId: string,
    errorMessage: string,
    artifactPaths: string[] = []
  ): Promise<PipelineRun | null> {
    let run: PipelineRun;
    try {
      run = await this.get(pipelineId);
    } catch {
      return null;
    }

    const steps = [...run.steps];
    // Find the last running step for this role regardless of current_step
    const stepIdx = steps.reduce((found, s, i) =>
      s.role === role && s.status === "running" ? i : found, -1
    );
    if (stepIdx === -1) {
      return null;
    }

    const now = new Date().toISOString();
    steps[stepIdx] = {
      ...steps[stepIdx],
      status: "failed",
      execution_id: executionId,
      artifact_paths: [...(steps[stepIdx].artifact_paths ?? []), ...artifactPaths],
      completed_at: now,
      error_message: errorMessage,
    };

    return this.save(run, {
      current_step: role,
      status: "failed",
      steps,
    });
  }

  private assertStatus(run: PipelineRun, allowed: PipelineStatus[]): void {
    if (!allowed.includes(run.status)) {
      throw new HttpError(
        409,
        "INVALID_PIPELINE_STATUS",
        `Action not allowed in status '${run.status}'. Allowed: ${allowed.join(", ")}`
      );
    }
  }

  /**
   * Save + trigger artifact cleanup when the pipeline reaches a terminal-success state.
   * Cleanup failure is non-fatal — logged and swallowed so it never rolls back the status update.
   */
  private async saveAndMaybeCleanup(
    run: PipelineRun,
    patch: Parameters<PipelineService["save"]>[1]
  ): Promise<PipelineRun> {
    const updated = await this.save(run, patch);
    const nextStatus = patch.status ?? run.status;
    if (TERMINAL_SUCCESS_STATUSES.includes(nextStatus as PipelineStatus)) {
      artifactService.cleanup(run.pipeline_id).catch((err) => {
        logger.error("Artifact cleanup failed — artifacts may remain on disk", {
          pipeline_id: run.pipeline_id,
          error: String(err),
        });
      });
    }
    return updated;
  }

  private async save(
    run: PipelineRun,
    patch: Partial<Pick<PipelineRun, "current_step" | "status" | "steps" | "sprint_branch" | "pr_number" | "pr_url" | "implementer_attempts" | "metadata">>
  ): Promise<PipelineRun> {
    // Build a compact summary of what this save is actually changing so log readers
    // can distinguish the 3–4 rapid consecutive saves that happen during sprint-controller setup.
    const changed: Record<string, unknown> = {};
    if (patch.current_step !== undefined) changed.current_step = patch.current_step;
    if (patch.status !== undefined) changed.status = patch.status;
    if (patch.sprint_branch !== undefined) changed.sprint_branch = patch.sprint_branch;
    if (patch.pr_number !== undefined) changed.pr_number = patch.pr_number;
    if (patch.pr_url !== undefined) changed.pr_url = patch.pr_url;
    if (patch.implementer_attempts !== undefined) changed.implementer_attempts = patch.implementer_attempts;
    if (patch.metadata !== undefined) changed.metadata = "(updated)";

    const rows = await db
      .update(pipelineRuns)
      .set({
        current_step: patch.current_step ?? run.current_step,
        status: patch.status ?? run.status,
        steps: (patch.steps ?? run.steps) as object[],
        ...(patch.metadata !== undefined ? { metadata: patch.metadata as Record<string, unknown> } : {}),
        ...(patch.sprint_branch !== undefined ? { sprint_branch: patch.sprint_branch } : {}),
        ...(patch.pr_number !== undefined ? { pr_number: patch.pr_number } : {}),
        ...(patch.pr_url !== undefined ? { pr_url: patch.pr_url } : {}),
        ...(patch.implementer_attempts !== undefined ? { implementer_attempts: patch.implementer_attempts } : {}),
        lock_version: run.lock_version + 1,
        updated_at: new Date(),
      })
      .where(and(eq(pipelineRuns.pipeline_id, run.pipeline_id), eq(pipelineRuns.lock_version, run.lock_version)))
      .returning();

    if (rows.length === 0) {
      throw new HttpError(
        409,
        "CONCURRENT_WRITE",
        `Pipeline ${run.pipeline_id} was modified by a concurrent request (lock_version mismatch). Retry.`
      );
    }

    const row = rows[0];
    logger.info("Pipeline run updated", {
      pipeline_id: run.pipeline_id,
      status: row.status,
      current_step: row.current_step,
      lock_version: row.lock_version,
      changed,
    });

    return rowToRun(row);
  }

  // ─── STATUS SUMMARY ───────────────────────────────────────────────────────

  async getStatusSummary(pipelineId: string): Promise<PipelineStatusSummary> {
    let run = await this.get(pipelineId);

    // 1) Fresh git refresh before computing status.
    // 2) Reconcile DB drift from control artifacts if needed.
    const gitRefresh = await this.refreshGitForStatus(run);

    if (gitRefresh.headCommit) {
      try {
        run = await this.save(run, {
          metadata: {
            ...run.metadata,
            last_status_git_head: gitRefresh.headCommit,
            last_status_git_refresh_at: new Date().toISOString(),
          },
        });
      } catch (err) {
        // CONCURRENT_WRITE here means another request advanced the pipeline while we were
        // doing the git pull. The metadata refresh is non-critical — skip it and continue
        // with the stale run snapshot; the next status poll will succeed.
        if (err instanceof HttpError && err.code === "CONCURRENT_WRITE") {
          logger.warn("getStatusSummary: metadata save skipped due to concurrent write", {
            pipeline_id: pipelineId,
          });
        } else {
          throw err;
        }
      }
    }

    run = await this.reconcileRunFromControlArtifacts(run);

    const summary: PipelineStatusSummary = { ...run };

    // Enrich with repo URL from linked project (prefer git-refresh project lookup)
    if (gitRefresh.project) {
      summary.repo_url = gitRefresh.project.repo_url;
    } else if (run.project_id) {
      try {
        const project = await projectService.getById(run.project_id);
        if (project) summary.repo_url = project.repo_url;
      } catch {
        // non-fatal — project may be unavailable
      }
    }

    const currentTask = await this.readArtifactJson(run, (p) => p.endsWith("current_task.json"));
    const verification = await this.readArtifactJson(run, (p) => p.endsWith("verification_result.json"));
    const closeout = await this.readArtifactJson(run, (p) => p.endsWith("sprint_closeout.json"));

    summary.control_state = {
      refreshed_at: new Date().toISOString(),
      source: "artifacts",
      git_head_commit: gitRefresh.headCommit,
      ...(currentTask ? { current_task: currentTask } : {}),
      ...(verification ? { verification } : {}),
      ...(closeout ? { closeout } : {}),
    };

    // Identify current and prior step records (use last occurrence of each role)
    const activeSteps = run.steps.filter((s) => s.status !== "not_applicable");
    const currentStepRecord = activeSteps
      .slice()
      .reverse()
      .find((s) => s.role === run.current_step || s.status === "running" || s.status === "failed");
    const priorStepRecord = activeSteps
      .slice()
      .reverse()
      .find((s) => s !== currentStepRecord && (s.status === "complete" || s.status === "failed"));

    if (currentStepRecord) summary.current_step_detail = currentStepRecord;
    if (priorStepRecord) summary.prior_step_detail = priorStepRecord;

    // Extract last error from most recent failed step's execution record
    const failedStep = run.steps
      .slice()
      .reverse()
      .find((s) => s.status === "failed" && s.execution_id);

    if (failedStep?.execution_id) {
      try {
        const record = await executionRecordModel.getById(failedStep.execution_id);
        if (record && record.errors && record.errors.length > 0) {
          const { code, message, details } = record.errors[0];
          summary.last_error = { code, message, details };
        }
      } catch {
        // non-fatal
      }
    }

    const latestOperationId = typeof run.metadata?.last_operation_id === "string"
      ? run.metadata.last_operation_id
      : undefined;

    if (latestOperationId) {
      try {
        const [opRow] = await db
          .select()
          .from(state)
          .where(eq(state.state_id, latestOperationId));

        if (opRow?.data) {
          const opJob = opRow.data as AdminOpsJob;
          summary.latest_operation = summarizeOperationJob({
            ...opJob,
            status: (opRow.status as AdminOpsStatus) ?? opJob.status,
            version: opRow.version,
          });
        }
      } catch {
        // non-fatal
      }
    }

    summary.execution_signals = buildExecutionSignals(run, summary);

    return summary;
  }

  async getCurrentStatusSummary(channelId?: string): Promise<CurrentPipelineStatusResult> {
    const activeStatuses: PipelineStatus[] = [
      "running",
      "awaiting_approval",
      "awaiting_pr_review",
      "paused_takeover",
    ];

    const whereClause = channelId
      ? and(
          inArray(pipelineRuns.status, activeStatuses),
          sql`${pipelineRuns.metadata} ->> 'slack_channel' = ${channelId}`
        )
      : inArray(pipelineRuns.status, activeStatuses);

    const rows = await db
      .select()
      .from(pipelineRuns)
      .where(whereClause)
      .orderBy(desc(pipelineRuns.updated_at));

    if (rows.length === 0) {
      if (channelId) {
        const latestRows = await db
          .select()
          .from(pipelineRuns)
          .where(sql`${pipelineRuns.metadata} ->> 'slack_channel' = ${channelId}`)
          .orderBy(desc(pipelineRuns.updated_at))
          .limit(1);

        if (latestRows.length > 0) {
          return {
            kind: "single",
            run: await this.getStatusSummary(latestRows[0].pipeline_id),
          };
        }
      }

      return {
        kind: "none",
        message: channelId
          ? "No active pipelines found for this Slack channel."
          : "No active pipelines found.",
      };
    }

    if (rows.length === 1) {
      return {
        kind: "single",
        run: await this.getStatusSummary(rows[0].pipeline_id),
      };
    }

    const runs: PipelineStatusChoice[] = await Promise.all(
      rows.map(async (row) => {
        const summary = await this.getStatusSummary(row.pipeline_id);
        return {
          pipeline_id: summary.pipeline_id,
          status: summary.status,
          current_step: summary.current_step,
          current_actor: summary.current_step_detail?.actor,
          project_id: summary.project_id,
          repo_url: summary.repo_url,
          sprint_branch: summary.sprint_branch,
          updated_at: summary.updated_at,
          wait_state: summarizeWaitState(summary),
        };
      })
    );

    return { kind: "multiple", runs };
  }

  async listStatusByChannel(
    channelId: string,
    limit = 20,
    statuses: PipelineStatus[] = ["running", "awaiting_approval", "paused_takeover"]
  ): Promise<ChannelPipelineStatusListResult> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;
    const safeStatuses = statuses.length > 0 ? statuses : ["running", "awaiting_approval", "paused_takeover"];

    const rows = await db
      .select()
      .from(pipelineRuns)
      .where(
        and(
          sql`${pipelineRuns.metadata} ->> 'slack_channel' = ${channelId}`,
          inArray(pipelineRuns.status, safeStatuses)
        )
      )
      .orderBy(desc(pipelineRuns.updated_at))
      .limit(safeLimit);

    const runs: PipelineStatusChoice[] = await Promise.all(
      rows.map(async (row) => {
        const summary = await this.getStatusSummary(row.pipeline_id);
        return {
          pipeline_id: summary.pipeline_id,
          status: summary.status,
          current_step: summary.current_step,
          current_actor: summary.current_step_detail?.actor,
          project_id: summary.project_id,
          repo_url: summary.repo_url,
          sprint_branch: summary.sprint_branch,
          updated_at: summary.updated_at,
          wait_state: summarizeWaitState(summary),
        };
      })
    );

    return { channel_id: channelId, runs };
  }

  async listStagedPhases(pipelineId: string, limit = 20): Promise<StagedPhasesResult> {
    const { run, git_head_commit, refreshed_at } = await this.getArtifactDrivenRun(pipelineId);
    const safeLimit = this.normalizeLimit(limit);

    const phaseArtifacts = this.collectArtifactEntries(run, (p) => /phase_plan_.*\.md$/i.test(p));
    const phases: StagedPhaseRecord[] = [];

    for (const entry of phaseArtifacts) {
      if (phases.length >= safeLimit) {
        break;
      }

      try {
        const markdown = await artifactService.read(entry.artifact_path);
        const parsed = this.parsePhasePlan(markdown, entry.artifact_path);
        phases.push({
          phase_id: parsed.phase_id,
          name: parsed.name,
          status: parsed.status,
          artifact_path: entry.artifact_path,
          sourced_from: entry.sourced_from,
          completed_at: entry.completed_at,
        });
      } catch {
        // Skip unreadable artifacts and continue with remaining entries.
      }
    }

    // Fall back to the git clone when artifact files are unavailable
    // (e.g. artifacts were cleaned up after pipeline completion).
    if (phases.length === 0 && run.project_id) {
      const project = run.project_id ? await projectService.getById(run.project_id) : null;
      if (project) {
        const files = [
          ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/staged_phases", /^phase_plan_.*\.md$/i)),
          ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/active", /^phase_plan_.*\.md$/i)),
        ].slice(0, safeLimit);
        for (const absPath of files) {
          if (phases.length >= safeLimit) break;
          try {
            const markdown = await fs.readFile(absPath, "utf-8");
            const relPath = this.toRelPath(absPath);
            const parsed = this.parsePhasePlan(markdown, relPath);
            const stat = await fs.stat(absPath);
            phases.push({
              phase_id: parsed.phase_id,
              name: parsed.name,
              status: parsed.status,
              artifact_path: relPath,
              sourced_from: "planner",
              completed_at: new Date(stat.mtimeMs).toISOString(),
            });
          } catch {
            // Skip unreadable files.
          }
        }
      }
    }

    return {
      pipeline_id: run.pipeline_id,
      refreshed_at,
      source: "artifacts",
      git_head_commit,
      phases,
    };
  }

  async listStagedSprints(pipelineId: string, limit = 20): Promise<StagedSprintsResult> {
    const { run, git_head_commit, refreshed_at } = await this.getArtifactDrivenRun(pipelineId);
    const safeLimit = this.normalizeLimit(limit);

    const sprintArtifacts = this.collectArtifactEntries(run, (p) => /sprint_plan_.*\.md$/i.test(p));
    const sprints: StagedSprintRecord[] = [];

    for (const entry of sprintArtifacts) {
      if (sprints.length >= safeLimit) {
        break;
      }

      try {
        const markdown = await artifactService.read(entry.artifact_path);
        const parsed = this.parseSprintPlan(markdown, entry.artifact_path);
        sprints.push({
          sprint_id: parsed.sprint_id,
          phase_id: parsed.phase_id,
          name: parsed.name,
          status: parsed.status,
          sprint_plan_path: entry.artifact_path,
          sourced_from: entry.sourced_from,
          completed_at: entry.completed_at,
        });
      } catch {
        // Skip unreadable artifacts and continue with remaining entries.
      }
    }

    // Fall back to the git clone when artifact files are unavailable
    // (e.g. artifacts were cleaned up after pipeline completion).
    if (sprints.length === 0 && run.project_id) {
      const project = run.project_id ? await projectService.getById(run.project_id) : null;
      if (project) {
        const files = [
          ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/staged_sprints", /^sprint_plan_.*\.md$/i)),
          ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/active", /^sprint_plan_.*\.md$/i)),
        ].slice(0, safeLimit);
        for (const absPath of files) {
          if (sprints.length >= safeLimit) break;
          try {
            const markdown = await fs.readFile(absPath, "utf-8");
            const relPath = this.toRelPath(absPath);
            const parsed = this.parseSprintPlan(markdown, relPath);
            const stat = await fs.stat(absPath);
            sprints.push({
              sprint_id: parsed.sprint_id,
              phase_id: parsed.phase_id,
              name: parsed.name,
              status: parsed.status,
              sprint_plan_path: relPath,
              sourced_from: "sprint-controller",
              completed_at: new Date(stat.mtimeMs).toISOString(),
            });
          } catch {
            // Skip unreadable files.
          }
        }
      }
    }

    return {
      pipeline_id: run.pipeline_id,
      refreshed_at,
      source: "artifacts",
      git_head_commit,
      sprints,
    };
  }

  async listStagedTasks(pipelineId: string, limit = 20): Promise<StagedTasksResult> {
    const { run, git_head_commit, refreshed_at } = await this.getArtifactDrivenRun(pipelineId);
    const safeLimit = this.normalizeLimit(limit);

    const sprintArtifacts = this.collectArtifactEntries(run, (p) => /sprint_plan_.*\.md$/i.test(p));
    const tasks: StagedTaskRecord[] = [];

    for (const entry of sprintArtifacts) {
      if (tasks.length >= safeLimit) {
        break;
      }

      try {
        const markdown = await artifactService.read(entry.artifact_path);
        const parsedSprint = this.parseSprintPlan(markdown, entry.artifact_path);
        const parsedTasks = this.parseSprintTasks(markdown);

        for (const task of parsedTasks) {
          if (tasks.length >= safeLimit) {
            break;
          }

          tasks.push({
            sprint_id: parsedSprint.sprint_id,
            phase_id: parsedSprint.phase_id,
            task_id: task.task_id,
            label: task.label,
            status: task.status,
            sprint_plan_path: entry.artifact_path,
            sourced_from: entry.sourced_from,
            completed_at: entry.completed_at,
          });
        }
      } catch {
        // Skip unreadable artifacts and continue with remaining entries.
      }
    }

    // Fall back to the git clone when artifact files are unavailable
    // (e.g. artifacts were cleaned up after pipeline completion).
    if (tasks.length === 0 && run.project_id) {
      const project = run.project_id ? await projectService.getById(run.project_id) : null;
      if (project) {
        const sprintFiles = [
          ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/staged_sprints", /^sprint_plan_.*\.md$/i)),
          ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/active", /^sprint_plan_.*\.md$/i)),
        ];
        for (const absPath of sprintFiles) {
          if (tasks.length >= safeLimit) break;
          try {
            const markdown = await fs.readFile(absPath, "utf-8");
            const relPath = this.toRelPath(absPath);
            const parsedSprint = this.parseSprintPlan(markdown, relPath);
            const parsedTasks = this.parseSprintTasks(markdown);
            const stat = await fs.stat(absPath);
            const completedAt = new Date(stat.mtimeMs).toISOString();
            for (const task of parsedTasks) {
              if (tasks.length >= safeLimit) break;
              tasks.push({
                sprint_id: parsedSprint.sprint_id,
                phase_id: parsedSprint.phase_id,
                task_id: task.task_id,
                label: task.label,
                status: task.status,
                sprint_plan_path: relPath,
                sourced_from: "sprint-controller",
                completed_at: completedAt,
              });
            }
          } catch {
            // Skip unreadable files.
          }
        }
      }
    }

    return {
      pipeline_id: run.pipeline_id,
      refreshed_at,
      source: "artifacts",
      git_head_commit,
      tasks,
    };
  }

  async listRepoStagedPhases(opts?: { channelId?: string; projectId?: string; limit?: number }): Promise<RepoStagedPhasesResult> {
    const safeLimit = this.normalizeLimit(opts?.limit ?? 20);
    const { project, git_head_commit, refreshed_at } = await this.resolveArtifactProject(opts?.channelId, opts?.projectId);

    const files = [
      ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/staged_phases", /^phase_plan_.*\.md$/i)),
      ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/active", /^phase_plan_.*\.md$/i)),
    ].slice(0, safeLimit);

    const phases: StagedPhaseRecord[] = [];
    for (const absPath of files) {
      try {
        const markdown = await fs.readFile(absPath, "utf-8");
        const relPath = this.toRelPath(absPath);
        const parsed = this.parsePhasePlan(markdown, relPath);
        const stat = await fs.stat(absPath);
        phases.push({
          phase_id: parsed.phase_id,
          name: parsed.name,
          status: parsed.status,
          artifact_path: relPath,
          sourced_from: "planner",
          completed_at: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {
        // Ignore unreadable files and continue.
      }
    }

    return {
      refreshed_at,
      source: "artifacts",
      git_head_commit,
      project_id: project.project_id,
      ...(opts?.channelId ? { channel_id: opts.channelId } : {}),
      phases,
    };
  }

  async listRepoStagedSprints(opts?: { channelId?: string; projectId?: string; limit?: number }): Promise<RepoStagedSprintsResult> {
    const safeLimit = this.normalizeLimit(opts?.limit ?? 20);
    const { project, git_head_commit, refreshed_at } = await this.resolveArtifactProject(opts?.channelId, opts?.projectId);

    const files = [
      ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/staged_sprints", /^sprint_plan_.*\.md$/i)),
      ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/active", /^sprint_plan_.*\.md$/i)),
    ].slice(0, safeLimit);

    const sprints: StagedSprintRecord[] = [];
    for (const absPath of files) {
      try {
        const markdown = await fs.readFile(absPath, "utf-8");
        const relPath = this.toRelPath(absPath);
        const parsed = this.parseSprintPlan(markdown, relPath);
        const stat = await fs.stat(absPath);
        sprints.push({
          sprint_id: parsed.sprint_id,
          phase_id: parsed.phase_id,
          name: parsed.name,
          status: parsed.status,
          sprint_plan_path: relPath,
          sourced_from: "sprint-controller",
          completed_at: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {
        // Ignore unreadable files and continue.
      }
    }

    return {
      refreshed_at,
      source: "artifacts",
      git_head_commit,
      project_id: project.project_id,
      ...(opts?.channelId ? { channel_id: opts.channelId } : {}),
      sprints,
    };
  }

  async listRepoStagedTasks(opts?: { channelId?: string; projectId?: string; limit?: number }): Promise<RepoStagedTasksResult> {
    const safeLimit = this.normalizeLimit(opts?.limit ?? 20);
    const { project, git_head_commit, refreshed_at } = await this.resolveArtifactProject(opts?.channelId, opts?.projectId);

    const sprintFiles = [
      ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/staged_sprints", /^sprint_plan_.*\.md$/i)),
      ...(await this.listRepoMarkdownFiles(project.clone_path, "project_work/ai_project_tasks/active", /^sprint_plan_.*\.md$/i)),
    ];

    const tasks: StagedTaskRecord[] = [];
    for (const absPath of sprintFiles) {
      if (tasks.length >= safeLimit) {
        break;
      }

      try {
        const markdown = await fs.readFile(absPath, "utf-8");
        const relPath = this.toRelPath(absPath);
        const sprint = this.parseSprintPlan(markdown, relPath);
        const parsedTasks = this.parseSprintTasks(markdown);
        const stat = await fs.stat(absPath);
        const completedAt = new Date(stat.mtimeMs).toISOString();

        for (const task of parsedTasks) {
          if (tasks.length >= safeLimit) {
            break;
          }

          tasks.push({
            sprint_id: sprint.sprint_id,
            phase_id: sprint.phase_id,
            task_id: task.task_id,
            label: task.label,
            status: task.status,
            sprint_plan_path: relPath,
            sourced_from: "sprint-controller",
            completed_at: completedAt,
          });
        }
      } catch {
        // Ignore unreadable files and continue.
      }
    }

    return {
      refreshed_at,
      source: "artifacts",
      git_head_commit,
      project_id: project.project_id,
      ...(opts?.channelId ? { channel_id: opts.channelId } : {}),
      tasks,
    };
  }

  /**
   * On startup: find any pipelines still marked `running` (orphaned by a prior container
   * restart mid-execution) and flip them to `cancelled` so they don't pollute /adp-status.
   * Logs a summary and is always non-throwing.
   */
  async reconcileOrphanedRuns(): Promise<void> {
    try {
      const rows = await db
        .select({
          pipeline_id: pipelineRuns.pipeline_id,
          current_step: pipelineRuns.current_step,
          steps: pipelineRuns.steps,
          metadata: pipelineRuns.metadata,
        })
        .from(pipelineRuns)
        .where(eq(pipelineRuns.status, "running"));

      if (rows.length === 0) {
        logger.info("Startup reconciliation: no orphaned pipelines found");
        return;
      }

      logger.info("Startup reconciliation: checking orphaned running pipelines", {
        count: rows.length,
        pipeline_ids: rows.map((r) => r.pipeline_id),
      });

      const now = new Date().toISOString();
      const completed: string[] = [];
      const cancelled: string[] = [];

      for (const row of rows) {
        try {
          const steps = row.steps as PipelineStepRecord[];
          // Find the current step in history
          const currentStep = steps.find((s) => s.role === row.current_step);
          
          // If the current step is already complete, transition pipeline to complete
          // (this means the step finished but the pipeline status wasn't updated)
          const isStepComplete = currentStep?.status === "complete";
          
          const updatedSteps = steps.map((s) =>
            s.status === "running"
              ? { ...s, status: "complete" as const, actor: "system", completed_at: now }
              : s
          );
          
          const nextStatus = isStepComplete ? "complete" : "cancelled";
          
          await db
            .update(pipelineRuns)
            .set({
              status: nextStatus,
              steps: updatedSteps as typeof pipelineRuns.$inferInsert["steps"],
              updated_at: new Date(),
            })
            .where(eq(pipelineRuns.pipeline_id, row.pipeline_id));
          
          (isStepComplete ? completed : cancelled).push(row.pipeline_id);

          // Notify operator so the Slack stream reflects the terminal state of
          // orphaned pipelines detected on startup. Without this, the operator
          // sees no update and assumes the pipeline is still running.
          if (!isStepComplete) {
            pipelineNotifierService.notify({
              pipeline_id: row.pipeline_id,
              step: row.current_step as PipelineRole,
              status: "cancelled",
              gate_required: false,
              artifact_paths: [],
              metadata: (row.metadata as PipelineRun["metadata"]) ?? { source: "api" },
              agent_caller: "System",
              message: "Pipeline cancelled — server restarted while step was running",
            }).catch((err) => logger.error("Startup reconciliation: failed to send cancel notification", {
              pipeline_id: row.pipeline_id,
              error: String(err),
            }));
          }

          logger.info("Startup reconciliation: pipeline reconciled", {
            pipeline_id: row.pipeline_id,
            current_step: row.current_step,
            step_status: currentStep?.status,
            new_status: nextStatus,
          });
        } catch (rowErr) {
          logger.error("Startup reconciliation: failed to reconcile pipeline", {
            pipeline_id: row.pipeline_id,
            error: String(rowErr),
          });
        }
      }

      logger.info("Startup reconciliation complete", { 
        completed: completed.length,
        cancelled: cancelled.length,
        completed_pipeline_ids: completed,
        cancelled_pipeline_ids: cancelled,
      });
    } catch (err) {
      logger.error("Startup reconciliation failed", { error: String(err) });
    }
  }
}

export const pipelineService = new PipelineService();
