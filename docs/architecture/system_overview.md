# System Overview
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **high-level architecture** of the governed AI orchestration system.

It explains:
- System components
- Responsibilities of each layer
- How data and control flow through the system
- How governance is enforced end-to-end

---

# 2. Architectural Principles

## 2.1 Governance-First Design
All rules, prompts, templates, and schemas originate from the platform-owned governance content
(per ADR-026, ADR-031). Governance is composed at runtime from a two-tier model (per ADR-025):
platform-owned invariants merged with project-scoped rules.

## 2.2 Separation of Concerns

| Layer | Responsibility |
|---|---|
| Git (platform + project) | Governance content + delivered artifacts |
| Execution Service | Pipeline state machine, role execution, registry resolution, Git ownership |
| Postgres (Drizzle ORM) | Pipeline runs, execution records, projects, coordination context |
| Interface adapters (n8n + Slack, CLI) | Intent capture, message rendering — no governed logic |
| Scripts (TypeScript) | Deterministic execution targets resolved by the registry |
| LLM providers | Reasoning bounded by structured output contracts |

## 2.3 Artifact-Driven Execution

System truth is determined by:
- What artifacts exist in Git
- Whether they validate against deterministic contracts (per ADR-002, ADR-033)

NOT by:
- Mutable runtime records
- Coordination context entries
- Conversational state

---

# 3. System Components

## 3.1 Platform Governance (Git)

### Location
```
platform/governance/
  ├── manifest.json
  ├── prompts/        (role-*.md)
  ├── rules/          (process_invariants, runtime_loading_rules, runtime_gates, ...)
  └── schemas/
```

### Responsibilities
- Store role prompts (Planner, Sprint Controller, Implementer, Verifier, Fixer)
- Store process invariants and runtime gates
- Store schemas for execution contracts and artifacts
- Define role behavior, validation expectations, and task flag contracts

### Key Property
> Platform governance is the source of policy. Project repos contribute project-scoped rules
> via ADR-025 composition; the Execution Service merges both at load time.

## 3.2 Execution Service (Backend API)

### Location
```
platform/backend-api/src/
  ├── routes/         (pipeline, execution, project, git-sync, coordination, health)
  ├── controllers/
  ├── services/       (pipeline, execution, governance, project-git, design-input-gate, llm/, ...)
  ├── scripts/        (role-planner, role-sprint-controller, role-implementer, role-verifier)
  └── db/             (Drizzle schema, migrations)
```

### Responsibilities
- Expose the canonical execution contract (per ADR-013)
- Resolve script and role targets via the registry (per ADR-017)
- Own pipeline state machine: sequencing, retries, gating, escalation (per ADR-022, ADR-030)
- Own project-scoped Git lifecycle: clones, branches, commits, pushes, PRs (per ADR-028, ADR-030)
- Persist immutable execution records (per ADR-019)
- Compose governance prompts from platform + project sources (per ADR-025, ADR-031)
- Emit pipeline notifications to interface adapters via webhook callback

### Non-Responsibilities
- Slack credentials, message formatting, or direct Slack I/O (per ADR-023)
- CLI rendering (handled by `platform/cli`)

## 3.3 Postgres (Drizzle ORM)

### Tables
- `pipeline_runs` — pipeline state, current step, history, sprint branch, PR number, implementer attempts
- `execution_records` — immutable record per governed execution (target, version, input, output, timing, replay linkage)
- `projects`, `project_channels` — multi-project registry (per ADR-027)
- `state`, `state_history` — versioned state model (per ADR-016)
- coordination context tables (per ADR-014)

### Key Constraint
> Postgres holds runtime coordination and audit records. Final truth is reconstructable from
> Git artifacts and the immutable execution records (per ADR-012, ADR-019).

## 3.4 Interface Adapters

### Slack via n8n (per ADR-021, ADR-023)
- n8n is the exclusive Slack adapter: holds Slack credentials, verifies webhooks, parses slash
  commands, formats interactive gate messages.
- Slash commands map to canonical pipeline endpoints: `/plan`, `/sprint`, `/implement`,
  `/verify`, `/status`, `/approve`, `/takeover`, `/handoff`, `/skip`.
- n8n receives outbound `pipeline-notify` callbacks from the Execution Service and posts
  formatted Slack messages with thread continuity.

