import type { PipelineAction, PipelineStatus } from "@/types";

export function deriveAllowedActions(status: PipelineStatus): PipelineAction[] {
  switch (status) {
    case "awaiting_approval":
      return ["approve", "cancel"];
    case "paused_takeover":
      return ["handoff", "cancel"];
    case "failed":
      return ["retry", "cancel"];
    case "running":
      return ["cancel"];
    case "complete":
    case "cancelled":
    case "awaiting_pr_review":
      return [];
    default:
      return [];
  }
}

export const ACTION_LABELS: Record<PipelineAction, string> = {
  approve: "Approve",
  cancel: "Cancel",
  retry: "Retry",
  takeover: "Take Over",
  handoff: "End Takeover",
  skip: "Skip",
};
