# n8n Implementation Phase Plan

**Status:** Draft
**Version:** 0.1
**Date:** 2026-04-15

Phased rollout plan for the n8n orchestration layer. Each phase delivers standalone value and has
explicit acceptance criteria that must be satisfied before the next phase begins. No phase has an
unmet dependency from a later phase.

Architecture overview: `docs/n8n-orchestration.md`
Process flows: `docs/n8n-process-flows.md`
Artifact contract: `docs/n8n-artifact-state-contract.md`

---

## Phase Summary

| Phase | Scope                                    | LLM Calls      | Risk        |
|-------|------------------------------------------|----------------|-------------|
| 1     | State machine + coordinator              | None           | Very Low    |
| 2     | Verifier shell gate automation           | None           | Low         |
| 3a    | Documenter headless execution            | Yes (bounded)  | Medium      |
| 3b    | Fixer headless execution                 | Yes (bounded)  | Medium      |
| 4     | Intake Router + Phase → Sprint Activator | Yes (planning) | Medium-High |
| 5     | Implementer headless execution           | Yes (full)     | High        |

---

## Phase 1 — State Machine and Coordinator

### Goal

Validate the label-based state machine, GitHub integration, and bidirectional handoff without any
LLM or shell command execution. n8n manages state and notifies; humans run all agents in VS Code.

### What Gets Built

**Workflow 3 skeleton only. Workflows 1 and 2 are not started in this phase.**

n8n nodes in Phase 1:
- **Trigger:** GitHub Issue labeled `ready` (with `human-in-progress` exclusion filter)
- **Fetch Issue:** GitHub API — Get Issue
- **Parse Metadata:** Function node — extract YAML block from Issue body
- **Entry Gate:** IF node — check `architecture_contract_change` flag and `human-in-progress` absence
- **Label Transition nodes:** one per state transition in the state machine
- **Notification nodes** at each transition (GitHub comment or Slack):
  `"Task {id} entered {state} — run {agent} in VS Code"`
- **Needs-Human node:** write handoff note to repo + post GitHub Issue comment
- **Failed node:** post failure summary comment on Issue
- **Global Error Trigger:** log + post GitHub comment + apply `failed` label

All `Execute Command` nodes (gate runs, agent execution) are replaced with notification-only nodes.

### Acceptance Criteria

- [ ] GitHub Issue labeled `ready` reliably triggers the workflow (no missed events)
- [ ] `human-in-progress` label on an Issue suppresses all n8n action — workflow does not proceed
- [ ] `architecture_contract_change: true` in Issue body YAML causes immediate `needs-human`
      transition without executing any agent node
- [ ] Label transitions apply correctly and sequentially:
      `ready` → `implementing` → `verifying` (simulated via notifications)
- [ ] `needs-human` state writes `ai_dev_stack/ai_state/handoff_{task-id}.md` and commits it
- [ ] `needs-human` state posts a GitHub Issue comment containing the handoff summary
- [ ] After operator runs a VS Code agent and relabels to `verifying`, n8n resumes from the
      Verifier notification node
- [ ] `failed` state posts a failure summary comment on the Issue
- [ ] Global Error Trigger catches n8n internal errors without leaving Issues stuck in a state label
- [ ] At least 3 full simulated task flows (using notifications only) completed end-to-end
- [ ] Bidirectional handoff demonstrated: n8n → VS Code → n8n at least once

### Pre-Build Requirements

- [ ] GitHub repository label set created — all labels in schema with correct names
- [ ] n8n instance running and accessible with GitHub credential configured
- [ ] GitHub webhook configured for Issue label events
- [ ] Notification channel configured (Slack webhook or GitHub comment fallback)
- [ ] Canonical artifact paths reviewed and agreed against `n8n-artifact-state-contract.md`
- [ ] Test Issues created with valid YAML metadata blocks for validation runs

### Risk Notes

Very low risk. No code execution. All state changes are reversible via manual label edits on
GitHub. The only failure mode is a misconfigured webhook, filter, or label name mismatch.

---

## Phase 2 — Verifier Shell Gate Automation

### Goal

