/**
 * Canonical source for Slack slash command parsing.
 *
 * Originally the reference implementation for the "Guard & Parse" Code node in
 * platform/workflow/slack-ingress.json. With ADR-034, the Execution Service
 * handles Slack directly — this logic is imported by slack.controller.ts.
 *
 * The n8n workflow file is retained as a historical artefact but no longer
 * drives production behaviour.
 */

/**
 * Canonical mirror of PipelineMode from pipeline.types.ts.
 * Defined inline because n8n Code nodes cannot import external modules.
 */
export type PipelineMode = "next" | "next-flow" | "full-sprint";

export type SlackCommandResult =
  | { type: "challenge"; challenge: string }
  | {
      type: "create_pipeline";
      entry_point: "planner" | "sprint-controller" | "implementer" | "verifier";
      /** Execution mode parsed from command text. Defaults to "next" when no mode keyword is given. */
      execution_mode: PipelineMode;
      description: string;
      channel_id: string;
      user_id: string;
      user_name: string;
      response_url: string;
    }
  | {
      type: "pipeline_action";
      action:
        | "approve"
        | "cancel"
        | "takeover"
        | "handoff"
        | "status"
        | "project-register"
        | "project-assign";
      pipeline_id: string;
      artifact_path: string;
      project_name?: string;
      repo_url?: string;
      default_branch?: string;
      project_id?: string;
      target_channel_id?: string;
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

const ACTION_MAP: Record<string, "approve" | "cancel" | "takeover" | "handoff" | "status"> = {
  "/approve": "approve",
  "/adp-approve": "approve",
  "/cancel": "cancel",
  "/adp-cancel": "cancel",
  "/takeover": "takeover",
  "/adp-takeover": "takeover",
  "/handoff": "handoff",
  "/adp-handoff": "handoff",
  "/status": "status",
  "/adp-status": "status",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUrlEncodedBody(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

function normalizeSlackPayload(input: Record<string, unknown>): Record<string, unknown> {
  const nestedBody = input["body"];

  if (isRecord(nestedBody)) {
    return nestedBody;
  }

  if (typeof nestedBody === "string" && nestedBody.trim()) {
    const trimmed = nestedBody.trim();

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isRecord(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to urlencoded parsing.
      }
    }

    return parseUrlEncodedBody(trimmed);
  }

  return input;
}

export function parseSlackCommand(body: Record<string, unknown>): SlackCommandResult {
  const payload = normalizeSlackPayload(body);

  // URL verification challenge
  if (payload["type"] === "url_verification") {
    return { type: "challenge", challenge: String(payload["challenge"] ?? "") };
  }

  const command = String(payload["command"] ?? "").toLowerCase().trim();
  const rawText = String(payload["text"] ?? "").trim();
  const channelId = String(payload["channel_id"] ?? "");
  const userId = String(payload["user_id"] ?? "");
  const userName = String(payload["user_name"] ?? "");
  const responseUrl = String(payload["response_url"] ?? "");

  if (command === "/project" || command === "/adp-project") {
    const parts = rawText.split(/\s+/).filter(Boolean);
    const subcommand = (parts[0] ?? "").toLowerCase();

    if (subcommand === "register") {
      const projectName = parts[1] ?? "";
      const repoUrl = parts[2] ?? "";
      const defaultBranch = parts[3] ?? "";
      return {
        type: "pipeline_action",
        action: "project-register",
        pipeline_id: "",
        artifact_path: "",
        project_name: projectName,
        repo_url: repoUrl,
        default_branch: defaultBranch,
        channel_id: channelId,
        user_id: userId,
        user_name: userName,
        response_url: responseUrl,
      };
    }

    if (subcommand === "assign") {
      const projectId = parts[1] ?? "";
      const targetChannelId = parts[2] ?? channelId;
      return {
        type: "pipeline_action",
        action: "project-assign",
        pipeline_id: "",
        artifact_path: "",
        project_id: projectId,
        target_channel_id: targetChannelId,
        channel_id: channelId,
        user_id: userId,
        user_name: userName,
        response_url: responseUrl,
      };
    }
  }

  if (CREATE_MAP[command]) {
    const parts = rawText.split(/\s+/).filter(Boolean);
    const VALID_MODES = new Set<string>(["next", "next-flow", "full-sprint"]);
    let executionMode: PipelineMode = "next";
    let description = rawText;

    if (parts.length > 0 && VALID_MODES.has(parts[0])) {
      executionMode = parts[0] as PipelineMode;
      description = parts.slice(1).join(" ");
    }

    return {
      type: "create_pipeline",
      entry_point: CREATE_MAP[command],
      execution_mode: executionMode,
      description,
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
