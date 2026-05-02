import type { PipelineStepRecord, PipelineRole } from './pipeline';

export type UIStepStatus = 'running' | 'complete' | 'failed' | 'skipped' | 'pending';

export type UIStepKind =
  | 'normal'           // first or standard occurrence
  | 'retry'            // re-run after implementer's own failure (rare)
  | 'verifier-fix'     // implementer addressing a verifier failure
  | 'recheck'          // verifier re-running after a verifier-fix implementer pass
  | 'impl-closeout'    // implementer handing back after verifier passes
  | 'task-closeout'    // sprint-controller closing out a completed task
  | 'sprint-closeout'  // sprint-controller/planner handling sprint close-out
  | 'phase-closeout';  // planner handling phase close-out

export interface UIStepGroup {
  role: PipelineRole;
  iteration: number;           // 1-based index within same role
  kind: UIStepKind;
  fixCycle: number;            // which verifier-fail/fix cycle this belongs to (0 = not a fix cycle)
  status: UIStepStatus;
  record: PipelineStepRecord;  // original record for detail rendering
}

export interface UITimeline {
  groups: UIStepGroup[];
}