### CLI (`platform/cli`)
- First-class operator interface that calls the Execution Service HTTP API directly.
- Commands: `pipeline-create`, `pipeline-status`, `pipeline-approve`, `pipeline-takeover`,
  `pipeline-handoff`, `pipeline-retry`, `pipeline-cancel`, `staged/*`, project and execution
  utilities.
- Used for operator workflows, dry-run scenarios, and headless automation.

## 3.5 Deterministic Script Layer

### Targets (registry-resolved)
- `role-planner.script.ts`
- `role-sprint-controller.script.ts`
- `role-implementer.script.ts`
- `role-verifier.script.ts`

### Responsibilities
- Render templates and write artifacts to project Git working trees
- Validate artifact structure (deterministic contracts per ADR-033)
- Resolve paths, load governance, inspect repos
- Pre-compute script-evaluable facts (filesystem state, gate exit codes, deliverables) and
  inject them as structured directives to the LLM
- Own state-field writes in hybrid artifacts (`verification_result.json`, `progress.json`,
  `test_results.json`) — the LLM writes only narrative

### Key Principle
> The script is the only writer for state fields. The LLM writes narrative.

## 3.6 LLM (Reasoning Layer)

### Provider abstraction (per ADR-029)
- `llm-provider.interface.ts` — common contract
- Concrete providers: Azure OpenAI / OpenAI-compatible, Anthropic
- Tool-calling support for the Implementer coding agent (per ADR-030)

### Responsibilities
- Interpret structured directives produced by scripts
- Generate JSON-schema-bounded outputs
- Drive the Implementer tool-call loop (read/write files, run gates, set_progress, finish)
- Triage Verifier failures into structured `required_corrections`

### Constraints
- Structured output enforced at the contract boundary (per ADR-008)
- Cannot control workflow logic, gate decisions, or state transitions
- Bounded by `MAX_ITERATIONS` and per-call token budgets

---

# 4. End-to-End Flow

## 4.1 Pipeline Run (autonomous full-sprint mode)

```
Operator (Slack /plan or CLI pipeline-create)
        │
        ▼
n8n / CLI  →  POST /pipeline { entry_point, execution_mode, channel_id, description }
        │
        ▼
Execution Service: create pipeline_run row, record entry, route to first role
        │
        ▼
Planner          — produce phase plan + sprint plan stages
        │ (auto-advance in full-sprint)
        ▼
Sprint Controller (setup) — stage tasks, write brief, create feature branch
        │ (auto-advance)
        ▼
Implementer     — coding agent: tool-call loop, commit + push incrementally
  ┌─────────────► attempt 1..3 (max via MAX_IMPLEMENTER_ATTEMPTS)
  │     │
  │     ▼
  │   Verifier  — run tests/lint/typecheck; LLM only on failure for triage
  │     │
  │  ┌──┴───┐
  │ PASS   FAIL
  │  │      └──► route back to Implementer with verification_result.json
  │  ▼
Sprint Controller (close-out)
   — verify branch pushed
   — open GitHub PR
   — set status: awaiting_pr_review
        │
        ▼
Human reviews PR  →  Merge (complete) or Request Changes (loop)
```

## 4.2 Execution Modes (per ADR-022, ADR-032)

| Mode | Behavior |
|---|---|
| `next` | Run only the entry role, then stop. Human gates active. |
| `next-flow` | Chain into role-specific downstream flow. Human gates active. Non-planner entries stop on Verifier PASS. |
| `full-sprint` | End-to-end autonomous. Intra-sprint gates bypassed. Pipeline halts at `awaiting_pr_review`. |

## 4.3 Human Override (per ADR-024)

At any pipeline state, an operator may invoke:
- `approve` — advance past `awaiting_approval`
- `takeover` — claim the current step (status `paused_takeover`)
- `handoff` — return control after a manual step
- `skip` — advance past a step with justification
- `cancel` — terminate the pipeline run

All override actions are recorded immutably in the pipeline step history.

---

# 5. Data Flow

## 5.1 Inputs
- Operator intents (Slack slash commands, CLI commands)
- Platform governance content (`platform/governance/`)
- Project repository state (clones managed by `project-git.service`)

## 5.2 Outputs
- Phase plans, sprint plans, task briefs (artifacts in project repo)
- Implementation commits on sprint feature branches
- Hybrid-schema artifacts: `test_results.json`, `verification_result.json`, `progress.json`
- GitHub Pull Requests (sprint close-out)
- Pipeline notifications to interface adapters

