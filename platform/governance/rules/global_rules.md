# Global Rules — AI Delivery Platform

> **Layer 3 — Platform Mechanics**
> This file defines platform-specific runtime constraints for Execution Service roles.
> It MUST NOT redefine, override, relax, or remove any rule from `process_invariants.md`.
> Process invariants are injected into every system prompt separately via `getComposedPrompt()`.
> See ADR-031 for the three-layer governance authority model.

Applies to all automated pipeline roles (planner, sprint-controller, implementer, verifier, fixer).

## Role Boundaries

- Do not perform the work of another role.
- Planner determines WHAT. Sprint Controller determines HOW (task structure). Implementer describes the changes. Verifier evaluates. Fixer corrects.
- Do not expand scope beyond the current task.

## Safety Rules

- Never delete files unless explicitly instructed.
- Never modify database migrations unless required by the current task.
- Never refactor unrelated modules.
- Do not implement future sprint tasks.

## Implementation Limits (Standard Mode)

- Modify no more than 5 files per task.
- Keep changes under 200 lines of code per task.

> **Policy Precedence — RUL-007 Platform Override (Phase 8, 2026-04-28):**
> The governance baseline (ai-project_template) allows up to 7 files and ~400 LOC in standard mode
> and 12–15 files / 1200–1500 LOC in fast-track mode. The platform tightens this unconditionally
> to 5 files / 200 LOC. This is an intentional, operator-approved narrowing recorded here as the
> authoritative precedence decision for this platform deployment. Rationale: simpler task
> decomposition reduces merge-conflict surface and keeps verifier gate latency low. The platform
> does not implement a fast-track file/LOC escalation path; any task legitimately exceeding these
> limits must be decomposed into multiple tasks by the Sprint Controller. Any future relaxation
> requires an ADR update to global_rules.md, not a prompt-only change.
> **Override authority:** platform operator (ai-delivery-platform owner) — ADR-031 Layer 3.

## Code Quality

- Follow existing project conventions.
- Prefer explicit typing.
- Avoid overly complex abstractions.

## Testing

- All new behavior must have tests.
- Tests must include: success case, failure case, and edge case.

## Output Discipline

- Output ONLY valid JSON unless the role's prompt specifies otherwise.
- Do NOT wrap output in markdown code fences.
- Do NOT include prose or explanation outside the JSON structure.

## Design Artifact Rules
- ADRs track architecture decisions. Use Status: Proposed (draft) → Accepted (binding) → Deprecated/Superseded.
- TDNs track technical design notes. Use Status: Draft → In Review → Approved (binding) → Superseded.
- Do not implement against a Proposed ADR or Draft TDN — these require human approval before they become binding.
- Do not implement behavior that contradicts an Accepted ADR; flag the conflict instead.
- Do not invent component interfaces or field schemas not specified in an approved design document.
- AI agents operate under the human-AI authority boundary (ADR-008): produce Draft/Proposed artifacts only;
  only human operators may set Status: Approved (FRDs, TDNs) or Status: Accepted (ADRs).

## Governance Source of Truth

These rules are loaded from `platform/governance/` (ADR-025).
Role prompts, schemas, and contracts are versioned with the governance manifest.
