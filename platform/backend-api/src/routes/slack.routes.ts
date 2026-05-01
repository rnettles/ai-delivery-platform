import { Router, Request, Response } from "express";
import express from "express";
import { slackSignatureMiddleware } from "../middleware/slack-signature.middleware";
import { parseSlackCommand } from "../workflow-logic/slack-ingress.logic";
import { parseSlackActionPayload } from "../workflow-logic/slack-action.logic";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { executeCurrentStep } from "../controllers/pipeline.controller";
import { logger } from "../services/logger.service";
import { PipelineRole } from "../domain/pipeline.types";

const router = Router();

// Both routes use express.raw() so the middleware can verify the HMAC signature
// against the raw body buffer. The handler parses URL-encoded fields manually.

router.post(
  "/slack/events",
  express.raw({ type: "*/*" }),
  slackSignatureMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const fields = Object.fromEntries(new URLSearchParams(rawBody).entries());
    const parsed = parseSlackCommand(fields);

    if (parsed.type === "challenge") {
      res.status(200).json({ challenge: parsed.challenge });
      return;
    }

    if (parsed.type === "unknown") {
      res.status(200).send("Unknown command");
      return;
    }

    if (parsed.type === "create_pipeline") {
      // Respond immediately — pipeline execution is async
      res.status(200).send(`Starting *${parsed.entry_point}* pipeline…`);

      try {
        const run = await pipelineService.create({
          entry_point: parsed.entry_point,
          execution_mode: parsed.execution_mode,
          input: { description: parsed.description },
          metadata: {
            slack_channel: parsed.channel_id,
            slack_user_id: parsed.user_id,
            slack_user_name: parsed.user_name,
            response_url: parsed.response_url,
            source: "slack",
          },
        });

        executeCurrentStep(run.pipeline_id, run.entry_point as PipelineRole, {}, undefined).catch(() => {});
      } catch (error) {
        logger.error("Slack create_pipeline dispatch failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (parsed.type === "pipeline_action") {
      // Respond immediately
      res.status(200).send(`Processing *${parsed.action}*…`);

      const { action, pipeline_id, artifact_path, user_name } = parsed;

      try {
        if (action === "approve") {
          const run = await pipelineService.approve(pipeline_id, user_name);
          if (run.status === "running" && run.current_step !== "complete") {
            executeCurrentStep(run.pipeline_id, run.current_step as PipelineRole, {}, undefined).catch(() => {});
          }
        } else if (action === "cancel") {
          await pipelineService.cancel(pipeline_id, user_name);
        } else if (action === "takeover") {
          await pipelineService.takeover(pipeline_id, user_name);
        } else if (action === "handoff") {
          const run = await pipelineService.handoff(pipeline_id, {
            actor: user_name,
            artifact_path: artifact_path || undefined,
          });
          if (run.status === "running" && run.current_step !== "complete") {
            executeCurrentStep(run.pipeline_id, run.current_step as PipelineRole, {}, undefined).catch(() => {});
          }
        } else if (action === "status") {
          // Status is informational — notification will be sent by the notifier service
          await pipelineService.get(pipeline_id);
        } else if (action === "project-register") {
          await projectService.register({
            name: parsed.project_name ?? "",
            repo_url: parsed.repo_url ?? "",
            default_branch: parsed.default_branch ?? "main",
            channel_id: parsed.channel_id,
          });
        } else if (action === "project-assign") {
          await projectService.assignToChannel(
            parsed.project_id ?? "",
            parsed.target_channel_id ?? parsed.channel_id
          );
        }
      } catch (error) {
        logger.error("Slack pipeline_action dispatch failed", {
          action,
          pipeline_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
  }
);

router.post(
  "/slack/actions",
  express.raw({ type: "*/*" }),
  slackSignatureMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    // Must respond 200 immediately — Slack expects < 3s acknowledgment
    res.status(200).send();

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const fields = Object.fromEntries(new URLSearchParams(rawBody).entries());
    const parsed = parseSlackActionPayload(fields);

    if (!parsed.valid) {
      logger.warn("Slack action payload invalid", { error: parsed.error });
      return;
    }

    const { action_id, pipeline_id, justification, actor } = parsed;

    try {
      if (action_id === "approve_pipeline") {
        const run = await pipelineService.approve(pipeline_id, actor);
        if (run.status === "running" && run.current_step !== "complete") {
          executeCurrentStep(run.pipeline_id, run.current_step as PipelineRole, {}, undefined).catch(() => {});
        }
      } else if (action_id === "takeover_pipeline") {
        await pipelineService.takeover(pipeline_id, actor);
      } else if (action_id === "skip_pipeline") {
        const run = await pipelineService.skip(pipeline_id, {
          actor,
          justification,
        });
        if (run.status === "running" && run.current_step !== "complete") {
          executeCurrentStep(run.pipeline_id, run.current_step as PipelineRole, {}, undefined).catch(() => {});
        }
      }
    } catch (error) {
      logger.error("Slack action dispatch failed", {
        action_id,
        pipeline_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

export default router;
