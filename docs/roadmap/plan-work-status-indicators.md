# Plan: Work Status Indicators

**File:** `docs/roadmap/plan-work-status-indicators.md`

## Problem

The work details page (`/projects/[id]/work`) shows project-level phases, sprints, and tasks.
Each item already carries a derived `WorkStatus` of `done | current | pending`.
However, items that are waiting for human action (gate approval or PR merge) are indistinguishable from actively-running items — both show as "Active" / blue.

Operators need a clear visual cue when a sprint or task is **blocked on human approval** before they can take action.

## Approach

Extend the `WorkStatus` union with two new states:

| State | Trigger | Badge |
|---|---|---|
| `approval` | sprint/phase status is `awaiting_approval` or `ready_for_verification` | Amber — "Needs Approval" |
| `pr_review` | sprint/phase status is `awaiting_pr_review` | Purple — "PR Review" |

This requires changes to three frontend files only; no backend changes needed.

## Tasks

- [x] Create this plan file
- [ ] Extend `WorkStatus` type and `WorkPhase`/`WorkSprint` interfaces in `hooks/useProjectWork.ts`
- [ ] Update `derivePhaseStatus` and `deriveSprintStatus` to map approval-state status strings
- [ ] Add `approval` and `pr_review` badge configs to `components/work/WorkStatusBadge.tsx`

## Files Changed

- `platform/frontend/hooks/useProjectWork.ts`
- `platform/frontend/components/work/WorkStatusBadge.tsx`

## Constraints

- No backend changes
- No new dependencies
- No changes to the pipeline detail view or StagedWorkPanel
