import { Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";
import { pipelineService } from "../services/pipeline.service";
import { adminOpsService } from "../services/admin-ops.service";
import { pipelineNotifierService } from "../services/pipeline-notifier.service";
import { executionService } from "../services/execution.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import {
  CreatePipelineRequest,
  PipelineHandoffRequest,
  PipelineRole,
  PipelineSkipRequest,
} from "../domain/pipeline.types";
import { HttpError } from "../utils/http-error";
import { config } from "../config";

function getSlackActor(req: Request): string {
  // Actor identity from Slack metadata or a fallback header
  const slackUser = req.body?.actor ?? req.headers["x-actor"] ?? "unknown";
  return String(slackUser);
}

function getCliLevelEmoji(level: string): string {
  switch (level) {
    case "ERROR":
      return "❌";
    case "WARNING":
      return "⚠️";
    default:
      return "ℹ️";
  }
}

function getRoleLabel(role: PipelineRole): string {
  switch (role) {
    case "planner":
      return "Planner";
    case "sprint-controller":
      return "Sprint-Controller";
    case "implementer":
      return "Implementer";
    case "verifier":
      return "Verifier";
    default:
      return "System";
  }
}

export async function notifyCliCommand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      status?: string;
      command?: string;
      message?: string;
      channel_id?: string;
      metadata?: Record<string, unknown>;
    };

    const status = String(body.status ?? "INFO").trim().toUpperCase();
    const normalizedStatus = status === "ERROR" || status === "WARNING" ? status : "INFO";
    const command = String(body.command ?? "unknown").trim() || "unknown";
    const rawMessage = String(body.message ?? "CLI command update").trim() || "CLI command update";

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {};

    const channel =
      (typeof body.channel_id === "string" && body.channel_id.trim()) ||
      config.cliNotificationChannel;

    if (!channel) {
      res.status(202).json({
        ok: true,
        skipped: true,
        reason: "CLI_NOTIFICATION_CHANNEL is not configured",
      });
      return;
    }

    await pipelineNotifierService.notify({
      pipeline_id: `cli-${Date.now()}`,
      step: "planner",
      status: "running",
      gate_required: false,
      artifact_paths: [],
      metadata: {
        source: "api",
        slack_channel: channel,
        notification_kind: "cli_command",
        command,
        cli_status: normalizedStatus,
        ...metadata,
      },
      event: "progress",
      message: `${getCliLevelEmoji(normalizedStatus)} ${rawMessage}`,
      agent_caller: "System",
    });

    res.status(202).json({ ok: true, notified: true, channel });
  } catch (error) {
    next(error);
  }
}

export async function createPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as Partial<CreatePipelineRequest>;

    const validRoles: PipelineRole[] = ["planner", "sprint-controller", "implementer", "verifier"];
    const entryPoint = body.entry_point;

    if (!entryPoint || !validRoles.includes(entryPoint)) {
      throw new HttpError(
        400,
        "INVALID_ENTRY_POINT",
        `entry_point must be one of: ${validRoles.join(", ")}`
      );
    }

    const run = await pipelineService.create({
      entry_point: entryPoint,
      execution_mode: body.execution_mode,
      sprint_branch: body.sprint_branch,
      input: body.input ?? {},
      metadata: body.metadata ?? {},
    });

    // Kick off execution of the first role asynchronously — do not await
    // This allows the API to return immediately with the pipeline_id
    executeCurrentStep(run.pipeline_id, run.entry_point, body.input ?? {}, req.requestId).catch(() => {
      // Errors logged inside executeCurrentStep
    });

    res.status(202).json(run);
  } catch (error) {
    next(error);
  }
}

export async function getPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const run = await pipelineService.get(pipelineId);
    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

export async function getPipelineStatusSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const summary = await pipelineService.getStatusSummary(pipelineId);
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
}

export async function getCurrentPipelineStatusSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channelId = typeof req.query.channel_id === "string" ? req.query.channel_id : undefined;
    const summary = await pipelineService.getCurrentStatusSummary(channelId);
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
}

