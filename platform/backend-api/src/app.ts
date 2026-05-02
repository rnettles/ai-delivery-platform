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
import { getLogs } from "./services/logger.service";

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

app.get("/logs", (_req, res) => {
	const limit = Math.min(Number(_req.query.limit ?? 200), 500);
	res.json(getLogs(limit));
});

app.get("/pr-gates", (_req, res) => {
	const all = getLogs(500);
	const gateEntries = all.filter((e) => e.message.includes("PR merge gate waiting"));

	// Pipelines already resolved (merged or closed) — exclude them from the gate list
	const resolvedPipelines = new Set(
		all
			.filter((e) =>
				e.message.includes("PR merge detected via poll") ||
				e.message.includes("PR is closed but not merged")
			)
			.map((e) => String(e.context.pipeline_id ?? ""))
	);

	// Deduplicate by pipeline_id — keep the latest entry per pipeline
	const byPipeline = new Map<string, typeof gateEntries[0]>();
	for (const entry of gateEntries) {
		const pid = String(entry.context.pipeline_id ?? "unknown");
		if (!resolvedPipelines.has(pid)) {
			byPipeline.set(pid, entry);
		}
	}
	// Newest first
	res.json(Array.from(byPipeline.values()).reverse());
});

app.use(apiKeyMiddleware);

app.use(executionRoutes);
app.use(coordinationRoutes);
app.use(gitSyncRoutes);
app.use(projectRoutes);
app.use(pipelineRoutes);

app.use(errorMiddleware);
