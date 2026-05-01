import { config } from "../config";
import { SlackMessage } from "../workflow-logic/pipeline-notifier.logic";
import { logger } from "./logger.service";

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/**
 * Thin wrapper around the Slack Web API for posting messages.
 *
 * Requires SLACK_BOT_TOKEN (xoxb-...) to be configured.
 * All failures are logged but never thrown — notification is best-effort.
 */
export class SlackService {
  /**
   * Posts a message to Slack via chat.postMessage.
   * No-ops when SLACK_BOT_TOKEN is not configured.
   */
  async postMessage(message: SlackMessage): Promise<void> {
    const token = config.slackBotToken;

    if (!token) {
      logger.info("SLACK_BOT_TOKEN not configured — skipping Slack message", {
        channel: message.channel,
      });
      return;
    }

    if (!message.channel) {
      logger.info("Slack message has no channel — skipping", {});
      return;
    }

    try {
      const response = await fetch(SLACK_POST_MESSAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        ts?: string;
      };

      if (!response.ok || !body.ok) {
        logger.error("Slack postMessage returned error", {
          channel: message.channel,
          http_status: response.status,
          slack_error: body.error ?? "unknown",
        });
      } else {
        logger.info("Slack message posted", {
          channel: message.channel,
          thread_ts: message.thread_ts,
          ts: body.ts,
        });
      }
    } catch (error) {
      logger.error("Slack postMessage failed", {
        channel: message.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Posts a plain text acknowledgement to a Slack response_url.
   * Used to immediately acknowledge slash commands.
   */
  async ack(responseUrl: string, text: string, inChannel = false): Promise<void> {
    if (!responseUrl) return;

    try {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: inChannel ? "in_channel" : "ephemeral",
          text,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      logger.error("Slack ack failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const slackService = new SlackService();