Automate the verifier node so gate checks run without operator involvement. This is the single
highest-value automation target because it removes the most frequent human bottleneck: running the
gate suite and interpreting the output.

### What Gets Built

Replace the Verifier notification node with an Execute Command node that:
1. Checks out the PR branch in the execution environment
2. Identifies changed files from the PR diff
3. Runs each gate command against changed files:
   - `python -m flake8 --max-line-length=120 <changed files>`
   - `python -m mypy <changed files> --ignore-missing-imports`
   - `python -m pytest <relevant test files> -x`
   - `python ai_dev_stack/scripts/validate_test_results.py`
4. Parses exit codes and captures stdout/stderr for each gate
5. Writes structured `test_results.json` to the canonical path
6. Commits `test_results.json` via GitHub API
7. Returns `{ status, recoverable, failures }` to the Decision node

The Decision node (PASS/FAIL) reads from the verifier JSON output — not from a manually applied label.

All other agent nodes remain as notification-only in Phase 2.

### Acceptance Criteria

- [ ] Verifier node runs all four required gates against the PR branch without operator involvement
- [ ] `test_results.json` written to `ai_dev_stack/ai_project_tasks/active/test_results.json`
      and committed to the PR branch
- [ ] Gate exit codes correctly mapped to `PASS` / `FAIL` per gate
- [ ] PASS result routes to documenter notification (documenter still manual in Phase 2)
- [ ] FAIL result routes to fixer notification, iteration counter incremented
- [ ] Max iterations exceeded with no PASS → `needs-human` state with handoff note that includes
      `test_results.json` failure content
- [ ] `validate_test_results.py` runs as a mandatory gate — never skipped
- [ ] Gate commands exactly match the project baseline defined in `AI_RUNTIME_GATES.md`
- [ ] Fast Track Issues trigger the Checkpoint Commit node before reaching the Verifier node
- [ ] At least 5 real task verification cycles run automated end-to-end before Phase 3a begins

### Pre-Build Requirements

- [ ] Phase 1 acceptance criteria fully satisfied
- [ ] n8n execution environment has Python installed with project dependencies (`flake8`, `mypy`,
      `pytest`, project packages)
- [ ] Git credentials available in the execution environment to check out PR branches
- [ ] `validate_test_results.py` accessible from the execution environment working directory
- [ ] PR branch naming convention aligned between GitHub and the runner environment

### Risk Notes

Low risk. Gate commands are deterministic and (except for committing `test_results.json`) read-only.
They do not modify code. The primary infrastructure risk is execution environment setup. Validate
the environment independently before building the Verifier node.

---

## Phase 3a — Documenter Headless Execution

### Goal

Introduce the first LLM-executing node. Documenter is chosen first because:
- Output is documentation changes only — no code regression risk
- Scope is bounded: sync docs from committed implementation artifacts
- Easy to review in the PR before merging
- A bad documenter output is a trivially correctable doc commit, not a broken build

### What Gets Built

- Implement `run-agent.js` (or equivalent Python script) at minimum viable scope for Documenter:
  1. Accept `{ taskId, agentName, contextPaths }` as input
  2. Load artifacts from `contextPaths` via GitHub API
  3. Resolve task flags from Issue body YAML block
  4. Build documenter prompt (simplified context — no full `AI_RUNTIME_LOADING_RULES.md` yet)
  5. Call LLM API (configurable: OpenAI or Anthropic)
  6. Write documentation output
  7. Commit documentation changes to PR branch
  8. Return structured result JSON

- Wire `run-agent.js documenter` into the Documenter node in Workflow 3
- PASS branch: Documenter runs headless → commits doc changes → Issue transitions to `done`

### Acceptance Criteria

- [ ] `run-agent.js` tested independently before being wired into n8n
- [ ] Documenter node calls `run-agent.js documenter` with correct context paths
- [ ] Documenter output committed to PR branch as documentation changes
- [ ] PR is updated with doc changes before Issue close-out
- [ ] `run-agent.js` returns structured result; n8n error handling works on `status: error`
- [ ] At least 3 real task close-outs completed with automated Documenter before Phase 3b begins
- [ ] Operator reviews Documenter output on all Phase 3a tasks (review gate; not automated yet)

