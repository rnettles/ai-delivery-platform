# ADR-032: Planner Next-Mode Auto-Advance After Closeout

## Status
Accepted

## Date
2026-04-28

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

ADR-030 (Autonomous Sprint Execution) established the autonomous pipeline loop: Planner → Sprint Controller → Implementer → Verifier, with automated hand-off between roles once gates pass. The loop supports two execution modes:

- **full** — Planner conducts phase planning, then Sprint Controller stages Sprint 1 (no phase-to-sprint auto-advance)
- **next** — Planner enters decision flow after closeout to determine the next logical step

The current implementation has a limitation: **when Planner encounters closeout artifacts (verification_result.json + sprint_closeout.json), it immediately returns the closeout output and terminates**. This means `execution_mode: next` cannot chain phases or additional work after a sprint completes in the same pipeline invocation.

### Scenario Impact

In the managed project workflow, closeout is a terminal point:

```
Planner (phase plan)
  ↓
Sprint Controller (stages sprint)
  ↓
Implementer (codes)
  ↓
Verifier (passes)
  ↓ [Closes sprint, creates PR]
Planner (closeout — hard-returns)
[Pipeline ends. Operator must invoke new pipeline for next work.]
```

This requires **manual re-invocation** of the Planner for each subsequent phase or sprint, defeating the "autonomous" part of the delivery loop for continuous work scenarios.

### Design Constraints

1. **Preserve audit artifacts** — `planner_sprint_closeout.json` must continue to be persisted as the close-out evidence record (ADR-030 compliance)
2. **Avoid duplicate PRs** — If closeout is re-invoked (e.g., idempotent retries), the same closeout PR must be reused, not re-created
3. **Non-next behavior unchanged** — `execution_mode: full` and calls without `execution_mode: next` should not be affected
4. **Role boundaries** — Planner determines the next step; Sprint Controller retains responsibility for sprint staging

---

## Decision

The Planner's `run()` method SHALL support **continuation of decision flow after closeout when `execution_mode: "next"`**.

### Flow Change

When Planner encounters closeout artifacts **and** `execution_mode: "next"`:

1. **Execute closeout** — Call `runSprintCloseOut()`, persist `planner_sprint_closeout.json` and PR metadata
2. **Continue decision** — Do NOT return; instead, evaluate the next logical state using an explicit **Next-Mode State Resolver**
3. **Route to next action** — Based on the resolver's output, invoke Sprint Planning, Phase Planning, or return NO_WORK

### Next-Mode State Resolver

The resolver evaluates the following conditions **in order**, returning a `NextModeState`:

```typescript
type NextModeState =
  | { kind: "open_sprint" }           // Open sprint exists in repo
  | { kind: "sprint_ready" }          // Sprint-ready phase exists (Planning/Approved status)
  | { kind: "phase_planning" }        // No sprint-ready phase; unclaimed FRs > 0
  | { kind: "no_work" };              // No sprint-ready phase; unclaimed FRs = 0
```

**Resolution order** (first match wins):

| Order | Condition | Action | Result |
|-------|-----------|--------|--------|
| 1 | Any open sprint exists in `project_work/ai_project_tasks/` | Throw `OPEN_SPRINT_EXISTS` (409) | Hard stop — operator must close open sprint first |
| 2 | Phase plan exists with status "Planning" or "Approved" | Call `runSprintPlanning()` | Chain into sprint staging |
| 3 | No sprint-ready phase AND unclaimed FR count > 0 | Continue to phase planning (LLM path) | Draft next logical phase |
| 4 | No sprint-ready phase AND unclaimed FR count = 0 | Throw `NO_WORK_AVAILABLE` (409) | Hard stop — no work remains |

### Closeout Idempotency

If `runSprintCloseOut()` is invoked multiple times with the same pipeline context:

1. Check for existing `planner_sprint_closeout.json` in previous_artifacts
2. If found and contains PR metadata, **reuse it**:
   - Do not execute closeout again (skip git push, PR creation)
   - Return the existing PR metadata
   - Log reuse event in context
3. Otherwise, proceed with normal closeout

This prevents duplicate PRs in retry or re-invocation scenarios.

### PR Deduplication

Before creating a new PR in closeout, the Planner SHALL **check for an existing open PR** using this priority:

