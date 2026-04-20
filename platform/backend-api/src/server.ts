import { app } from "./app";
import { config } from "./config";
import { logger } from "./services/logger.service";
import { pipelineService } from "./services/pipeline.service";
import { projectService } from "./services/project.service";

app.listen(config.port, () => {
  logger.info("Execution service started", {
    port: config.port,
    environment: config.nodeEnv
  });

  // Cancel any pipelines that were `running` when the container last died (orphaned by restart)
  pipelineService.reconcileOrphanedRuns().catch((err) => {
    logger.error("Startup reconciliation threw unexpectedly", { error: String(err) });
  });

  // Bootstrap the default project from GIT_REPO_URL (backward compat — ADR-027)
  projectService.bootstrapDefault().catch((err) => {
    logger.error("Failed to bootstrap default project", { error: String(err) });
  });
});
