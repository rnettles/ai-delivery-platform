import { config } from "../config";
import { PipelineNotification } from "../domain/pipeline.types";
import { buildSlackMessage } from "../workflow-logic/pipeline-notifier.logic";
import { slackService } from "./slack.service";
import { logger } from "./logger.service";

function getAgentCaller(step: PipelineNotification["step"]): string {
  return "System";
}

export class PipelineNotifierService {
  /**
   * Notifies about a pipeline state change.
   *
   * Strategy (ADR-034):
   *  1. If SLACK_BOT_TOKEN is configured → post directly to Slack
   *  2. If N8N_CALLBACK_URL is configured → forward to n8n (legacy / fallback)
   *
   * Both can be active simultaneously during a migration period.
   * Failures are logged but never thrown — notification is best-effort.
   */
  async notify(notification: PipelineNotification): Promise<void> {
    const resolvedNotification = {
      ...notification,
      agent_caller: notification.agent_caller ?? getAgentCaller(notification.step),
    };

    const notifyTasks: Promise<void>[] = [];

    if (config.slackBotToken) {
      notifyTasks.push(this.notifySlackDirect(resolvedNotification));
    }

    if (config.n8nCallbackUrl) {
      notifyTasks.push(this.notifyN8n(resolvedNotification));
    }

    if (notifyTasks.length === 0) {
      logger.info("No notification transport configured — skipping notification", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
        agent_caller: resolvedNotification.agent_caller,
      });
      return;
    }

    await Promise.all(notifyTasks);
  }

  /**
   * Posts a Slack message directly via the Slack Web API using SLACK_BOT_TOKEN.
   */
  private async notifySlackDirect(notification: PipelineNotification): Promise<void> {
    const { channel, slack_payload } = buildSlackMessage(notification as Parameters<typeof buildSlackMessage>[0]);

    if (!channel || !slack_payload) {
      logger.info("Slack notification skipped — no slack_channel in pipeline metadata", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
      });
      return;
    }

    await slackService.postMessage(slack_payload);

    logger.info("Pipeline notification sent via Slack direct", {
      pipeline_id: notification.pipeline_id,
      step: notification.step,
      agent_caller: notification.agent_caller,
      gate_required: notification.gate_required,
      status: notification.status,
      has_message: !!notification.message,
      message: notification.message,
    });
  }

  /**
   * Forwards the notification to the n8n callback webhook (legacy transport).
   * Kept for backward compatibility during migration away from n8n.
   */
  private async notifyN8n(notification: PipelineNotification): Promise<void> {
    const callbackUrl = config.n8nCallbackUrl;
    if (!callbackUrl) return;

    const base = callbackUrl.replace(/\/$/, "");
    const webhookPath = (config.n8nWebhookPath || "/webhook/pipeline-notify").trim();
    const normalizedPath = webhookPath.startsWith("/") ? webhookPath : "/" + webhookPath;
    const target = base + normalizedPath;

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notification),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.error("Pipeline notification returned non-OK status from n8n", {
          pipeline_id: notification.pipeline_id,
          step: notification.step,
          agent_caller: notification.agent_caller,
          status: response.status,
          target_url: target,
        });
      } else {
        logger.info("Pipeline notification sent via n8n", {
          pipeline_id: notification.pipeline_id,
          step: notification.step,
          agent_caller: notification.agent_caller,
          gate_required: notification.gate_required,
          status: notification.status,
          has_message: !!notification.message,
          message: notification.message,
        });
      }
    } catch (error) {
      logger.error("Pipeline notification to n8n failed", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
        agent_caller: notification.agent_caller,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const pipelineNotifierService = new PipelineNotifierService();
