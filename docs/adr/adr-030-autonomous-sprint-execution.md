# ADR-030: Autonomous Sprint Execution with PR-Gated Human Review

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The platform's stated goal is that the AI pipeline can complete an entire sprint without human intervention. Human involvement is at the human's discretion or when governance guardrails explicitly require it.

The current pipeline model (ADR-022) has human approval gates after every role: Planner, Sprint Controller, and Implementer are all in `GATED_ROLES`. This was appropriate during development — it gave operators visibility into each role's output before allowing the pipeline to continue. In the target state, these intra-sprint gates are friction, not safety.

The current Implementer role (ADR-029) produces an `implementation_summary.md` — a *description* of what code to write — and stops. A human developer is expected to read that summary and use Copilot or another tool to perform the actual code changes. This breaks the automation goal.

Three shifts are required to reach autonomous sprint execution:

1. **The Implementer must write code**, not describe code
2. **The Verifier must verify real artifacts**, not reason about a summary
3. **Human review happens once per sprint at the PR boundary**, not after each role

### Why PR-Gated

A pull request is the natural human review surface for code changes:
- It presents a diff of exactly what changed
- It is the standard mechanism for team code review
- Merge is an explicit, deliberate human approval
- CI/CD hooks on merge provide a deterministic pipeline trigger
- It is natively supported by GitHub, which is already the Git host (ADR-001)

Making the PR the single human gate eliminates in-flight interruptions while preserving meaningful human control over what enters the main branch.

---

## Decision

The Execution Service SHALL implement an **Autonomous Sprint Execution Model** where the full pipeline — Planner through Sprint Controller (close-out) — runs without required human approval gates. Human review occurs once per sprint via a GitHub Pull Request.

### 1. Implementer as Coding Agent

The Implementer role SHALL write actual code changes to the project's Git working tree (ADR-028).

The Implementer SHALL:
- Operate on a **task feature branch** (e.g., `feature/{task_id}-{sprint_id}`) created during Sprint Controller setup
- Use the LLM provider's tool-calling capability (ADR-029) to read existing files, write new or modified files, and validate its own output iteratively
- Be constrained to the files and scope declared in `AI_IMPLEMENTATION_BRIEF.md`
- Commit changes to the feature branch with a structured commit message including `pipeline_id`, `task_id`, and execution traceability metadata
- Push each commit incrementally to the remote branch so progress is durable and reviewable during execution

The governance constraints from the current implementation summary model are preserved as tool-call constraints:
- Maximum 5 files changed per task
- All changes must trace to an acceptance criterion in the implementation brief

### 2. Verifier as Test Executor

The Verifier role SHALL execute real verification rather than reasoning about a summary.

The Verifier SHALL:
- Run the project's test suite, lint, and type-check commands as defined in the project's governance configuration
- Parse exit codes and structured output (JSON test reporters where available) to determine pass/fail
- Use the LLM only for **failure triage** — when tests fail, the LLM analyzes the output and produces structured `required_corrections` for Implementer retry context
- If all checks pass, record `passed: true` and advance the pipeline without LLM involvement

This aligns with ADR-003 (Deterministic Over LLM): verification is a deterministic process; LLM is invoked only when determinism is insufficient.

### 3. Removal of Intra-Sprint Human Gates

The `GATED_ROLES` set SHALL be reduced to the sprint close-out gate only:

| Role | Gate behavior |
|---|---|
| Planner | Auto-advance (no gate) |
| Sprint Controller (setup) | Auto-advance (no gate) |
| Implementer | Auto-advance (no gate) |
| Verifier (pass) | Auto-advance (no gate) |
| Verifier (fail) → Implementer (retry) | Auto-advance (no gate) |
| Sprint Controller (close-out) | **Gate: creates PR, waits for merge** |

Humans retain the ability to intervene at any point via `/takeover` (ADR-024). The absence of mandatory gates does not remove human override capability — it removes the *requirement* that a human approve each step.

### 4. Sprint Branch Strategy

At pipeline creation, the Execution Service SHALL:
1. Create a task feature branch: `feature/{task_id}-{sprint_id}` from the current default branch HEAD
2. Record the branch name in the pipeline run metadata
3. All Implementer commits land on this branch

The Sprint Controller (close-out) SHALL:
1. Confirm all tasks in the sprint are complete
2. Ensure the feature branch is pushed to the remote
3. Open a GitHub Pull Request from `feature/{task_id}-{sprint_id}` → default branch
4. Record the PR URL and number in the pipeline run metadata
5. Set pipeline status to `awaiting_pr_review`

The pipeline is considered complete when the PR is merged. Merge is detected via GitHub webhook or polling.

### 5. PR Content and Traceability

The pull request SHALL be populated with structured content to support human review:

