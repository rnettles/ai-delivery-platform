import { executeCurrentStep } from "../controllers/pipeline.controller";
import { githubApiService } from "./github-api.service";
import { logger } from "./logger.service";
import { pipelineService } from "./pipeline.service";
import { projectService } from "./project.service";

const POLL_INTERVAL_MS = 60_000;

class PrMergePollerService {
  private interval: NodeJS.Timeout | null = null;
  private isTickRunning = false;

  start(): void {
    if (this.interval) return;

    logger.info("PR merge poller started", { interval_ms: POLL_INTERVAL_MS });
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        logger.error("PR merge poll tick failed", { error: String(err) });
      });
    }, POLL_INTERVAL_MS);
    this.interval.unref();

    // Kick a first pass immediately on startup.
    this.tick().catch((err) => {
      logger.error("PR merge poll initial tick failed", { error: String(err) });
    });
  }

  private async tick(): Promise<void> {
    if (this.isTickRunning) return;
    this.isTickRunning = true;

    try {
      const runs = await pipelineService.listAwaitingPrReviewRuns();
      if (runs.length === 0) return;

      logger.info("PR merge poll tick", { awaiting_pr_review_count: runs.length });

      for (const run of runs) {
        if (!run.project_id || !run.pr_number) {
          logger.info("PR merge poll skipped run missing project/pr", {
            pipeline_id: run.pipeline_id,
            project_id: run.project_id,
            pr_number: run.pr_number,
          });
          continue;
        }

        const project = await projectService.getById(run.project_id);
        if (!project) {
          logger.info("PR merge poll skipped run missing project", {
            pipeline_id: run.pipeline_id,
            project_id: run.project_id,
          });
          continue;
        }

        const pr = await githubApiService.getPullRequest({
          repoUrl: project.repo_url,
          number: run.pr_number,
        });

        if (pr.merged) {
          const updatedRun = await pipelineService.markPrMerged(run.pipeline_id);
          logger.info("PR merge detected via poll", {
            pipeline_id: run.pipeline_id,
            pr_number: run.pr_number,
            pr_url: pr.html_url,
          });
          // full-sprint: auto-trigger Phase 2 (pr_confirmed) — pipeline returned to running.
          if (updatedRun.status === "running" && updatedRun.current_step !== "complete") {
            executeCurrentStep(updatedRun.pipeline_id, updatedRun.current_step as import("../domain/pipeline.types").PipelineRole, {}, undefined).catch((err) => {
              logger.error("Failed to trigger sprint-controller Phase 2 after PR merge", {
                pipeline_id: updatedRun.pipeline_id,
                error: String(err),
              });
            });
          }
          continue;
        }

        if (pr.state !== "open") {
          continue;
        }

        // Gate mode: sprint closes only after an explicit merge is observed.
        logger.info("PR merge gate waiting: merge the open sprint PR to advance the pipeline", {
          pipeline_id: run.pipeline_id,
          pr_number: run.pr_number,
          pr_url: pr.html_url,
          pr_state: pr.state,
          sprint_branch: run.sprint_branch,
          next_action: "Merge the PR after review/approval to allow sprint close-out.",
        });
      }
    } finally {
      this.isTickRunning = false;
    }
  }
}

export const prMergePollerService = new PrMergePollerService();
