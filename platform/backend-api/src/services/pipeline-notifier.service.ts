import { config } from "../config";
import { PipelineNotification } from "../domain/pipeline.types";
import { logger } from "./logger.service";

function getAgentCaller(step: PipelineNotification["step"]): string {
  return "System";
}

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
        agent_caller: notification.agent_caller ?? getAgentCaller(notification.step),
      });
      return;
    }

    const base = callbackUrl.replace(/\/$/, "");
    const webhookPath = (config.n8nWebhookPath || "/webhook/pipeline-notify").trim();
    const normalizedPath = webhookPath.startsWith("/") ? webhookPath : "/" + webhookPath;
    const target = base + normalizedPath;
    const payload = {
      ...notification,
      agent_caller: notification.agent_caller ?? getAgentCaller(notification.step),
    };

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.error("Pipeline notification returned non-OK status", {
          pipeline_id: notification.pipeline_id,
          step: notification.step,
          agent_caller: payload.agent_caller,
          status: response.status,
          target_url: target,
        });
      } else {
        logger.info("Pipeline notification sent", {
          pipeline_id: notification.pipeline_id,
          step: notification.step,
          agent_caller: payload.agent_caller,
          gate_required: notification.gate_required,
          status: notification.status,
          has_message: !!notification.message,
          message: notification.message,
        });
      }
    } catch (error) {
      logger.error("Pipeline notification failed", {
        pipeline_id: notification.pipeline_id,
        step: notification.step,
        agent_caller: payload.agent_caller,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const pipelineNotifierService = new PipelineNotifierService();
