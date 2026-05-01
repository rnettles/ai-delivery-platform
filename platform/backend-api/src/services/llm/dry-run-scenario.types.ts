/**
 * Dry-run scenario types — describe how the MockLlmProvider should respond
 * for each role/call_type invocation. See dry-run-scenarios/*.json.
 */

export type DryRunOutcome = "pass" | "fail" | "throw";

export interface DryRunStepMatch {
  /** Logical role making the call (planner | sprint-controller | implementer | verifier). */
  role: string;
  /** Optional sub-call discriminator (e.g. "phase-plan", "sprint-plan", "setup"). */
  call_type?: string;
  /** 1-based occurrence within the same (role, call_type) tuple for the active pipeline. */
  occurrence?: number;
}

export interface DryRunStep {
  match: DryRunStepMatch;
  outcome?: DryRunOutcome;
  /** Optional human-readable reason — surfaced in logs and (for verifier) in the FAIL summary. */
  reason?: string;
  /**
   * Deep-merged onto the role's default fixture before returning.
   * Lets a scenario tweak any field (e.g. force a specific sprint_id, add a failed check).
   */
  fixture_overrides?: Record<string, unknown>;
  /** When outcome is "throw", the error to raise from the mock provider. */
  error?: { code?: string; message: string };
}

export interface DryRunScenario {
  name: string;
  description?: string;
  /** Outcome applied to any (role, call_type) not explicitly matched by `steps`. Defaults to "pass". */
  default_outcome?: DryRunOutcome;
  steps?: DryRunStep[];
}
