/**
 * Canonical source for the "Guard & Parse" Code node in platform/workflow/slack-ingress.json.
 *
 * n8n Code nodes cannot import external files, so this file is the tested reference
 * implementation. When changing the workflow Code node, update this file too and
 * vice-versa — the test suite covers this logic.
 */

export type SlackCommandResult =
  | { type: "challenge"; challenge: string }
  | {
      type: "create_pipeline";
      entry_point: "planner" | "sprint-controller" | "implementer" | "verifier";
      description: string;
      channel_id: string;
      user_id: string;
      user_name: string;
      response_url: string;
    }
  | {
      type: "pipeline_action";
      action: "approve" | "takeover" | "handoff" | "status";
      pipeline_id: string;
      artifact_path: string;
      channel_id: string;
      user_id: string;
      user_name: string;
      response_url: string;
    }
  | { type: "unknown"; command: string; response_url: string };

const CREATE_MAP: Record<string, "planner" | "sprint-controller" | "implementer" | "verifier"> = {
  "/plan": "planner",
  "/adp-plan": "planner",
  "/sprint": "sprint-controller",
  "/adp-sprint": "sprint-controller",
  "/implement": "implementer",
  "/adp-implement": "implementer",
  "/verify": "verifier",
  "/adp-verify": "verifier",
};

const ACTION_MAP: Record<string, "approve" | "takeover" | "handoff" | "status"> = {
  "/approve": "approve",
  "/adp-approve": "approve",
  "/takeover": "takeover",
  "/adp-takeover": "takeover",
  "/handoff": "handoff",
  "/adp-handoff": "handoff",
  "/status": "status",
  "/adp-status": "status",
};

export function parseSlackCommand(body: Record<string, unknown>): SlackCommandResult {
  // URL verification challenge
  if (body["type"] === "url_verification") {
    return { type: "challenge", challenge: String(body["challenge"] ?? "") };
  }

  const command = String(body["command"] ?? "").toLowerCase().trim();
  const rawText = String(body["text"] ?? "").trim();
  const channelId = String(body["channel_id"] ?? "");
  const userId = String(body["user_id"] ?? "");
  const userName = String(body["user_name"] ?? "");
  const responseUrl = String(body["response_url"] ?? "");

  if (CREATE_MAP[command]) {
    return {
      type: "create_pipeline",
      entry_point: CREATE_MAP[command],
      description: rawText,
      channel_id: channelId,
      user_id: userId,
      user_name: userName,
      response_url: responseUrl,
    };
  }

  if (ACTION_MAP[command]) {
    const parts = rawText.split(" ").filter(Boolean);
    const pipeline_id = parts[0] ?? "";
    const artifact_path = parts[1] ?? "";
    return {
      type: "pipeline_action",
      action: ACTION_MAP[command],
      pipeline_id,
      artifact_path,
      channel_id: channelId,
      user_id: userId,
      user_name: userName,
      response_url: responseUrl,
    };
  }

  return { type: "unknown", command, response_url: responseUrl };
}
