# Runtime Loading Rules

## Purpose

Canonical staged retrieval rules for deterministic document loading during automated pipeline task execution.

## Stage A (Always Load)

1. `AI_IMPLEMENTATION_BRIEF.md` — primary source of truth for the current task
2. `current_task.json` — task identity and acceptance criteria
3. `verification_result.json` — for verifier and fixer roles only

## Stage B (Conditional — resolved from task_flags)

Load only when task flags demand it:

- `fr_ids_in_scope` not empty: load referenced functional requirement sections
- `architecture_contract_change: true`: load referenced architecture docs
- `ui_evidence_required: true`: load UI test guidance and evidence references
- `incident_tier in [p0, p1]`: load governance incident or reconciliation sections required by the brief

## Stage C (Evidence-Driven)

Load additional files only when a concrete failure or correction references them:

- Failing test file
- Failing module path
- Referenced verifier correction item
- Directly cited doc path from CI or review output

## Determinism Rules

- The same task flags must resolve to the same Stage B document set across runs.
- Do not expand Stage B loads based on intuition or convenience.
- If a needed doc is not covered by the flags, load it only under Stage C with an evidence link.

## Hard Rule

Do not load onboarding or setup documents during the implementation loop unless the user explicitly requests them.