## 5.3 Data Ownership

| Data Type | Owner |
|---|---|
| Platform governance | `platform/governance/` (Git) |
| Project governance + delivered artifacts | Project repo (Git, project-scoped clone) |
| Pipeline state, execution records, coordination | Postgres |
| Slack credentials, message formatting | n8n |
| Operator intent capture | n8n + CLI |

---

# 6. Control Flow

## 6.1 Pipeline Routing

The Execution Service controls:
- Which role runs next (resolved from role registry `on_success` / `on_fail`)
- When deterministic checks run vs LLM calls (per ADR-033)
- When the pipeline gates (`awaiting_approval`, `awaiting_pr_review`)
- When retries occur (Implementer ≤ 3 attempts, per ADR-030)
- When escalation triggers (per ADR-030 §7)

n8n contributes only intent ingestion and message rendering. The Execution Service is the
single authority over pipeline progression.

## 6.2 Transition Rules

Transitions advance only when:
- Required artifacts exist and validate against schemas
- Gates are satisfied (auto in full-sprint; explicit operator action otherwise)
- Verifier PASS or Implementer retry budget remains
- No guardrail violation has been raised

---

# 7. Validation Enforcement

## 7.1 Deterministic-First (per ADR-033)
Scripts evaluate structurally checkable conditions before invoking the LLM:
- File existence, required sections, deliverables checklist
- CI gate exit codes (`npm test`, `npx tsc`, `npm run lint`)
- Task-id alignment, scope-drift detection
- UX evidence checks where applicable

If any deterministic check fails, the LLM governance call is skipped and the result is FAIL.

## 7.2 Schema Contracts
- Execution request/response payloads validated against schemas (per ADR-020)
- Hybrid artifact schemas separate script-written state fields from LLM-written narrative

## 7.3 Governance Composition (per ADR-025, ADR-031)
- Platform invariants always loaded
- Project-scoped rules layered per-role
- Runtime gate rules enforce process invariants at execution time

---

# 8. Failure Handling

## 8.1 Failure Types
- Missing or invalid artifacts
- Verifier deterministic failure (CI gates)
- Verifier LLM-judged failure (governance checks)
- LLM output schema violation
- Git operation failure (merge conflict, push rejection)
- Implementer scope drift (out-of-brief file modification)
- Implementer retry exhaustion (≥ 3 attempts)

## 8.2 Behavior
- Verifier failure → route back to Implementer with structured corrections (within retry budget)
- Retry exhaustion → pipeline `failed` + escalation notification
- Scope drift / git failure → pipeline `failed` or `paused_takeover` for operator intervention
- Schema failure after retries → escalation
- All failures recorded immutably in pipeline step history and execution records

---

# 9. Extensibility

The architecture supports adding new roles or scripts by:
- Registering a new target in the script registry
- Adding a role prompt under `platform/governance/prompts/`
- Defining role transitions (`on_success`, `on_fail`, `gate`) in the registry

No change to the Execution Service core, n8n flows, or CLI is required for new role addition.

Future expansions under consideration:
- Documentation agent (per `documenter-v5` agent definition)
- Automated PR remediation beyond current `pr-remediation.service`
- Cross-run gate evidence reuse (per ADR-033 future phase)

---

# 10. Key Guarantees

- Governance-aligned execution (composed from platform + project per ADR-025)
- Single authority for pipeline progression (Execution Service)
- Interface-isolated Slack and CLI (per ADR-023)
- Deterministic-first validation with bounded LLM use (per ADR-003, ADR-033)
- Immutable observability and replay (per ADR-019)
- Multi-project safety via scoped Git clones (per ADR-027, ADR-028)
- Human override available at every step without being required mid-sprint (per ADR-024, ADR-030)

---

# 11. Summary

The system is a **governed pipeline engine** where:

- Git defines policy and holds delivered truth
- The Execution Service enforces flow, owns Git, and persists audit
- Scripts perform deterministic work and bound the LLM
- LLMs reason inside structured contracts
- n8n and the CLI capture intent without owning logic
- Humans review at the PR, override at any step

---

# 12. Guiding Principle

> The pipeline runs. Humans review the result.
> Intervention is available at any point, but never required mid-sprint.
> The PR is the gate. Merge is the approval.