export async function getChannelPipelineStatusList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channelId = typeof req.query.channel_id === "string" ? req.query.channel_id.trim() : "";
    if (!channelId) {
      throw new HttpError(400, "CHANNEL_ID_REQUIRED", "Query param 'channel_id' is required.");
    }

    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
    const statuses = statusParam
      ? (statusParam.split(",").map((s) => s.trim()).filter(Boolean) as import("../domain/pipeline.types").PipelineStatus[])
      : undefined;
    const result = await pipelineService.listStatusByChannel(channelId, limit, statuses);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPipelineStagedPhases(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await pipelineService.listStagedPhases(pipelineId, limit);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPipelineStagedSprints(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await pipelineService.listStagedSprints(pipelineId, limit);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPipelineStagedTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await pipelineService.listStagedTasks(pipelineId, limit);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getStagedPhases(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channelId = typeof req.query.channel_id === "string" ? req.query.channel_id : undefined;
    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await pipelineService.listRepoStagedPhases({ channelId, projectId, limit });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getStagedSprints(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channelId = typeof req.query.channel_id === "string" ? req.query.channel_id : undefined;
    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await pipelineService.listRepoStagedSprints({ channelId, projectId, limit });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getStagedTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channelId = typeof req.query.channel_id === "string" ? req.query.channel_id : undefined;
    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const result = await pipelineService.listRepoStagedTasks({ channelId, projectId, limit });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function approvePipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);
    const run = await pipelineService.approve(pipelineId, actor);

    // If advancing to a new running step, kick off execution
    if (run.status === "running" && run.current_step !== "complete") {
      const currentStep = run.current_step as PipelineRole;
      executeCurrentStep(run.pipeline_id, currentStep, {}, undefined).catch(() => {});
    }

    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

export async function cancelPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);
    const run = await pipelineService.cancel(pipelineId, actor);
    await pipelineNotifierService.notify({
      pipeline_id: run.pipeline_id,
      step: run.current_step,
      status: run.status,
      gate_required: false,
      artifact_paths: [],
      metadata: run.metadata,
      agent_caller: "System",
      message: `Pipeline cancelled by ${actor}`,
    });
    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

export async function takeoverPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);
    const run = await pipelineService.takeover(pipelineId, actor);

    await pipelineNotifierService.notify({
      pipeline_id: run.pipeline_id,
      step: run.current_step,
      status: run.status,
      gate_required: false,
      artifact_paths: [],
      metadata: run.metadata,
      agent_caller: "System",
    });

    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

export async function retryPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);
    const run = await pipelineService.retry(pipelineId, actor);

    await pipelineNotifierService.notify({
      pipeline_id: run.pipeline_id,
      step: run.current_step,
      status: run.status,
      gate_required: false,
      artifact_paths: [],
      metadata: run.metadata,
      agent_caller: "System",
    });

    // Mirror pattern from approve/handoff/skip: restart role execution
    if (run.status === "running" && run.current_step !== "complete") {
      const currentStep = run.current_step as PipelineRole;
      executeCurrentStep(run.pipeline_id, currentStep, {}, undefined).catch(() => {});
    }

    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

export async function createPipelineRetryOperation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);

    const operation = await adminOpsService.createJob({
      action: "retry",
      actor,
      pipeline_id: pipelineId,
    });

    res.status(202).json({
      ok: true,
      operation,
      status_url: `/pipeline/${pipelineId}/ops/${operation.job_id}`,
    });
  } catch (error) {
    next(error);
  }
}

export async function getPipelineOperationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const operationId = String(req.params.operationId);
    const operation = await adminOpsService.getPipelineJob(pipelineId, operationId);
    res.status(200).json({ ok: true, operation });
  } catch (error) {
    next(error);
  }
}

