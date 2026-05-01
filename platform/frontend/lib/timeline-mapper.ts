import type { PipelineRun, PipelineStepRecord, PipelineRole } from "@/types";
import type { UIStepGroup, UIStepStatus, UITimeline } from "@/types";

const ROLE_ORDER: PipelineRole[] = [
  "planner",
  "sprint-controller",
  "implementer",
  "verifier",
];

function toUIStepStatus(step: PipelineStepRecord): UIStepStatus {
  switch (step.status) {
    case "running":      return "running";
    case "complete":     return "complete";
    case "failed":       return "failed";
    case "not_applicable": return "skipped";
    default:             return "pending";
  }
}

export function mapToUITimeline(run: PipelineRun): UITimeline {
  // Sort steps by role order, preserving original order within the same role
  const sorted = [...run.steps].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role);
    const bi = ROLE_ORDER.indexOf(b.role);
    if (ai !== bi) return ai - bi;
    return run.steps.indexOf(a) - run.steps.indexOf(b);
  });

  // Build groups: each step record becomes its own UIStepGroup entry.
  // Multiple records with the same role get ascending iteration numbers.
  const iterationCount: Partial<Record<PipelineRole, number>> = {};

  const groups: UIStepGroup[] = sorted.map((step) => {
    const count = (iterationCount[step.role] ?? 0) + 1;
    iterationCount[step.role] = count;

    return {
      role: step.role,
      iteration: count,
      status: toUIStepStatus(step),
      record: step,
    };
  });

  return { groups };
}