1. **Branch-based lookup** — Search for open PR with matching `head` branch (preferred; least ambiguous)
2. **Title-based fallback** — If no branch match, search for open PR with matching title
3. **Create new** — If neither lookup succeeds, create a new PR

Rationale: Branch matching is deterministic; title matching is a fallback for rare edge cases. Reverse order (title-first) risks colliding with unrelated PRs.

### Backward Compatibility

- **Non-next execution** — Planner.run() with no `execution_mode` or `execution_mode: full` returns immediately after closeout (current behavior unchanged)
- **Existing audit artifacts** — `planner_sprint_closeout.json` structure unchanged; reuse only occurs when artifact exists
- **Error handling** — `OPEN_SPRINT_EXISTS` and `NO_WORK_AVAILABLE` are new errors; existing callers may encounter them only in `execution_mode: next` flows

### Implementation Scope

**In Planner (`role-planner.script.ts`)**:
- Refactor closeout hard-return to conditional return
- Add `resolveNextModeState()` method for explicit decision routing
- Add closeout idempotency check before PR creation
- Preserve `planner_sprint_closeout.json` generation and audit path

**In GitHub API Service (`github-api.service.ts`)**:
- Add `findOpenPullRequestByHead()` for branch-based PR lookup
- Add `findOpenPullRequestByTitle()` for title-based PR lookup
- Internal refactor: extract common request/response handling

**In Tests**:
- Add test coverage for closeout → sprint-ready phase flow
- Add test coverage for closeout → phase-planning (unclaimed FRs) flow
- Add test coverage for closeout → NO_WORK flow
- Add test coverage for duplicate closeout PR prevention

---

## Consequences

### Positive

- Continuous phase/sprint chaining in autonomous pipelines with `execution_mode: next`
- Single pipeline invocation can close a sprint and stage the next phase/sprint
- Reduces operator friction for multi-sprint deliveries
- Idempotency prevents accidental duplicate PR creation in retry scenarios

### Negative

- Planner's `run()` method becomes more complex (additional state resolver + idempotency logic)
- New error conditions (`OPEN_SPRINT_EXISTS`, `NO_WORK_AVAILABLE`) that operators must handle
- PR deduplication adds GitHub API calls (one more query before create)

### Neutral

- Next-mode behavior is additive; existing full/unnamed-mode behavior unchanged
- Audit trail preserved: `planner_sprint_closeout.json` remains the closeout evidence record
- Role boundaries preserved: Planner decides next state, Sprint Controller still owns sprint staging

---

## Alternatives Considered

### Alternative 1: Closeout Decides the Next Step
**Description**: Have `runSprintCloseOut()` evaluate the next state and return a result that `run()` uses to route.

**Rejected because**: Mixes sprint-closeout concern with phase-planning decision logic. Closeout is about wrapping up a sprint; next-state decision is about phase/sprint orchestration. These are distinct responsibilities.

### Alternative 2: Separate "NextPlanner" Role
**Description**: Create a new role (e.g., `role-next-controller.script.ts`) that runs after closeout to determine the next step.

**Rejected because**: Unnecessary role proliferation; Planner is the natural authority for phase/sprint sequencing. Adding a separate role would require yet another pipeline step and actor assignment.

### Alternative 3: Pull Next-State Decision into Sprint Controller
**Description**: Have Sprint Controller (on success) decide whether to invoke Planner for the next step.

**Rejected because**: Violates role boundaries. Sprint Controller stages tasks; it should not decide what Planner does next. Sprint Controller also runs before Implementer/Verifier, so it cannot execute closeout logic (which depends on Verifier pass).

---

## Related Decisions

- **ADR-030** (Autonomous Sprint Execution) — Established pipeline loop and execution modes
- **ADR-031** (Three-Layer Governance Authority) — Planner must load composed prompts; pre-condition guards enforce role boundaries
- **ADR-022** (Pipeline Execution Model) — Defines pipeline status flow and step sequencing

---

## References

- `platform/backend-api/src/scripts/role-planner.script.ts` — Implementation
- `platform/backend-api/src/services/github-api.service.ts` — PR deduplication helpers
- `ai-project_template/ai_dev_stack/ai_guidance/AI_RULES.md` — Process rules
