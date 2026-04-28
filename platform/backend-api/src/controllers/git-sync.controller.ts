import { Request, Response, NextFunction } from "express";
import { gitSyncService } from "../services/git-sync.service";
import { adminOpsService } from "../services/admin-ops.service";
import { CreateAdminOpsJobRequest } from "../domain/admin-ops.types";

/**
 * POST /git/sync
 *
 * Triggers an on-demand git sync (clone or pull) of the configured
 * governance repository. Returns the resulting GitSyncContext.
 * ADR-011: Execution Service is the sole owner of git operations.
 */
export async function triggerGitSync(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const context = await gitSyncService.sync();
    res.status(200).json({ ok: true, git_sync: context });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /git/status
 *
 * Returns the current GitSyncContext without triggering a sync.
 */
export function getGitStatus(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const context = gitSyncService.getContext();
    res.status(200).json({ ok: true, git_sync: context });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/ops
 *
 * Creates an asynchronous admin git/pipeline recovery job.
 */
export async function createAdminOpsJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = (req.body ?? {}) as Partial<CreateAdminOpsJobRequest>;
    const actor = typeof body.actor === "string"
      ? body.actor
      : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "operator");

    const job = await adminOpsService.createJob({
      action: body.action as CreateAdminOpsJobRequest["action"],
      actor,
      project_id: typeof body.project_id === "string" ? body.project_id : undefined,
      pipeline_id: typeof body.pipeline_id === "string" ? body.pipeline_id : undefined,
      options: body.options,
    });

    res.status(202).json({
      ok: true,
      operation: job,
      status_url: `/admin/ops/${job.job_id}`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/ops/:jobId
 *
 * Returns admin operation status and telemetry.
 */
export async function getAdminOpsJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const job = await adminOpsService.getJob(String(req.params.jobId));
    res.status(200).json({ ok: true, operation: job });
  } catch (err) {
    next(err);
  }
}
