# ADR-031: Three-Layer Governance Authority and Code-Level Invariant Enforcement

## Status
Accepted

## Date
2026-04-25

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

ADR-025 established a two-tier governance composition model:

| Tier | Location | Audience |
|---|---|---|
| Tier 1 | `~/.agents/` (dotfiles) | VSCode human agents, all projects |
| Tier 2 | `platform/governance/` | Execution Service automated roles |

ADR-026 declared that `ai-project_template` is superseded as the source for *per-project governance content generation* — the sprint-controller role is now responsible for generating project-level `ai_dev_stack/ai_guidance/` artifacts.

Both decisions resolved the right problems for their scope. However, neither addressed a different and more fundamental concern: **who defines the process rules that govern the platform's own execution behaviour?**

The gap has two symptoms.

### Symptom 1 — The Platform Has No Invariant Layer

`platform/governance/prompts/role-planner.md` defines what the Planner LLM receives as its system prompt. It currently contains only platform-specific mechanics: the JSON output schema, field constraints, and output discipline rules.

The process rules — no new phase if one is already open; no sprint staging until FR IDs are valid; never push to `main`; planner plans only — live in `ai-project_template/ai_dev_stack/ai_guidance/AI_RULES.md` and in the dotfiles agent definitions (`planner.agent.md`). These are loaded by human agents in VSCode chat sessions. They are never loaded by the Execution Service.

**The Execution Service has no programmatic awareness of process rules.** A developer editing `role-planner.md` to add a field can also remove a lifecycle gate without any code catching it. The LLM receives only whatever the Layer 3 prompt file says.

### Symptom 2 — No Hard Enforcement in TypeScript

The four role scripts (`role-planner.script.ts`, `role-sprint-controller.script.ts`, `role-implementer.script.ts`, `role-verifier.script.ts`) perform no pre-condition checks before invoking the LLM and no post-condition checks after receiving its output. Invariant violations — staging a new phase when one is already open, implementing more than five files in a single task — can only be caught if the LLM's prompt tells it not to, and only if the LLM obeys.

This violates ADR-003 (Deterministic Over LLM): invariant enforcement is a deterministic operation that should not depend on LLM compliance.

### Scope Clarification vs. ADR-026

ADR-026 governs what the platform *generates for managed projects* — the per-project `ai_dev_stack/ai_guidance/` contents that human developers load in VSCode when working on a platform-managed project. That remains unchanged.

This ADR governs the process rules that constrain the **platform's own role execution** — what the Execution Service itself must comply with when running Planner, Sprint Controller, Implementer, and Verifier. These two concerns are orthogonal.

The source of the process rules is `ai-project_template/ai_dev_stack/ai_guidance/AI_RULES.md`. That file is not superseded for this purpose. It is the human-readable canonical authority for *what the governance process requires*. The platform must implement those requirements in code.

---

## Decision

The platform SHALL implement a **Three-Layer Governance Authority Model** with two code-level enforcement vectors.

### Layer Definitions

| Layer | Location | Purpose | Constraint |
|---|---|---|---|
| **Layer 1 — Process Invariants** | `ai-project_template/ai_dev_stack/ai_guidance/AI_RULES.md` | Defines *what* the governance process requires: lifecycle gates, role boundaries, artifact requirements, safety rules, implementation limits | Authoritative. No downstream layer may override. |
| **Layer 2 — Human-Session Mechanics** | `dotfiles/.github/agents/*.agent.md` | Defines *how* human-in-the-loop execution works: "Always Load" sequences, operator confirmation gates, HARD STOPs, chat-session bootstrapping | Additive only. Adds mechanics on top of Layer 1. No code equivalent. |
| **Layer 3 — Platform Mechanics** | `platform/governance/` | Defines *how* the Execution Service invokes roles: JSON output schemas, prompt engineering, manifest-driven loading, LLM configuration | Additive only. Adds mechanics on top of Layer 1. Must not redefine process rules. |

### Additive-Only Constraint

Layers 2 and 3 MAY add mechanics specific to their execution context. They MUST NOT redefine, override, relax, or remove any constraint established by Layer 1.

Any conflict between a Layer 3 governance file and a Layer 1 invariant is a defect in the Layer 3 file.

### Enforcement Vector 1 — Composed System Prompts

Every LLM call made by an Execution Service role script SHALL receive a composed system prompt, not the Layer 3 role prompt alone.

`GovernanceService` SHALL expose a `getComposedPrompt(role: string): Promise<string>` method that:

1. Loads the **process invariants** from `platform/governance/rules/process_invariants.md` (the Layer 1 distillation for platform context — see below)
2. Loads the **role-specific mechanics** from the role's Layer 3 prompt file (`platform/governance/prompts/role-{role}.md`)
3. Returns a composed prompt in this exact structure:

```
## PROCESS INVARIANTS (non-overridable)
{process_invariants content}

## ROLE-SPECIFIC MECHANICS
{role prompt content}
```

This ensures the LLM always receives the process rules regardless of what the Layer 3 prompt file contains. A Layer 3 edit cannot remove the invariant section.

All four role scripts (`role-planner.script.ts`, `role-sprint-controller.script.ts`, `role-implementer.script.ts`, `role-verifier.script.ts`) SHALL call `getComposedPrompt` instead of `getPrompt`.

### Enforcement Vector 2 — TypeScript Pre/Post-Condition Guards

