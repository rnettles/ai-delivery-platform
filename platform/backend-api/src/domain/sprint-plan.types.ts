import type { ExecutionContract } from "./execution-contract.types";

/**
 * Rich Sprint Plan domain types — emitted by the Sprint Planner LLM call and
 * consumed by the deterministic markdown renderer + Sprint Controller staging.
 *
 * The legacy `SprintLlmResponse` shape (sprint_plan + first_task + task_flags)
 * is preserved for backward-compat fallback during rollout.
 */

export type ExecutionMode = "normal" | "fast-track";

export type IncidentTier = "none" | "p0" | "p1" | "p2" | "p3";

export interface RichTaskFlags {
  fr_ids_in_scope: string[];
  architecture_contract_change: boolean;
  ui_evidence_required: boolean;
  incident_tier: IncidentTier;
  schema_change?: boolean;
  migration_change?: boolean;
  cross_subsystem_change?: boolean;
}

export interface DesignDecision {
  decision: string;
  choice: string;
  rationale: string;
}

export interface SprintOverview {
  purpose: string;
  scope: string;
}

export interface DataContract {
  name: string;
  kind: "request" | "response" | "entity" | "event" | "db_row" | "config";
  description?: string;
  json_schema: string;
}

export interface SprintInvariant {
  id: string;
  statement: string;
  testable_via: string;
}

export interface TestMatrixEntry {
  task_id: string;
  normal: string[];
  edge: string[];
  failure: string[];
  idempotency: string[];
}

export type ValidationGate = "lint" | "typecheck" | "unit" | "integration" | "contract";

export interface TaskIO {
  name: string;
  type: string;
  source?: string;
  sink?: string;
}

export type EstimatedEffort = "S" | "M" | "L";

export interface TaskSpecification {
  task_id: string;
  title: string;
  description: string;
  subsystem: string;
  fr_ids_in_scope: string[];
  inputs: TaskIO[];
  outputs: TaskIO[];
  implementation_notes: string[];
  acceptance_criteria: string[];
  estimated_effort: EstimatedEffort;
  files_likely_affected: string[];
  depends_on: string[];
  /** References into the sprint-level test_matrix entries (by task_id). */
  test_refs: string[];
  /** References into the sprint-level invariants (by id). */
  invariant_refs: string[];
  /** References into the sprint-level data_contracts (by name). */
  contract_refs: string[];
  task_flags: RichTaskFlags;
  execution_contract: ExecutionContract;
}

export interface RichSprintPlan {
  sprint_id: string;
  phase_id: string;
  name: string;
  status: "staged";
  execution_mode: ExecutionMode;
  overview: SprintOverview;
  design_decisions: DesignDecision[];
  goals: string[];
  /** Ordered list of task IDs (parallel to task_specifications[].task_id). */
  tasks: string[];
  data_contracts: DataContract[];
  invariants: SprintInvariant[];
  /** Adjacency list serialized as an array of edges. Each entry lists one task and its prerequisites. Must be acyclic and closed (refs only listed task_ids). */
  dependency_graph: Array<{ task_id: string; depends_on: string[] }>;
  test_matrix: TestMatrixEntry[];
  validation_gates: ValidationGate[];
  definition_of_done: string[];
  /** Optional fast-track lane metadata when execution_mode === "fast-track". */
  fast_track_lane?: string;
  fast_track_rationale?: string;
  fast_track_intake_id?: string;
}

export interface RichSprintLlmResponse {
  /** Schema version. Allows legacy fallback when absent. */
  plan_version: 1;
  sprint_plan: RichSprintPlan;
  task_specifications: TaskSpecification[];
  /** task_id of the first task to stage. Must exist in task_specifications[]. */
  first_task_id: string;
}

/** Discriminator helper — true for the new rich shape, false for legacy. */
export function isRichSprintLlmResponse(x: unknown): x is RichSprintLlmResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as Record<string, unknown>)["plan_version"] === 1 &&
    Array.isArray((x as Record<string, unknown>)["task_specifications"])
  );
}
