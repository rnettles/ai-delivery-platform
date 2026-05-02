import type { PipelineRun, PipelineStepRecord, PipelineRole } from "@/types";
import type { UIStepGroup, UIStepKind, UIStepStatus, UITimeline } from "@/types";

function toUIStepStatus(step: PipelineStepRecord): UIStepStatus {
  switch (step.status) {
    case "running":      return "running";
    case "complete":     return "complete";
    case "failed":       return "failed";
    case "not_applicable": return "skipped";
    default:             return "pending";
  }
}

/**
 * Classify a step's kind based on its immediate neighbours in the sorted list.
 *
 * Verifier fail/fix cycle:
 *  - Verifier(failed) → Implementer = 'verifier-fix' (fixing verifier-reported issues)
 *  - Implementer(verifier-fix) → Verifier = 'recheck' (re-running verification)
 *  - Cycles repeat until Verifier passes or retry max is hit
 *
 * Close-out chain:
 *  - Verifier(complete) → Implementer = 'impl-closeout'
 *  - Implementer(impl-closeout) → Sprint Controller = 'task-closeout'
 *  - Sprint Controller → Planner = 'sprint-closeout' on both
 *  - Planner(sprint-closeout) → Planner = 'phase-closeout'
 *
 *  - Anything else with iteration > 1 → 'normal'
 */
function deriveKind(
  step: PipelineStepRecord,
  prev: { step: PipelineStepRecord; kind: UIStepKind } | null,
  next: PipelineStepRecord | null,
  iteration: number,
): UIStepKind {
  if (iteration === 1) return "normal";

  if (step.role === "implementer") {
    if (prev?.step.role === "verifier" && prev.step.status === "complete") return "impl-closeout";
    if (prev?.step.role === "verifier" && prev.step.status === "failed")   return "verifier-fix";
    return "retry";
  }

  if (step.role === "verifier") {
    if (prev?.step.role === "implementer" && prev.kind === "verifier-fix") return "recheck";
    return "normal";
  }

  if (step.role === "sprint-controller") {
    if (next?.role === "planner") return "sprint-closeout";
    if (prev?.step.role === "implementer" && prev.kind === "impl-closeout") return "task-closeout";
    return "normal";
  }

  if (step.role === "planner") {
    if (prev?.step.role === "sprint-controller" && prev.kind === "sprint-closeout") return "sprint-closeout";
    if (prev?.step.role === "planner" && prev.kind === "sprint-closeout") return "phase-closeout";
    return "normal";
  }

  return "normal";
}

/** Count how many verifier-fail/fix cycles have occurred before index i. */
function countFixCycles(groups: UIStepGroup[], upToIndex: number): number {
  let cycles = 0;
  for (let i = 0; i < upToIndex; i++) {
    if (groups[i].kind === "verifier-fix") cycles++;
  }
  return cycles;
}

export function mapToUITimeline(run: PipelineRun): UITimeline {
  // Sort by actual execution order (started_at ascending).
  // Steps without a start time go to the end.
  const sorted = [...run.steps].sort((a, b) => {
    if (!a.started_at && !b.started_at) return 0;
    if (!a.started_at) return 1;
    if (!b.started_at) return -1;
    return new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
  });

  const iterationCount: Partial<Record<PipelineRole, number>> = {};
  const groups: UIStepGroup[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];
    const prev = i > 0 ? { step: sorted[i - 1], kind: groups[i - 1].kind } : null;
    const next = i < sorted.length - 1 ? sorted[i + 1] : null;

    const count = (iterationCount[step.role] ?? 0) + 1;
    iterationCount[step.role] = count;

    const kind = deriveKind(step, prev, next, count);
    // fixCycle: which fail/fix cycle this step belongs to (1-based, 0 = not in a cycle)
    const fixCycle =
      kind === "verifier-fix" || kind === "recheck"
        ? countFixCycles(groups, i) + (kind === "verifier-fix" ? 1 : 0)
        : 0;

    groups.push({
      role: step.role,
      iteration: count,
      kind,
      fixCycle,
      status: toUIStepStatus(step),
      record: step,
    });
  }

  return { groups };
}
