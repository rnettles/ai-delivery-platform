import { Request, Response, NextFunction } from "express";
import { gitSyncService } from "../services/git-sync.service";

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