Role scripts SHALL enforce critical invariants in TypeScript, independently of LLM output.

**Pre-condition guards** run before the LLM call and block execution if an invariant would be violated:

| Role | Invariant | Error code | Source rule |
|---|---|---|---|
| Planner | No new phase if any phase has status `Draft`, `Planning`, or `Active` | `OPEN_PHASE_EXISTS` (HTTP 409) | AI_RULES.md §Phase Rules, `planner.agent.md` Rule 5 |
| Sprint Controller (setup) | No new sprint if any sprint has status `Planning`, `Active`, or `ready_for_verification` | `OPEN_SPRINT_EXISTS` (HTTP 409) | AI_RULES.md §Phase Rules, `planner.agent.md` Rule 6 |

**Post-condition guards** run after the LLM output is parsed and block completion if the output violates an invariant:

| Role | Invariant | Error code | Source rule |
|---|---|---|---|
| Implementer | `files_changed.length > 5` | `INVARIANT_VIOLATION` (HTTP 422) | AI_RULES.md §Implementation Limits |

Pre/post-condition guards SHALL throw `HttpError` — they are hard failures, not warnings. Invariant violations block the pipeline step. The pipeline records the error, and the operator must resolve the condition before resubmitting.

### The Process Invariants File

`platform/governance/rules/process_invariants.md` is a **Layer 1 distillation artifact**: a concise, platform-context-appropriate extraction of the invariants from `AI_RULES.md`. It is not a new authority — it is a projection of the Layer 1 authority into the platform governance filesystem so that `GovernanceService` can load it at runtime.

This file:
- Is registered in `manifest.json` under `rules.process_invariants`
- Covers: role boundary rules, phase lifecycle gates, sprint lifecycle gates, implementation limits, safety rules, design artifact rules
- SHALL NOT contain Layer 3 mechanics (JSON schemas, pipeline IDs, execution service specifics)
- SHALL be kept in sync with `AI_RULES.md` invariant sections; drift is a governance defect
- Is the target of any future automated drift-detection CI gate

### Layer 3 Governance File Declarations

All files under `platform/governance/rules/` and `platform/governance/prompts/` SHALL open with a Layer 3 declaration stating:
- That the file is Layer 3 (Platform Mechanics)
- That it MUST NOT redefine process invariants
- That process invariants are injected separately via `getComposedPrompt`

This is a structural convention, not a machine-enforced constraint. It makes the additive-only boundary visible to developers editing these files.

---

## Consequences

### Positive

- **LLM-level protection**: Every role script's LLM call receives process invariants regardless of Layer 3 edits. A developer editing `role-planner.md` to change the JSON schema cannot inadvertently remove the phase lifecycle rules from the LLM's context.
- **Code-level protection**: Pre/post-condition guards enforce critical invariants deterministically, independent of LLM compliance. Phase double-staging and implementation overruns are blocked in TypeScript, not trusted to the LLM.
- **Visible boundary**: Layer 3 declarations in each governance file make the additive-only constraint visible at the point of edit. Developers see the boundary before making changes.
- **Drift-gate foundation**: `process_invariants.md` provides a stable, machine-readable target for a future CI gate comparing it against `AI_RULES.md`.
- **Clarified ADR-026 scope**: The ADR-026 supersession of `ai-project_template` applies to *per-project content generation*. `AI_RULES.md` remains the canonical authority for *what process rules the platform must implement*. These are now explicitly distinct concerns.

### Negative

- **process_invariants.md requires manual maintenance**: When `AI_RULES.md` is updated, `process_invariants.md` must be updated to match. Drift between them is silent until a CI gate is implemented.
- **Partial coverage**: Pre/post-condition guards cover only the three most critical invariants in the first implementation. FR ID validation and TDN approval gates require query APIs that do not yet exist.
- **Layer 2 has no code equivalent**: The human-session operator confirmation patterns (HARD STOPs, explicit sprint close-out confirmation gates) cannot be enforced in code. They remain chat-session conventions.

### Neutral

- n8n workflow definitions require no changes: they invoke the Execution Service via HTTP. Pre/post-condition guards apply automatically through the API layer.
- The existing `getPrompt` method in `GovernanceService` is retained for cases where a prompt without invariant injection is needed (e.g., diagnostic tooling).

---

## Deferred Decisions

- **Automated drift gate (CI)**: A GitHub Actions step that reruns a diff between `AI_RULES.md` invariant sections and `process_invariants.md`, failing if they diverge. Deferred — requires deciding which sections of `AI_RULES.md` are "invariant" vs. "human-mechanic" in a machine-parseable way.
- **FR ID validation guard**: Pre-condition in `role-sprint-controller` verifying `fr_ids_in_scope` exist in the project's FR index. Deferred — no FR index query API exists yet.
- **TDN approval gate**: Pre-condition preventing `Planning → Active` advancement if required TDNs are not `Status: Approved`. Deferred — no design artifact status query API exists.

---

## Related ADRs

- ADR-003: Deterministic Over LLM — process invariant enforcement must not rely on LLM compliance
- ADR-004: Governance-First Architecture — invariants must be governed content, not hardcoded strings
- ADR-025: Two-Tier Governance Composition Model — this ADR adds a Layer 1 authority above the existing Tier 1/Tier 2 split
- ADR-026: Platform-Owned AI Governance Content — this ADR clarifies the scope of ADR-026's supersession; `AI_RULES.md` remains authoritative for process rules governing the platform itself
