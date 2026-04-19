# Task Flags Contract

## Purpose

Canonical compact task-flag schema emitted by the sprint-controller into the active implementation brief.
Task flags control Stage B conditional loading per `runtime_loading_rules.md`.

## Required Flags

- `fr_ids_in_scope`: array of functional requirement IDs in scope (e.g. `["FR-001"]`), or empty array
- `architecture_contract_change`: `true` | `false` — set true if ADRs or architecture docs change
- `ui_evidence_required`: `true` | `false` — set true for any user-facing feature
- `incident_tier`: `"none"` | `"p0"` | `"p1"` | `"p2"` | `"p3"`

## Optional Flags

- `schema_change`: `true` | `false` — set true if a DB schema or JSON schema changes
- `migration_change`: `true` | `false` — set true if a DB migration is required
- `cross_subsystem_change`: `true` | `false` — set true if the change spans multiple services

## Behavior

All execution-role prompts use these flags to resolve Stage B conditional loading.
Flags must be emitted by the sprint-controller and included in `current_task.json`.
