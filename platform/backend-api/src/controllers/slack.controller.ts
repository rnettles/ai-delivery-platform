import { NextFunction, Request, Response } from "express";
import { parseSlackActionPayload } from "../workflow-logic/slack-action.logic";
import { parseSlackCommand } from "../workflow-logic/slack-ingress.logic";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { slackService } from "../services/slack.service";
import { logger } from "../services/logger.service";
import { PipelineRole } from "../domain/pipeline.types";

/**
 * Parses the raw request body based on Content-Type.
 *
 * Slack sends:
 *  - application/json      → Event API callbacks
 *  - application/x-www-form-urlencoded → Slash commands and interactive actions
 */
function parseSlackBody(req: Request): Record<string, unknown> {
  const raw = req.rawBody instanceof Buffer ? req.rawBody.toString("utf-8") : "";
  const contentType = (req.header("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries()) as Record<string, unknown>;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * POST /slack/events
 *
 * Handles Slack Event API callbacks and slash commands:
 *  - URL verification challenge  → responds immediately
 *  - Create pipeline commands (/plan, /sprint, /implement, /verify)
 *  - Pipeline action commands (/approve, /cancel, /takeover, /handoff, /status)
 *  - Project management (/project register, /project assign)
 */
export async function handleSlackEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseSlackBody(req);
    const result = parseSlackCommand(body);

    switch (result.type) {
      case "challenge": {
        // Slack URL verification — must respond synchronously with the challenge value
        res.status(200).json({ challenge: result.challenge });
        return;
      }

      case "create_pipeline": {
        // Respond to Slack immediately (< 3s requirement), then create the pipeline async
        res.status(200).json({});

        const { entry_point, execution_mode, description, channel_id, user_id, user_name, response_url } = result;

        // Post an acknowledgement to the Slack thread via response_url
        slackService.ack(response_url, `⏳ Starting pipeline run...`, true).catch(() => {});

        try {
          const run = await pipelineService.create({
            entry_point: entry_point as PipelineRole,
            execution_mode,
            input: { description },
            metadata: {
              source: "slack",
              slack_channel: channel_id,
              slack_user: user_id,
              slack_user_name: user_name,
            },
          });

          logger.info("Pipeline created via Slack slash command", {
            pipeline_id: run.pipeline_id,
            entry_point,
            channel_id,
            user_id,
          });
        } catch (error) {
          logger.error("Failed to create pipeline from Slack command", {
            entry_point,
            channel_id,
            error: error instanceof Error ? error.message : String(error),
          });
          slackService
            .ack(response_url, `❌ Failed to start pipeline run. Please try again.`, true)
            .catch(() => {});
        }
        return;
      }

      case "pipeline_action": {
        const { action, pipeline_id, channel_id, user_id, user_name, response_url } = result;

        if (action === "status") {
          // Status is a read-only query — respond synchronously
          try {
            const result = await pipelineService.getCurrentStatusSummary(channel_id || undefined);
            let status: string;
            if (result.kind === "single") {
              const run = result.run;
              status = `📋 Pipeline \`${run.pipeline_id}\` — *${run.status}* (step: ${run.current_step})`;
            } else if (result.kind === "multiple") {
              const lines = result.runs.map((r) => `• \`${r.pipeline_id}\` — ${r.status}`);
              status = `📋 Active pipelines:\n${lines.join("\n")}`;
            } else {
              status = "ℹ️ No active pipeline found for this channel.";
            }
            res.status(200).json({ response_type: "in_channel", text: status });
          } catch (error) {
            logger.error("Status lookup failed", { channel_id, error: String(error) });
            res.status(200).json({ response_type: "ephemeral", text: "❌ Could not retrieve pipeline status." });
          }
          return;
        }

        if (action === "project-register") {
          res.status(200).json({});
          const { project_name, repo_url, default_branch } = result;
          try {
            const project = await projectService.create({
              name: project_name ?? "",
              repoUrl: repo_url ?? "",
              defaultBranch: default_branch || "main",
            });
            slackService
              .ack(response_url, `✅ Project \`${project.name}\` registered (id: \`${project.project_id}\`)`, true)
              .catch(() => {});
          } catch (error) {
            slackService
              .ack(response_url, `❌ Failed to register project: ${error instanceof Error ? error.message : String(error)}`, true)
              .catch(() => {});
          }
          return;
        }

        if (action === "project-assign") {
          res.status(200).json({});
          const { project_id, target_channel_id } = result;
          try {
            await projectService.registerChannel(target_channel_id ?? channel_id, project_id ?? "");
            slackService
              .ack(response_url, `✅ Project \`${project_id}\` assigned to channel \`${target_channel_id ?? channel_id}\``, true)
              .catch(() => {});
          } catch (error) {
            slackService
              .ack(response_url, `❌ Failed to assign project: ${error instanceof Error ? error.message : String(error)}`, true)
              .catch(() => {});
          }
          return;
        }

        // Actions that mutate pipeline state — respond to Slack immediately
        res.status(200).json({});

        try {
          let run;
          const actor = user_name || user_id;

          if (action === "approve") {
            run = await pipelineService.approve(pipeline_id, actor);
          } else if (action === "cancel") {
            run = await pipelineService.cancel(pipeline_id, actor);
          } else if (action === "takeover") {
            run = await pipelineService.takeover(pipeline_id, actor);
          } else if (action === "handoff") {
            run = await pipelineService.handoff(pipeline_id, {
              actor,
              artifact_path: result.artifact_path || undefined,
            });
          }

          if (run) {
            slackService
              .ack(response_url, `✅ Action \`${action}\` applied to pipeline \`${pipeline_id}\``, true)
              .catch(() => {});
          }
        } catch (error) {
          logger.error("Pipeline action from Slack failed", {
            action,
            pipeline_id,
            actor: user_name || user_id,
            error: error instanceof Error ? error.message : String(error),
          });
          slackService
            .ack(response_url, `❌ Action \`${action}\` failed: ${error instanceof Error ? error.message : String(error)}`, true)
            .catch(() => {});
        }
        return;
      }

      default: {
        res.status(200).json({ response_type: "ephemeral", text: "❓ Unknown command. Use `/plan`, `/sprint`, `/implement`, or `/verify` to start a pipeline run." });
      }
    }
  } catch (error) {
    next(error);
  }
}

/**
 * POST /slack/actions
 *
 * Handles Slack interactive component payloads (button clicks from gate messages).
 * Slack requires a 200 response within 3 seconds — the action is executed async.
 */
export async function handleSlackActions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseSlackBody(req);
    const parsed = parseSlackActionPayload(body);

    if (!parsed.valid) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    // Respond immediately — Slack requires < 3s
    res.status(200).json({});

    const { action_id, pipeline_id, justification, actor, response_url } = parsed;

    try {
      if (action_id === "approve_pipeline") {
        await pipelineService.approve(pipeline_id, actor);
        slackService.ack(response_url, `✅ Approved by *${actor}* — pipeline continuing...`, true).catch(() => {});
      } else if (action_id === "takeover_pipeline") {
        await pipelineService.takeover(pipeline_id, actor);
        slackService
          .ack(response_url, `✋ *${actor}* has taken over. Use \`/handoff ${pipeline_id}\` when done.`, true)
          .catch(() => {});
      } else if (action_id === "skip_pipeline") {
        await pipelineService.skip(pipeline_id, { actor, justification });
        slackService.ack(response_url, `⏭ Step skipped by *${actor}* — pipeline continuing...`, true).catch(() => {});
      }
    } catch (error) {
      logger.error("Slack action handler failed", {
        action_id,
        pipeline_id,
        actor,
        error: error instanceof Error ? error.message : String(error),
      });
      slackService
        .ack(response_url, `❌ Action failed: ${error instanceof Error ? error.message : String(error)}`, true)
        .catch(() => {});
    }
  } catch (error) {
    next(error);
  }
}
