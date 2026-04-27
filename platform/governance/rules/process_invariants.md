# Process Invariants

> **Layer 1 — Canonical source: `ai-project_template/ai_dev_stack/ai_guidance/AI_RULES.md`**
>
> This file is a platform-context distillation of Layer 1 invariants (ADR-031).
> It applies to ALL execution modes: human-driven (VSCode chat) and platform-driven (Execution Service).
> These rules MUST NOT be overridden or relaxed by any Layer 3 governance file.
> If this file diverges from `AI_RULES.md` invariant sections, that divergence is a governance defect.

---

## Role Boundaries

- **Planner** determines WHAT to build and closes lifecycle stages. It performs heavy design work, defines phase scope/objectives/FR coverage, creates phase plans, creates sprint plans, and closes sprints/phases from gate artifacts. It never writes code.
- **Sprint Controller** determines HOW sprint tasks are packaged for execution. It prepares implementation instructions, selects the next incomplete sprint task, verifies/decomposes task size, stages active task artifacts, and performs task closeout. It does not derive sprint plans from phase scope and does not perform final sprint closure.
- **Implementer** writes code and tests. Does not plan, stage sprints, or verify.
- **Verifier** evaluates implementation against acceptance criteria. Does not implement or fix.
- **Fixer** corrects specific listed failures from the Verifier. Does not plan or expand scope.
- **Documenter** syncs documentation to delivered sprint behavior. Does not implement code.
- **PASS closeout invariant:** Verifier PASS routes to Sprint Controller for task closeout decisions. Sprint Controller emits sprint-complete artifacts from the last completed task context. Planner consumes those passing gate artifacts to make the final sprint close decision.
- No role may perform the work of another role.
- No role may expand scope beyond the current assigned task.

---

## Phase Lifecycle Gates

- Do not create a new phase if any existing phase has status `Draft`, `Planning`, or `Active`.
  The operator must close or explicitly supersede the open phase before staging a new one.
- Do not begin sprint staging from a phase in `Draft` status. Phase must be in `Planning`.
- Do not mark a phase `Complete` unless all checklist items are verified and exit criteria are met.
- Do not expand phase scope mid-sprint without an accepted intake item.
- Every sprint task must trace to a phase checklist item or an accepted intake item.
- Phase lifecycle: `Draft` → `Planning` → `Active` → `Complete`.

**Planner input requirements:**
- Planner must only plan FRs that are explicitly listed in the "Already Claimed FR IDs" section
  of the user message. Only identifiers that appear in that section are considered claimed.
  IMPORTANT: "Phase 1", "Phase 2", or similar phase labels that appear inside FR acceptance
  criteria or requirement descriptions are implementation scoping notes — they are NOT delivery
  pipeline phase plans and do NOT make those FRs already claimed.
- If all known FRs are explicitly listed as already claimed in the provided message, the Planner
  must stop and report that there are no pending FRs — do not create an empty or redundant phase.
- Every phase plan must include a non-empty `fr_ids_in_scope` field referencing actual FR
  identifiers from the project's FR/PRD documents. Phase plans without FR traceability are invalid.
- Planner must evaluate all loaded ADRs for compliance and congruency before producing a phase plan.
  Any conflict with an Accepted ADR must be flagged in `required_design_artifacts` (type ADR,
  status Required) — do not silently ignore ADR conflicts.
- Planner must consider all related TDNs during phase design. Any TDN required before
  implementation can begin must be listed in `required_design_artifacts` (type TDN, status Required).

---

## Sprint Lifecycle Gates

- Do not stage a new sprint if any existing sprint has status `staged`, `Planning`, `Active`, or `ready_for_verification`.
  The operator must close the open sprint before staging a new one.
- Verifier PASS must route to Sprint Controller for task closeout before any sprint-close decision.
- Planner closes the sprint only after PASS gate artifacts are available (`verification_result.json` + Sprint Controller `sprint_closeout.json`).
- Sprint Controller task closeout must emit artifact evidence from the last completed task context before Planner sprint closure.

---

## Implementation Limits

**Standard sprint mode (default):**
- Modify no more than 7 files per task step.
- Keep changes under ~400 lines of code per task step.

**Fast Track sprint mode (operator-requested only):**
- Expanded envelope: up to 12 files and ~1,200 lines per step.
- Maximum ceiling: never exceed 15 files or ~1,500 lines per step.
- Activation requires explicit operator direction recorded in both the sprint plan and `next_steps.md`.

> **Note:** Platform Layer 3 governance may enforce tighter limits (e.g., ≤5 files, ≤200 lines)
> as a platform-specific additive constraint. Layer 3 tightening is permitted; relaxing is not.

---

## Safety Rules

- Never delete files unless explicitly instructed by the operator.
- Never modify database migrations unless required by the current task.
- Never push directly to the `main` or `master` branch. All changes go through feature branches and pull requests.
- Never refactor unrelated modules.
- Do not implement future sprint tasks.
- A fixer must not exceed 3 repair attempts on a single task. After 3 consecutive FAIL verdicts,
  stop and escalate to the operator with a failure-pattern summary. Do not attempt further repair without explicit direction.

---

## Design Artifact Rules

- Do not implement behavior that contradicts an `Accepted` ADR. Flag the conflict to the operator instead.
- Do not invent component interfaces, field schemas, or algorithm designs not specified in an approved TDN or architecture doc. Flag the gap instead.
- Do not delete or overwrite an ADR. Mark it `Deprecated` or `Superseded` and create a new one.
- Do not stage the first sprint of a phase that requires a TDN until that TDN has `Status: Approved`.
- Do not produce working code as the output of a Spike. Spikes produce written findings only.
- AI agents may draft ADRs (`Status: Proposed`) and TDNs (`Status: Draft`). These are not binding until human-approved.

---

## Human-AI Authority Boundary

- AI agents may create or edit requirements and design artifacts in Draft/Proposed state only.
- Only the human operator may set `Status: Approved` (FRDs, TDNs) or `Status: Accepted` (ADRs).
- Only the human operator may set intake status to `accepted`.
- The Planner must not produce a phase plan if no FRD with `Status: Approved` exists.
  Return a structured error identifying Draft FRDs instead:
  `{"error": "NO_APPROVED_FRDS", "draft_frds": [...list of Draft FRDs found...]}`
- Planner Mode 1 (`entry_mode: intake`): produces Draft artifacts only; stops for human review;
  does not produce a phase plan; does not set intake status.
- Planner Mode 2 (`entry_mode: plan`): requires at least one `Status: Approved` FRD as input.
- No platform implementation may skip or simulate human approval of requirements or design artifacts.
- See ADR-008.

---

## Testing Requirements

- All new behavior must have tests.
- Tests must include: success case, failure case, and edge case.
- Verifier must check UX Gate compliance and flow coverage for any user-facing tasks.
