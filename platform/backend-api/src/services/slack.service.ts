import { WebClient } from "@slack/web-api";
import { config } from "../config";
import { PipelineNotification } from "../domain/pipeline.types";
import { buildSlackMessage } from "../workflow-logic/pipeline-notifier.logic";
import { logger } from "./logger.service";

export class SlackService {
  private client: WebClient | null = null;

  private getClient(): WebClient | null {
    if (!config.slackBotToken) {
      return null;
    }
    if (!this.client) {
      this.client = new WebClient(config.slackBotToken);
    }
    return this.client;
  }

  /**
   * Posts a pipeline notification to Slack. Failures are logged but never thrown —
   * notification is best-effort and must not block pipeline state transitions.
   */
  async postNotification(notification: PipelineNotification): Promise<void> {
    const client = this.getClient();

    if (!client) {
      logger.info("SLACK_BOT_TOKEN not configured — skipping Slack notification", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
      });
      return;
    }

    const { channel, slack_payload } = buildSlackMessage(notification);

    if (!channel || !slack_payload) {
      logger.info("No Slack channel in notification metadata — skipping", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
      });
      return;
    }

    try {
      await client.chat.postMessage({
        channel: slack_payload.channel ?? channel,
        text: slack_payload.text,
        blocks: slack_payload.blocks as Parameters<WebClient["chat"]["postMessage"]>[0]["blocks"],
        ...(slack_payload.thread_ts ? { thread_ts: slack_payload.thread_ts } : {}),
      });

      logger.info("Slack notification sent", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
        status: notification.status,
        channel,
      });
    } catch (error) {
      logger.error("Slack notification failed", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const slackService = new SlackService();
