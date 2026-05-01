import cors from "cors";
import express from "express";
import { config } from "./config";
import executionRoutes from "./routes/execution.routes";
import coordinationRoutes from "./routes/coordination.routes";
import gitSyncRoutes from "./routes/git-sync.routes";
import pipelineRoutes from "./routes/pipeline.routes";
import projectRoutes from "./routes/project.routes";
import slackRoutes from "./routes/slack.routes";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { apiKeyMiddleware } from "./middleware/api-key.middleware";
import { dryRunScenarioService } from "./services/llm/dry-run-scenario.service";

export const app = express();

app.use(requestIdMiddleware);

// Slack routes are registered before the global JSON middleware and before the
// API key middleware.  They use their own body parsers (to capture rawBody for
// signature verification) and authenticate via the Slack signing secret instead.
app.use(slackRoutes);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
	res.status(200).json({ status: "ok" });
});

app.get("/health/dry-run", (_req, res) => {
	res.status(200).json({
		dry_run: config.dryRun,
		scenario: config.dryRun ? dryRunScenarioService.snapshot() : null,
	});
});

app.use(apiKeyMiddleware);

app.use(executionRoutes);
app.use(coordinationRoutes);
app.use(gitSyncRoutes);
app.use(projectRoutes);
app.use(pipelineRoutes);

app.use(errorMiddleware);