export async function handoffPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);
    const body = req.body as Partial<PipelineHandoffRequest>;
    const run = await pipelineService.handoff(pipelineId, {
      actor,
      artifact_path: typeof body.artifact_path === "string" ? body.artifact_path : undefined,
    });

    if (run.status === "running" && run.current_step !== "complete") {
      executeCurrentStep(run.pipeline_id, run.current_step as PipelineRole, {}, undefined).catch(() => {});
    }

    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

export async function skipPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const actor = getSlackActor(req);
    const body = req.body as Partial<PipelineSkipRequest>;

    if (typeof body.justification !== "string" || body.justification.trim().length === 0) {
      throw new HttpError(400, "JUSTIFICATION_REQUIRED", "A justification string is required to skip a step");
    }

    const run = await pipelineService.skip(pipelineId, {
      actor,
      justification: body.justification,
    });

    if (run.status === "running" && run.current_step !== "complete") {
      executeCurrentStep(run.pipeline_id, run.current_step as PipelineRole, {}, undefined).catch(() => {});
    }

    res.status(200).json(run);
  } catch (error) {
    next(error);
  }
}

// ─── INTERNAL: execute the current pipeline step via the execution service ──
// Exported so the PR-merge poller can trigger Phase 2 (pr_confirmed) automatically
// in full-sprint mode without re-entering through an HTTP route.

export async function executeCurrentStep(
  pipelineId: string,
  role: PipelineRole,
  input: Record<string, unknown>,
  requestId: string | undefined
): Promise<void> {
  const { logger } = await import("../services/logger.service");

  const callerLabel = getRoleLabel(role);

  try {
    logger.info("Pipeline step executing", { pipeline_id: pipelineId, role });

    // Fetch current pipeline state to pass completed artifact paths to the next role.
    // Roles are artifact-driven — each reads from the prior step's output.
    const currentRun = await pipelineService.get(pipelineId);

    // Git is the source of truth (ADR-001, ADR-011). Force-pull before any gate logic
    // or script reads artifacts from the clone, so approval status changes made in the
    // remote repo are visible to this execution.
    if (currentRun.project_id) {
      const project = await projectService.getById(currentRun.project_id);
      if (project) {
        logger.info("git: force-pull before role execution", { pipeline_id: pipelineId, role, project: project.name });
        await projectGitService.ensureReady(project, { forcePull: true });
      }
    }
    const previousArtifacts = currentRun.steps
      .filter((s) => s.status === "complete" || s.status === "not_applicable")
      .flatMap((s) => s.artifact_paths);

    const enrichedInput: Record<string, unknown> = {
      ...input,
      pipeline_id: pipelineId,
      previous_artifacts: previousArtifacts,
    };

    // Pass execution_mode from pipeline metadata to script input
    if (currentRun.metadata?.execution_mode) {
      enrichedInput.execution_mode = currentRun.metadata.execution_mode;
    }

    // Inject close-out phase token stored in metadata by completeStep (SC Phase 1).
    // Allows the poller to trigger Phase 2 (pr_confirmed) without knowing the phase name directly.
    if (currentRun.metadata?.pending_close_out_phase) {
      enrichedInput.close_out_phase = currentRun.metadata.pending_close_out_phase;
    }

    // Build a notify function that fires progress messages to Slack — best-effort, never throws.
    const notifyProgress = (message: string): void => {
      pipelineNotifierService.notify({
        pipeline_id: pipelineId,
        step: role,
        status: "running",
        gate_required: false,
        artifact_paths: [],
        metadata: currentRun.metadata,
        event: "progress",
        message: `${callerLabel}: ${message}`,
        agent_caller: callerLabel,
      }).catch(() => { /* best-effort */ });
    };

    const result = await executionService.execute(
      {
        correlation_id: pipelineId,
        target: { type: "role", name: role, version: "2026.04.19" },
        input: enrichedInput,
        metadata: { pipeline_id: pipelineId },
      },
      requestId,
      undefined,
      notifyProgress
    );

    const artifactPaths: string[] = [];
    let verificationPassed: boolean | undefined;
    if (result.output && typeof result.output === "object") {
      const out = result.output as Record<string, unknown>;

      // Collect artifact paths from common output keys:
      // - artifact_path
      // - any string field ending with _path
      // - any string[] field ending with _paths
      for (const [key, value] of Object.entries(out)) {
        if (key === "artifact_path" && typeof value === "string") {
          artifactPaths.push(value);
          continue;
        }
        if (key.endsWith("_path") && typeof value === "string") {
          artifactPaths.push(value);
          continue;
        }
        if (key.endsWith("_paths") && Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") {
              artifactPaths.push(item);
            }
          }
        }
      }

      if (role === "verifier" && "passed" in out) {
        verificationPassed = Boolean(out.passed);
      }
    }

    const run = await pipelineService.completeStep(
      pipelineId,
      role,
      result.execution_id,
      artifactPaths,
      !result.ok,
      verificationPassed,
      !result.ok && result.errors?.length ? result.errors[0].message : undefined
    );

    // Skip notification on terminal complete — pipeline is done, no actionable gate event.
    // Avoids 404 from n8n when webhook is no longer listening (test-mode one-shot exhausted).
    if (run.current_step !== "complete") {
      const failureMessage = !result.ok && result.errors?.length
        ? result.errors[0].message
        : undefined;
      await pipelineNotifierService.notify({
        pipeline_id: pipelineId,
        step: run.current_step,
        status: run.status,
        gate_required: run.status === "awaiting_approval",
        artifact_paths: artifactPaths,
        metadata: run.metadata,
        agent_caller: callerLabel,
        message: failureMessage,
      });
    }

      // Autonomous chaining (ADR-030): if the pipeline is still running and no human
      // gate is required, immediately kick off the next role without waiting.
      if (run.status === "running" && run.current_step !== "complete") {
        const nextRole = run.current_step as PipelineRole;
        executeCurrentStep(pipelineId, nextRole, {}, requestId).catch(() => {});
      }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Pipeline step execution failed", {
      pipeline_id: pipelineId,
      role,
      error: errorMessage,
    });

    // Attempt to mark step as failed in the pipeline
    try {
      const run = await pipelineService.completeStep(pipelineId, role, "failed", [], true, undefined, errorMessage);
      await pipelineNotifierService.notify({
        pipeline_id: pipelineId,
        step: run.current_step,
        status: "failed",
        gate_required: false,
        artifact_paths: [],
        metadata: run.metadata,
        agent_caller: callerLabel,
        message: errorMessage,
      });
    } catch {
      // If this also fails, the pipeline is in an inconsistent state — log only
      logger.error("Failed to mark pipeline step as failed", { pipeline_id: pipelineId, role });
    }
  }
}

