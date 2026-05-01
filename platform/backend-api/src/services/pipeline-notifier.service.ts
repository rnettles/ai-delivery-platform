import { PipelineNotification } from "../domain/pipeline.types";
import { slackService } from "./slack.service";

export class PipelineNotifierService {
  /**
   * Posts a pipeline notification to Slack.
   * Failures are logged but never thrown — notification is best-effort
   * and must not block pipeline state transitions.
   */
  async notify(notification: PipelineNotification): Promise<void> {
    await slackService.postNotification(notification);
  }
}

export const pipelineNotifierService = new PipelineNotifierService();
