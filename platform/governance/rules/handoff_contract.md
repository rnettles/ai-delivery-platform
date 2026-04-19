# Handoff Contract

## Purpose

Canonical compact handoff object for verifier, fixer, and sprint-controller lifecycle transitions.

## Required Fields

- `changed_scope`: concise list of files, modules, or surfaces changed in the current task
- `verification_state`: `pass` | `fail` | `not_run`
- `open_risks`: compact list of unresolved risks, or an empty array
- `next_role_action`: exact next action expected from the downstream role
- `evidence_refs`: list of supporting artifact paths or correction references

## Usage Rules

- Use this structure instead of narrative summaries in active handoff artifacts.
- Keep values compact and action-oriented.
- Active handoff artifacts are overwrite-only and must contain only the current task state.

## PASS Example

```json
{
  "changed_scope": ["platform/backend-api/src/services/governance.service.ts"],
  "verification_state": "pass",
  "open_risks": [],
  "next_role_action": "Sprint Controller archives task artifacts and closes the task.",
  "evidence_refs": [
    "artifacts/{pipeline_id}/verification_result.json"
  ]
}
```

## FAIL-to-Fixer Example

```json
{
  "changed_scope": ["platform/backend-api/src/scripts/role-planner.script.ts"],
  "verification_state": "fail",
  "open_risks": ["governance path not resolved in container environment"],
  "next_role_action": "Fixer updates only the failed files and re-runs verification.",
  "evidence_refs": ["artifacts/{pipeline_id}/verification_result.json"]
}
```
