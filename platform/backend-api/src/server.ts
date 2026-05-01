import { app } from "./app";
import { config } from "./config";
import { logger } from "./services/logger.service";
import { pipelineService } from "./services/pipeline.service";
import { adminOpsService } from "./services/admin-ops.service";
import { pipelineNotifierService } from "./services/pipeline-notifier.service";
import { prMergePollerService } from "./services/pr-merge-poller.service";
import { projectService } from "./services/project.service";
import { artifactService } from "./services/artifact.service";
import { dryRunScenarioService } from "./services/llm/dry-run-scenario.service";

if (config.dryRun) {
  dryRunScenarioService.load(config.dryRunScenarioPath || undefined);
  const snap = dryRunScenarioService.snapshot();
  logger.warn("┌─────────────────────────────────────────────────────────────┐");
  logger.warn("│ DRY-RUN MODE ACTIVE — all LLM calls routed to MockProvider │");
  logger.warn("│ Real git, GitHub, Slack, DB, and artifact-FS remain LIVE.  │");
  logger.warn("└─────────────────────────────────────────────────────────────┘");
  logger.warn("Dry-run scenario", { name: snap.name, default_outcome: snap.default_outcome });

  // Sandbox repo guard: block boot when GIT_REPO_URL doesn't match the allowlist
  // regex. Skip when no allowlist is configured (operator opt-in).
  if (config.dryRunRepoAllowlist && config.gitRepoUrl) {
    try {
      const re = new RegExp(config.dryRunRepoAllowlist);
      if (!re.test(config.gitRepoUrl)) {
        logger.error("Dry-run repo allowlist rejected GIT_REPO_URL — refusing to start", {
          git_repo_url: config.gitRepoUrl,
          allowlist: config.dryRunRepoAllowlist,
        });
        process.exit(1);
      }
    } catch (err) {
      logger.error("Dry-run repo allowlist regex invalid — refusing to start", {
        allowlist: config.dryRunRepoAllowlist,
        error: String(err),
      });
      process.exit(1);
    }
  }
}


app.listen(config.port, () => {
  logger.info("Execution service started", {
    port: config.port,
    environment: config.nodeEnv
  });

  // Best-effort startup notification so webhook wiring can be validated at boot.
  pipelineNotifierService
    .notify({
      pipeline_id: `server-startup-${Date.now()}`,
      step: "planner",
      status: "running",
      gate_required: false,
      artifact_paths: [],
      metadata: {
        source: "api",
        event: "server_startup",
        environment: config.nodeEnv,
        ...(config.cliNotificationChannel ? { slack_channel: config.cliNotificationChannel } : {}),
      },
      event: "progress",
      message: `Execution service started on port ${config.port}`,
      agent_caller: "System",
    })
    .catch((err) => {
      logger.error("Startup notification failed", { error: String(err) });
    });

  // Cancel any pipelines that were `running` when the container last died (orphaned by restart)
  pipelineService.reconcileOrphanedRuns().catch((err) => {
    logger.error("Startup reconciliation threw unexpectedly", { error: String(err) });
  });

  // Reschedule any admin-ops jobs that were queued/running when the server last died.
  adminOpsService.recoverOrphanedJobs().catch((err) => {
    logger.error("Startup reconciliation threw unexpectedly", { error: String(err) });
  });

  // Bootstrap the default project from GIT_REPO_URL (backward compat — ADR-027)
  projectService.bootstrapDefault().catch((err) => {
    logger.error("Failed to bootstrap default project", { error: String(err) });
  });

  // Poll PR merge state every 60s until webhook integration is wired.
  prMergePollerService.start();

  // Sweep stale artifact directories every 6 hours.
  // Removes dirs for failed/cancelled pipelines older than ARTIFACT_RETENTION_DAYS, and orphans.
  const GC_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const runArtifactGc = () => {
    artifactService
      .cleanupStale((pipelineId) => pipelineService.isTerminalFailureOrOrphan(pipelineId))
      .catch((err) => {
        logger.error("Artifact GC sweep failed", { error: String(err) });
      });
  };
  runArtifactGc(); // run once at startup to clear any backlog
  setInterval(runArtifactGc, GC_INTERVAL_MS);
});