### Risk Notes

Medium risk, primarily from LLM output quality. Mitigate:
- Keep a mandatory Operator PR review gate on all Phase 3a outputs before merge
- Do not enable Documenter on tasks with `ui_evidence_required: true` until Phase 4

---

## Phase 3b — Fixer Headless Execution

### Goal

Automate the fixer node, enabling the first fully unattended fix-loop cycles. The fixer is
bounded by the verifier contract: it must only address the failures listed in `test_results.json`
and nothing outside that scope. The verifier re-runs immediately after any fixer output.

### What Gets Built

Extend `run-agent.js` to support the Fixer agent:
- Required context: `brief_{task-id}.md` + `test_results.json`
- Fixer prompt must be explicitly constrained to the failures listed in `test_results.json` only
- Code changes committed to PR branch
- Verifier re-runs immediately after fixer output (the existing loop in Workflow 3)

Lower `maxIterations` to 3 for Phase 3b tasks during validation (tighter tolerance while observing
automated fix behavior).

### Acceptance Criteria

- [ ] Fixer node calls `run-agent.js fixer` with `test_results.json` and `brief_{task-id}.md`
      as required context
- [ ] Fixer output committed to PR branch without human intervention
- [ ] Verifier re-runs after fixer and correctly evaluates the new state
- [ ] Full unattended fixer → verifier → PASS loop demonstrated on at least 2 real tasks
- [ ] `needs-human` correctly triggered when fixer fails to resolve failures within the reduced
      `maxIterations` budget
- [ ] First 5 automated fixer commits reviewed by operator before removing the review gate
- [ ] Fixer is not run on tasks with `architecture_contract_change: true` — these still route
      to `needs-human` at the Entry Gate

### Risk Notes

Medium risk. The fixer writes code. Main risk: fixer addresses a listed failure but introduces a
new one, consuming iterations without net progress. Mitigate:
- Run Phase 3b exclusively on Side Quest tasks initially (bounded scope, well-understood domain)
- Set `maxIterations: 3` during Phase 3b validation
- Operator reviews fixer commits on the first 5 cycles before reducing oversight

---

## Phase 4 — Intake Router and Phase → Sprint Activator

### Goal

Build Workflows 1 and 2, completing the full upstream automation chain. After Phase 4, the primary
human touchpoint is reviewing and approving specs and phase plans before staging — not managing
process steps.

### What Gets Built

**Workflow 1 (Intake Router):**
- GitHub webhook on push to `intake/INT-*/INTAKE.md`
- Function node parses INTAKE.md for routing signals
- Switch node implements routing decision table from `AI_INTAKE_PROCESS.md`
- All routes initially **advisory**: workflow suggests route, notifies operator, awaits confirmation
- On confirmation: propagate (create Side Quest spec, update `next_steps.md`, create Phase intake
  Issue as appropriate)

**Workflow 2 (Phase → Sprint Activator):**
- GitHub webhook on push to `active/phase_plan_*.md` with `Status: Active`
- Parse phase plan for sprint list and task checklist
- Invoke Planner agent headless (`run-agent.js sprint-planner`) to derive sprint plan
- Commit sprint plan to `ai_dev_stack/ai_project_tasks/active/`
- Create GitHub Issues per task with `type:task` + `ready` labels and populated metadata blocks
- Update `next_steps.md`

### Acceptance Criteria

**Workflow 1:**
- [ ] Push to `intake/INT-*/INTAKE.md` reliably triggers the router
- [ ] Routing suggestion correctly matches the `AI_INTAKE_PROCESS.md` routing table for at least
      5 diverse test intake items covering all routing cases
- [ ] Operator confirmation gate is enforced — no downstream changes propagated without explicit
      operator confirmation
- [ ] Side Quest route creates a correct spec stub at `ai_dev_stack/ai_project_tasks/side_quests/`
- [ ] Rejection route writes a rationale comment and does not propagate anything

