import { app } from "./app";
import { config } from "./config";
import { logger } from "./services/logger.service";
import { pipelineService } from "./services/pipeline.service";
import { pipelineNotifierService } from "./services/pipeline-notifier.service";
import { prMergePollerService } from "./services/pr-merge-poller.service";
import { projectService } from "./services/project.service";

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
        ...(config.startupSlackChannel ? { slack_channel: config.startupSlackChannel } : {}),
      },
      event: "progress",
      message: `Execution service started on port ${config.port}`,
    })
    .catch((err) => {
      logger.error("Startup notification failed", { error: String(err) });
    });

  // Cancel any pipelines that were `running` when the container last died (orphaned by restart)
  pipelineService.reconcileOrphanedRuns().catch((err) => {
    logger.error("Startup reconciliation threw unexpectedly", { error: String(err) });
  });

  // Bootstrap the default project from GIT_REPO_URL (backward compat — ADR-027)
  projectService.bootstrapDefault().catch((err) => {
    logger.error("Failed to bootstrap default project", { error: String(err) });
  });

  // Poll PR merge state every 60s until webhook integration is wired.
  prMergePollerService.start();
});
