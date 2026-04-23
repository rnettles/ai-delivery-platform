import { config } from "../config";
import { PipelineNotification } from "../domain/pipeline.types";
import { logger } from "./logger.service";

export class PipelineNotifierService {
  /**
   * Posts a pipeline notification to the configured N8N_CALLBACK_URL.
   * Failures are logged but never thrown — notification is best-effort
   * and must not block pipeline state transitions.
   */
  async notify(notification: PipelineNotification): Promise<void> {
    const callbackUrl = config.n8nCallbackUrl;

    if (!callbackUrl) {
      logger.info("N8N_CALLBACK_URL not configured — skipping notification", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
      });
      return;
    }

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
        logger.error("Pipeline notification returned non-OK status", {
          pipeline_id: notification.pipeline_id,
          step: notification.step,
          status: response.status,
        });
      } else {
        logger.info("Pipeline notification sent", {
          pipeline_id: notification.pipeline_id,
          step: notification.step,
          gate_required: notification.gate_required,
        });
      }
    } catch (error) {
      logger.error("Pipeline notification failed", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const pipelineNotifierService = new PipelineNotifierService();
