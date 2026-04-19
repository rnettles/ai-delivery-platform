# Global Rules — AI Delivery Platform

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

- Do not implement behavior that contradicts an Accepted ADR; flag the conflict instead.
- Do not invent component interfaces or field schemas not specified in an approved design document.

## Governance Source of Truth

These rules are loaded from `platform/governance/` (ADR-025).
Role prompts, schemas, and contracts are versioned with the governance manifest.
