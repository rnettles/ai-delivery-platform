import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { pipelineRuns } from "../db/schema";
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

// Ordered pipeline role sequence
const ROLE_SEQUENCE: PipelineRole[] = [
  "planner",
  "sprint-controller",
  "implementer",
  "verifier",
];

// Roles that require a human gate before advancing (ADR-030: gates removed for autonomous sprint)
const GATED_ROLES = new Set<PipelineRole>([]);

// Maximum number of Implementer attempts (initial + retries) before escalation (ADR-030)
const MAX_IMPLEMENTER_ATTEMPTS = 3;

// Roles that have a "next" in the default happy path
const NEXT_ROLE: Partial<Record<PipelineRole, PipelineRole>> = {
  planner: "sprint-controller",
  "sprint-controller": "implementer",
  implementer: "verifier",
  verifier: "sprint-controller", // close-out pass
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
    project_id: row.project_id ?? undefined,
    sprint_branch: row.sprint_branch ?? undefined,
    pr_number: row.pr_number ?? undefined,
    pr_url: row.pr_url ?? undefined,
    implementer_attempts: row.implementer_attempts ?? 0,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PipelineService {
  // ─── CREATE ───────────────────────────────────────────────────────────────

  async create(req: CreatePipelineRequest): Promise<PipelineRun> {
    const pipelineId = `pipe-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const metadata: PipelineSlackMetadata & Record<string, unknown> = {
      source: req.metadata?.source ?? "api",
      ...req.metadata,
    };

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
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    logger.info("Pipeline run created", { pipeline_id: pipelineId, entry_point: req.entry_point });

    return rowToRun(row);
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
    verificationPassed?: boolean
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
      };

      return this.save(run, {
        current_step: role,
        status: "failed",
        steps,
      });
    }

    // Determine if a gate is required
    const gateRequired = GATED_ROLES.has(role);

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
      return this.save(run, {
        current_step: role,
        status: "awaiting_approval",
        steps,
      });
    }

    // Verifier FAIL: route back to Implementer with retry context (ADR-030)
    if (role === "verifier" && verificationPassed === false) {
      const attempts = (run.implementer_attempts ?? 0) + 1;
      if (attempts >= MAX_IMPLEMENTER_ATTEMPTS) {
        logger.info("Implementer retry limit reached — cancelling pipeline", {
          pipeline_id: run.pipeline_id,
          implementer_attempts: attempts,
        });
        return this.save(run, { current_step: role, status: "cancelled", steps });
      }
      steps.push(this.newRunningStep("implementer", now));
      return this.save(run, { current_step: "implementer", status: "running", steps, implementer_attempts: attempts });
    }

    // Auto-advance
    if (nextStep === "complete") {
      return this.save(run, { current_step: "complete", status: "complete", steps });
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

    const next = nextRoleAfter(run.current_step as PipelineRole);

    if (next === "complete") {
      return this.save(run, { current_step: "complete", status: "complete", steps });
    }

    steps.push(this.newRunningStep(next, now));
    return this.save(run, { current_step: next, status: "running", steps });
  }

  // ─── TAKEOVER ─────────────────────────────────────────────────────────────

  async takeover(pipelineId: string, actor: string): Promise<PipelineRun> {
    const run = await this.get(pipelineId);
    this.assertStatus(run, ["awaiting_approval", "running"]);

    const steps = [...run.steps];
    const stepIdx = this.currentStepIdx(steps, run.current_step as PipelineRole);
    steps[stepIdx] = { ...steps[stepIdx], actor, status: "running" };

    return this.save(run, { status: "paused_takeover", steps });
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

    const next = nextRoleAfter(run.current_step as PipelineRole);

    if (next === "complete") {
      return this.save(run, { current_step: "complete", status: "complete", steps });
    }

    steps.push(this.newRunningStep(next, now));
    return this.save(run, { current_step: next, status: "running", steps });
  }

  // ─── SKIP ─────────────────────────────────────────────────────────────────

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
      return this.save(run, { current_step: "complete", status: "complete", steps });
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

  private assertStatus(run: PipelineRun, allowed: PipelineStatus[]): void {
    if (!allowed.includes(run.status)) {
      throw new HttpError(
        409,
        "INVALID_PIPELINE_STATUS",
        `Action not allowed in status '${run.status}'. Allowed: ${allowed.join(", ")}`
      );
    }
  }

  private async save(
    run: PipelineRun,
    patch: Partial<Pick<PipelineRun, "current_step" | "status" | "steps" | "sprint_branch" | "pr_number" | "pr_url" | "implementer_attempts">>
  ): Promise<PipelineRun> {
    const [row] = await db
      .update(pipelineRuns)
      .set({
        current_step: patch.current_step ?? run.current_step,
        status: patch.status ?? run.status,
        steps: (patch.steps ?? run.steps) as object[],
        ...(patch.sprint_branch !== undefined ? { sprint_branch: patch.sprint_branch } : {}),
        ...(patch.pr_number !== undefined ? { pr_number: patch.pr_number } : {}),
        ...(patch.pr_url !== undefined ? { pr_url: patch.pr_url } : {}),
        ...(patch.implementer_attempts !== undefined ? { implementer_attempts: patch.implementer_attempts } : {}),
        updated_at: new Date(),
      })
      .where(eq(pipelineRuns.pipeline_id, run.pipeline_id))
      .returning();

    logger.info("Pipeline run updated", {
      pipeline_id: run.pipeline_id,
      status: row.status,
      current_step: row.current_step,
    });

    return rowToRun(row);
  }
}

export const pipelineService = new PipelineService();