**Workflow 2:**
- [ ] Phase plan activation (push with `Status: Active`) triggers the workflow
- [ ] Sprint plan derived and committed to the correct canonical path
- [ ] GitHub Issues created with correct YAML metadata blocks and label sets
- [ ] Issues enter Workflow 3 automatically via the `ready` label
- [ ] At least one full Phase → Sprint → Task cycle completed end-to-end (including Workflow 3)
- [ ] Auto-derived sprint plan compared to a manually authored equivalent and operator-approved
      for at least 3 cycles before removing the advisory gate from Workflow 2

### Pre-Build Requirements

- [ ] Phase 3b acceptance criteria fully satisfied
- [ ] `run-agent.js` extended to support `planner` agent context
- [ ] Simplified version of `AI_RUNTIME_LOADING_RULES.md` implemented for planner context loading

### Risk Notes

Medium-High. Planning-level agents have more complex context requirements. Errors here propagate
to sprint plans and task briefs — they compound. Run Workflow 2 in advisory mode for at least
3 cycles before enabling Issue creation without operator approval.

---

## Phase 5 — Implementer Headless Execution

### Goal

Automate the implementer node. This completes the fully unattended sprint execution capability for
bounded in-contract tasks.

### When to Start Phase 5

Phase 5 is not automatically triggered by Phase 4 completion. A deliberate operator decision is
required. Evaluate readiness against these criteria:

- Phase 3b has demonstrated sustained unattended fixer → verifier → PASS cycles (>60% success rate
  across ≥10 tasks)
- The operator's spec review process ("scrutinize before hitting go") is consistently producing
  task briefs where ambiguous decision points have been eliminated before execution
- The team has agreed on which task types are in scope for Phase 5 (e.g., Side Quests,
  well-patterned feature additions within a defined subsystem)

### What Gets Built

Extend `run-agent.js` to support the Implementer agent:
- Full `AI_RUNTIME_LOADING_RULES.md` conditional context loading
- All task flags resolved and applied
- Code changes committed to PR branch with atomic, logical commits
- PR created or updated via GitHub API

### Acceptance Criteria

Acceptance criteria are defined per project at Phase 5 entry — they depend on the project's
domain, test coverage, and acceptable risk tolerance. At minimum:

- [ ] Implementer produces compilable, lint-clean, type-clean code on first attempt for at least
      70% of in-scope tasks
- [ ] `architecture_contract_change: true` flag always routes to `needs-human` at Entry Gate —
      this check is never bypassed
- [ ] `cross_subsystem_change: true` flag routes to `needs-human` at Entry Gate, or requires
      explicit `override_cross_subsystem: true` in metadata (logged)
- [ ] Operator PR review gate: all PRs from automated implementer require explicit operator
      approval before merge — this gate is not removed in Phase 5
- [ ] `needs-human` escalation rate < 20% of Phase 5 tasks after 10-task burn-in

### Risk Notes

High. The implementer writes code. Underspecified tasks or context loading errors produce
code that passes gates but violates intent. This is the failure mode gates cannot catch.
Permanent mitigations:
- The spec quality gate ("scrutinize before hitting go") must be treated as a hard prerequisite,
  not a best practice
- Operator PR review is permanent for automated implementer output
- Start Phase 5 with Side Quest tasks only; expand scope deliberately

---

## Cross-Phase Rollback Protocol

If a phase introduces issues that exceed the risk tolerance:

1. Revert the Workflow 3 n8n workflow to the previous phase configuration (use n8n workflow version
   history)
2. Revert affected Issues to `needs-human` state via manual label edits on GitHub
3. Document the failure in an intake item (`INT-*`) before re-attempting the phase
4. Do not skip phases or attempt partial rollbacks within a phase

---

## Success Metrics

| Metric                                        | Phase 3 Target      | Phase 5 Target      |
|-----------------------------------------------|---------------------|---------------------|
| Unattended PASS rate (Side Quests)            | > 60% of tasks      | > 80% of tasks      |
| Mean iterations to PASS                       | < 2.5               | < 2.0               |
| `needs-human` escalation rate                 | < 30% of tasks      | < 15% of tasks      |
| Unrecoverable `failed` rate                   | < 5% of tasks       | < 2% of tasks       |
| Operator review time per task (post-PR)       | < 30 minutes        | < 20 minutes        |
| n8n execution error rate (non-task failures)  | < 2% of runs        | < 1% of runs        |