```
Title: [feature/{task_id}-{sprint_id}] {sprint_goal}

Body:
## Sprint Summary
{sprint_goal}

## Tasks Completed
- [ ] TASK-001: {description} — Implementer exec: {execution_id}
- [ ] TASK-002: {description} — Implementer exec: {execution_id}

## Verification Results
All tasks: PASS
Test run: {execution_id} | Commit: {head_commit}

## Pipeline
Pipeline ID: {pipeline_id}
Started: {created_at} | Branch: feature/{task_id}-{sprint_id}
```

Every task in the PR body is traceable to an `execution_id` in the `execution_records` table (ADR-019). The PR body is generated by the Sprint Controller (close-out) from structured data — not by LLM prose generation.

### 6. Implementer Retry Limit

There is no separate Fixer role. When the Verifier fails, the Sprint Controller routes back to the Implementer with the `verification_result.json` and failure logs appended as additional context. The Implementer investigates, applies fixes using the same Claude Code SDK toolset, and re-commits.

The maximum number of Implementer attempts (initial + retries) is 3. After 3 consecutive attempts without a Verifier pass, the pipeline transitions to `failed` and a human escalation notification is sent. The sprint branch is not deleted; the human can inspect the state, intervene, and trigger a manual handoff.

**Why Implementer handles retries rather than a dedicated Fixer:**
- Real debugging requires reading code, reading logs, adding instrumentation, and re-running — the same capabilities as initial implementation
- A Fixer role that could only produce a text prescription fails on any non-trivial bug
- A Fixer role with full tool access is just Implementer with a different prompt
- Collapsing the roles eliminates one LLM agent, one governance prompt, and one script while improving retry quality

### 7. Guardrail-Triggered Human Escalation

Certain conditions SHALL trigger mandatory human escalation regardless of the autonomous execution model:

- Implementer retry limit exceeded
- Implementer attempts to modify files outside the declared scope
- Verifier detects changes to files not listed in the implementation brief (scope drift)
- Any role produces output that fails schema validation after the configured retry limit
- A git operation fails (merge conflict, push rejection)

Escalation posts a Slack notification with the pipeline state and the specific guardrail that triggered it. The pipeline pauses at `failed` or `paused_takeover` as appropriate.

---

## Core Principle

> The pipeline runs. Humans review the result.  
> Intervention is available at any point, but never required mid-sprint.  
> The PR is the gate. Merge is the approval.

---

## Sprint Execution Flow

```
POST /pipeline { entry_point: "planner" }
        │
        ▼
Planner — produces phase plan
        │ (auto-advance)
        ▼
Sprint Controller (setup) — produces sprint plan + brief + creates feature branch
        │ (auto-advance)
        ▼
Implementer — writes code on feature branch, commits + pushes incrementally
  (attempt 1..3; on retry receives verification_result.json + failure logs)
        │ (auto-advance)
        ▼
Verifier — runs tests/lint/typecheck
        │
  ┌─────┴──────┐
PASS          FAIL
  │             │ (auto-advance)
  │             └──► Implementer (retry with failure context)
  │                        │ (max 3 total attempts, then escalate to failed)
  │             ◄──────────┘ (loops back through Verifier)
  ▼
Sprint Controller (close-out)
        — verifies branch pushed
  — opens GitHub PR
  — sets status: awaiting_pr_review
        │
        ▼
  Human reviews PR
        │
   ┌────┴────┐
 Merge    Request Changes
   │             │
   ▼             ▼
Pipeline     Human comments on PR
complete     (human may trigger /handoff
             to resume pipeline with
             corrections — future scope)
```

---

## Consequences

### Positive

- Full sprint can execute without human intervention
- Human review is meaningful: a complete, tested diff rather than intermediate AI reasoning artifacts
- PR is the canonical audit trail: who merged, what was reviewed, what CI passed
- Existing override mechanisms (ADR-024) remain available for human intervention at any step
- Verification is deterministic (real test execution), reducing false-positive passes

### Negative

- Implementer as coding agent requires Claude Code SDK — Anthropic-specific dependency for the Implementer role
- Sprint branch management adds Git operation scope to the Execution Service
- GitHub API integration required for PR creation and merge detection — new external dependency
- If tests are not present in the project, Verifier cannot verify deterministically and falls back to LLM review
- Implementer retry attempts consume Claude Code SDK credits; a hard cap of 3 attempts bounds cost exposure

### Neutral

- Intra-sprint Slack notifications (role start/complete) continue to fire; the channel receives progress updates without requiring action
- The existing `/takeover` and `/handoff` commands remain operational — a human can claim any step at any point

---

## Related ADRs

- ADR-001: Git as Source of Truth
- ADR-003: Deterministic Over LLM
- ADR-006: Human-in-the-Loop Approval
- ADR-009: Execution Service
- ADR-011: Execution Service Owns Git
- ADR-018: Execution Determinism
- ADR-019: Observability and Replayability
- ADR-022: Multi-Agent Pipeline Execution Model
- ADR-024: Pipeline Human Override and Takeover Model
- ADR-027: Multi-Project Support
- ADR-028: Project-Scoped Git Repository Lifecycle
- ADR-029: LLM Provider Abstraction