export async function getPipelineArtifact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pipelineId = String(req.params.pipelineId);
    const artifactPath = String(req.query.path ?? "");

    if (!artifactPath) {
      throw new HttpError(400, "ARTIFACT_PATH_REQUIRED", "Query param 'path' is required");
    }

    // Resolve and validate the path stays within the artifact base directory
    const base = path.resolve(config.artifactBasePath);
    const resolved = path.resolve(base, artifactPath);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new HttpError(400, "INVALID_ARTIFACT_PATH", "Artifact path must be within the artifact base directory");
    }

    // Verify the artifact belongs to this pipeline
    const pipelinePrefix = path.join("artifacts", pipelineId);
    if (!artifactPath.startsWith(pipelinePrefix)) {
      throw new HttpError(403, "ARTIFACT_PIPELINE_MISMATCH", "Artifact does not belong to the specified pipeline");
    }

    if (!fs.existsSync(resolved)) {
      throw new HttpError(404, "ARTIFACT_NOT_FOUND", `Artifact not found: ${artifactPath}`);
    }

    const content = fs.readFileSync(resolved, "utf-8");
    const ext = path.extname(resolved).toLowerCase();

    if (ext === ".json") {
      res.status(200).json(JSON.parse(content));
    } else {
      res.status(200).type("text/plain").send(content);
    }
  } catch (error) {
    next(error);
  }
}
