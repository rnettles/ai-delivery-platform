/**
 * Canonical source for Slack interactive action payload parsing.
 *
 * Originally the reference implementation for the "Parse Slack Payload" Code node in
 * platform/workflow/slack-action-handler.json. With ADR-034, the Execution Service
 * handles Slack directly — this logic is imported by slack.controller.ts.
 *
 * The n8n workflow file is retained as a historical artefact but no longer
 * drives production behaviour.
 */

export type ParsedAction =
  | { valid: false; error: string }
  | {
      valid: true;
      action_id: "approve_pipeline" | "takeover_pipeline" | "skip_pipeline";
      pipeline_id: string;
      justification: string;
      actor: string;
      channel_id: string;
      message_ts: string;
      response_url: string;
    };

export function parseSlackActionPayload(raw: Record<string, unknown>): ParsedAction {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(raw["payload"] ?? "{}")) as Record<string, unknown>;
  } catch {
    return { valid: false, error: "Invalid payload JSON" };
  }

  const actions = payload["actions"];
  if (payload["type"] !== "block_actions" || !Array.isArray(actions) || actions.length === 0) {
    return { valid: false, error: "Not a block_actions event" };
  }

  const action = actions[0] as Record<string, unknown>;
  const actionId = String(action["action_id"] ?? "");
  const value = String(action["value"] ?? "");

  const user = (payload["user"] ?? {}) as Record<string, unknown>;
  const userId = String(user["id"] ?? "");
  const userName = String(user["username"] ?? user["name"] ?? userId);
  const channel = (payload["channel"] ?? {}) as Record<string, unknown>;
  const channelId = String(channel["id"] ?? "");
  const message = (payload["message"] ?? {}) as Record<string, unknown>;
  const messageTs = String(message["ts"] ?? "");
  const responseUrl = String(payload["response_url"] ?? "");

  // value format: '<pipeline_id>' or '<pipeline_id>::<justification>'
  const [pipelineId, ...justParts] = value.split("::");
  const justification = justParts.join("::") || "Actioned via Slack button";

  return {
    valid: true,
    action_id: actionId as "approve_pipeline" | "takeover_pipeline" | "skip_pipeline",
    pipeline_id: pipelineId,
    justification,
    actor: userName,
    channel_id: channelId,
    message_ts: messageTs,
    response_url: responseUrl,
  };
}
