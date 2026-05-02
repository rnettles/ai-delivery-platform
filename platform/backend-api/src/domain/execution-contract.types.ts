/**
 * Execution Contract — per-task binding constraints emitted at sprint-plan time.
 *
 * Layered model (ADR-031):
 *   • Layer 0 — Execution Contract (this file): per-task data, scoped to a single task
 *   • Layer 1 — Process Invariants (governance/rules/process_invariants.md)
 *   • Layer 3 — Role mechanics (governance/prompts/*.md)
 *
 * The contract is enforced at the Implementer tool layer and revalidated by the Verifier.
 * Both consumers share `services/execution-contract-enforcer.service.ts` so detectors
 * stay in lockstep.
 */

/** Closed enum of forbidden actions. Each value maps to a deterministic detector. */
export const FORBIDDEN_ACTIONS = [
  "add_new_routes",
  "modify_api_layer",
  "introduce_new_dependencies_outside_scope",
  "rename_files",
  "move_directories",
  "refactor_unrelated_code",
] as const;
export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number];

/** Canonical script-runner reference (e.g. `npm run lint`). Avoids cross-platform shell drift. */
export interface ContractCommands {
  lint: string;
  typecheck: string;
  test: string;
}

export interface ContractScope {
  /** Glob set of paths the Implementer may write (relative to repo root). */
  allowed_paths: string[];
  /**
   * Auto-derived ancillary path globs (tests, snapshots, type barrels, generated files).
   * The Sprint Planner populates these from project conventions; the Implementer treats
   * them as additional allowed paths. Optional.
   */
  allowed_paths_extra?: string[];
  /** Closed-vocabulary actions the Implementer must not take. */
  forbidden_actions: ForbiddenAction[];
}

export interface ContractDependencies {
  /**
   * Package names the Implementer is permitted to add or upgrade.
   * Empty array = no dependency changes allowed.
   */
  allowed: string[];
  /** Canonical install command (e.g. `npm install`). */
  install_command: string;
}

export interface ContractDeterminism {
  /** Runtime artifact (migration, script) must be re-runnable safely. n/a for pure source edits. */
  idempotent_runtime: boolean | "n/a";
  /** Implementation must not introduce randomness (Math.random, randomUUID, Date.now in logic, etc.). */
  no_randomness: boolean;
  /** Implementation must not introduce external network calls. */
  no_external_calls: boolean;
}

export interface ContractSuccessCriteria {
  all_tests_pass: boolean;
  lint_pass: boolean;
  typecheck_pass: boolean;
  no_regressions: boolean;
}

export interface ExecutionContract {
  /** Schema version. Bump for breaking changes; enables legacy fallback. */
  contract_version: 1;
  task_id: string;
  sprint_id: string;
  scope: ContractScope;
  dependencies: ContractDependencies;
  commands: ContractCommands;
  determinism: ContractDeterminism;
  success_criteria: ContractSuccessCriteria;
  /** When true, Implementer must emit progress.json, test_results.json, gate_results.json before `finish`. */
  evidence_required: boolean;
  /** Artifact paths the Verifier will read to confirm the task. */
  verification_inputs: string[];
}

/** Minimum non-empty contract — used as a typing aid in default constructors. */
export type ExecutionContractInput = Omit<ExecutionContract, "contract_version"> & {
  contract_version?: 1;
};
