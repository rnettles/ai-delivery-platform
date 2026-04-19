# ADR-025: Two-Tier Governance Composition Model

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The platform requires AI governance content to guide role execution: system prompts, behavioral rules, output schemas, handoff contracts, and role-specific templates.

Two distinct governance audiences exist:

**1. Human-driven agents (VSCode Copilot Chat)**
Developers interact with AI agents in VSCode. Governance for these agents is loaded automatically from dotfiles — a shared, user-scoped configuration applied across all projects whenever a workspace opens. This provides universal rules (role boundaries, commit standards, review checklists) that apply consistently to any project a developer works on.

**2. Automated pipeline roles (Execution Service)**
The Execution Service runs role scripts (planner, sprint-controller, implementer, verifier, fixer) autonomously as part of pipeline execution. These roles require governance content to be loaded at runtime — system prompts, behavioral rules, and output schemas — but this content is not accessible from dotfiles because the Execution Service has no VSCode context.

Prior to this decision, all role scripts embedded their governance content as hardcoded TypeScript string constants (`SYSTEM_PROMPT`). This violated:
- **ADR-001** (Git as source of truth) — governance not version-controlled as discrete artifacts
- **ADR-004** (Governance-first architecture) — governance embedded in code, not loaded from the governed content layer
- **ADR-018** (Execution determinism) — governance and code versions not independently addressable

Additionally, the system must support a long-term pattern where the platform **generates** per-project governance artifacts for human agents. Currently this is a manual process: developers clone `ai-project_template` and adapt its `ai_dev_stack/ai_guidance/` contents. The platform should eventually automate this as a pipeline output.

---

## Decision

The platform SHALL implement a **Two-Tier Governance Composition Model**.

### Tier 1 — Universal Governance (dotfiles)

Universal rules that apply to all AI agents, in all projects, at all times.

- **Owner**: dotfiles repository (`~/.agents/`)
- **Scope**: Any AI agent operating in any VSCode workspace
- **Loaded by**: VSCode automatically on workspace open
- **Contents**: Role boundary rules, commit standards, safety constraints, general review checklists
- **Change cadence**: Infrequent; applies globally to all projects

The Execution Service has no dependency on Tier 1. Tier 1 content is authored to be consistent with Tier 2 principles; when Tier 1 changes, a Tier 2 governance review MUST be performed to detect drift.

### Tier 2 — Platform Governance (platform/governance/)

Platform-specific governance for automated pipeline role execution.

- **Owner**: `ai-delivery-platform` repository
- **Scope**: Execution Service role scripts only
- **Loaded by**: Role scripts at runtime from the filesystem
- **Contents**: Role system prompts, behavioral rules, output schemas, handoff contracts, role-specific templates
- **Change cadence**: Tied to Execution Service release cycle (versioned with Docker image)

---

## Governance Content Structure

The platform governance layer SHALL be organized as:

```
platform/governance/
  manifest.json               — governance version + content registry
  prompts/                    — role system prompts (one file per role)
    role-planner.md
    role-sprint-controller.md
    role-implementer.md
    role-verifier.md
    role-fixer.md
  rules/                      — behavioral rules loaded by role scripts
    global_rules.md           — applies to all roles; mirrors Tier 1 principles
    runtime_loading_rules.md  — Stage A/B/C artifact loading contract
    runtime_gates.md          — execution gates (lint, typecheck, tests)
    handoff_contract.md       — handoff JSON contract schema
    task_flags_contract.md    — task flag schema
  schemas/                    — JSON schemas for structured outputs
    phase_plan.schema.json
    sprint_plan.schema.json
    task.schema.json
  templates/                  — per-project governance artifact templates
    AI_CONTEXT.md
    AI_RULES.md
    AI_RUNTIME_POLICY.md
```

---

## Loading Strategy

### Phase 1 (current): Bundled in Docker image

Governance content is included in the Docker image at build time. Role scripts load from a filesystem path resolved relative to the application root.

- **Determinism**: Governance version is locked to image version
- **Update path**: Governance changes require a new Docker image build and deployment
- **Simplicity**: No runtime dependency on Azure Files or Git sync

This is the correct strategy during the current phase of the platform. It ensures deterministic execution (ADR-018) without requiring the git-sync infrastructure of ADR-011 to be complete first.

### Phase 2 (future): Loaded from Azure Files at runtime

Once the git-sync infrastructure (ADR-011) is fully implemented, governance content will be loaded from the mounted Azure Files share (`/mnt/repo`), which is kept in sync with the authoritative Git repository.

This enables governance updates without redeployment and fully realizes ADR-001 and ADR-011 at runtime. The `manifest.json` version will be used to detect governance drift between the running version and the latest committed version.

---

## Per-Project Governance Generation

The platform SHALL treat per-project governance artifact generation as a **pipeline output responsibility of the sprint-controller role**.

When the platform manages a project, the sprint-controller role SHALL generate the project's `ai_dev_stack/ai_guidance/` directory using templates from `platform/governance/templates/`. This automates the process currently performed manually by developers cloning `ai-project_template`.

This creates a direct lineage:
```
platform/governance/templates/ → (sprint-controller generates) → project/ai_dev_stack/ai_guidance/
```

Human agents operating in a project workspace receive governance content that was generated and versioned by the platform, ensuring consistency between automated and human-driven execution.

---

## manifest.json Contract

```json
{
  "version": "2026.04.19",
  "roles": {
    "planner": { "prompt": "prompts/role-planner.md" },
    "sprint-controller": { "prompt": "prompts/role-sprint-controller.md" },
    "implementer": { "prompt": "prompts/role-implementer.md" },
    "verifier": { "prompt": "prompts/role-verifier.md" },
    "fixer": { "prompt": "prompts/role-fixer.md" }
  },
  "rules": {
    "global": "rules/global_rules.md",
    "runtime_loading": "rules/runtime_loading_rules.md",
    "runtime_gates": "rules/runtime_gates.md",
    "handoff_contract": "rules/handoff_contract.md",
    "task_flags": "rules/task_flags_contract.md"
  },
  "schemas": {
    "phase_plan": "schemas/phase_plan.schema.json",
    "sprint_plan": "schemas/sprint_plan.schema.json",
    "task": "schemas/task.schema.json"
  }
}
```

---

## Consequences

### Positive
- Governance content is version-controlled as discrete artifacts (ADR-001 compliant)
- Role scripts load governance at runtime rather than embedding it (ADR-004 compliant)
- Governance version is independently addressable from code version (ADR-018 compliant)
- Per-project governance can be generated by the platform, eliminating manual template cloning
- Tier 1 (dotfiles) remains unchanged — no disruption to human agent workflows

### Negative
- Role scripts must be updated to load from filesystem instead of using embedded string constants
- Phase 1 (bundled) requires image rebuild to update governance; this is intentional but adds a step
- Tier 1/Tier 2 drift must be managed manually during Tier 1 updates — no automated sync

### Neutral
- `ai-project_template` remains a valid reference and is not deprecated; it serves as the initial source for Tier 2 content migration
- Governance file paths are deterministic; role scripts use `manifest.json` as the single discovery point

---

## Related ADRs
- ADR-001: Git as Source of Truth
- ADR-004: Governance-First Architecture
- ADR-005: Role-Based Execution Model
- ADR-010: Azure Files Persistent Storage
- ADR-011: Execution Service Owns Git Operations
- ADR-017: Script Registry Execution Model
- ADR-018: Execution Determinism
- ADR-022: Multi-Agent Pipeline Execution Model
