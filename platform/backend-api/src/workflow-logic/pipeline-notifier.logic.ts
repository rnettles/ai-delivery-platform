/**
 * Canonical source for building Slack notification messages.
 *
 * Originally the reference implementation for the "Build Slack Message" Code node in
 * platform/workflow/pipeline-notifier.json. With ADR-034, the Execution Service
 * handles Slack directly — this logic is imported by pipeline-notifier.service.ts.
 *
 * The n8n workflow file is retained as a historical artefact but no longer
 * drives production behaviour.
 */

export interface PipelineNotification {
  pipeline_id: string;
  step: string;
  status: string;
  gate_required: boolean;
  artifact_paths?: string[];
  metadata?: Record<string, unknown>;
  agent_caller?: string;
  event?: "step_start" | "progress" | "step_complete" | "gate";
  message?: string;
}

export interface SlackMessage {
  channel: string | null;
  thread_ts?: string;
  text: string;
  blocks: unknown[];
}

function stepLabel(step: string): string {
  return step.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function agentCallerLabel(step: string, agentCaller?: string): string {
  if (agentCaller) return agentCaller;

  switch (step) {
    case "planner":
      return "Planner";
    case "sprint-controller":
      return "Sprint-Controller";
    case "implementer":
      return "Implementer";
    case "verifier":
      return "Verifier";
    default:
      return stepLabel(step ?? "");
  }
}

export function buildSlackMessage(n: PipelineNotification): { channel: string | null; slack_payload?: SlackMessage } {
  const { pipeline_id, step, status, artifact_paths = [], metadata = {}, event, message, agent_caller } = n;
  const channel = (metadata["slack_channel"] as string | undefined) ?? null;
  const thread_ts = metadata["slack_thread_ts"] as string | undefined;

  if (!channel) {
    return { channel: null };
  }

  const firstArtifact = artifact_paths[0] ?? null;
  const label = agentCallerLabel(step ?? "", agent_caller);

  let text: string;
  let blocks: unknown[];

  if (event === "progress" && message) {
    // Lightweight progress update — thread message only, no buttons
    const expectedPrefix = `${label}: `;
    text = message.startsWith(expectedPrefix) ? message : `${label}: ${message}`;
    blocks = [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: text }],
      },
    ];
  } else if (status === "awaiting_approval") {
    text = `🤖 ${label} completed — ready for review`;
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🤖 *${label} completed* — Pipeline \`${pipeline_id}\` is ready for review.${firstArtifact ? `\n*Artifact:* \`${firstArtifact}\`` : ""}`,
        },
      },
      {
        type: "actions",
        block_id: `gate_${pipeline_id}`,
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ Approve → Continue" },
            style: "primary",
            action_id: "approve_pipeline",
            value: pipeline_id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "✋ Take Over" },
            action_id: "takeover_pipeline",
            value: pipeline_id,
          },
        ],
      },
    ];
  } else if (status === "failed") {
    text = `⚠️ ${label} failed — ${pipeline_id}`;
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⚠️ *${label} failed* — Pipeline \`${pipeline_id}\` needs attention.${firstArtifact ? `\n*Findings:* \`${firstArtifact}\`` : ""}${message ? `\n*Reason:* ${message}` : ""}`,
        },
      },
      ...(message ? [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Error Details:*\n\`\`\`${message}\`\`\``,
        },
      }] : []),
      {
        type: "actions",
        block_id: `fail_${pipeline_id}`,
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✋ Take Over Fix" },
            style: "primary",
            action_id: "takeover_pipeline",
            value: pipeline_id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "⏭ Skip Step" },
            style: "danger",
            action_id: "skip_pipeline",
            value: `${pipeline_id}::Auto-skip after failure`,
          },
        ],
      },
    ];
  } else if (status === "complete") {
    text = `✅ Pipeline complete — ${pipeline_id}`;
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `✅ *Pipeline complete* — \`${pipeline_id}\`${artifact_paths.length ? `\n*Artifacts:* ${artifact_paths.map((p) => `\`${p}\``).join(", ")}` : ""}`,
        },
      },
    ];
  } else if (status === "paused_takeover") {
    text = `✋ Takeover active — ${label}`;
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `✋ *Takeover active* — A human owns the *${label}* step on pipeline \`${pipeline_id}\`.\nUse \`/handoff ${pipeline_id}\` when complete.`,
        },
      },
    ];
  } else if (status === "cancelled") {
    text = `🚫 Pipeline cancelled — fixer loop limit reached — ${pipeline_id}`;
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🚫 *Pipeline cancelled* — \`${pipeline_id}\` exceeded the maximum fixer attempts and was stopped.\nUse \`/takeover ${pipeline_id}\` to take manual ownership.`,
        },
      },
    ];
  } else {
    // running — progress context message
    text = `⚙️ ${label} is running — ${pipeline_id}`;
    blocks = [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `⚙️ *${label}* is now running — Pipeline \`${pipeline_id}\`` }],
      },
    ];
  }

  const payload: SlackMessage = { channel, text, blocks };
  if (thread_ts) payload.thread_ts = thread_ts;

  return { channel, slack_payload: payload };
}
