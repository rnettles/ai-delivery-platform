# Workflow Process Runbook
## AI Delivery Platform — Human Operator Guide

**Audience:** Human operators running the AI delivery pipeline (developers, tech leads)  
**Last updated:** 2026-04-20  
**Authority:** ADR-003 (Hard Stop A), ADR-008 (Human-AI Authority Boundary), ADR-031 (Three-Layer Governance)

---

## Overview

This runbook describes the end-to-end workflow from intake to deployment. It defines what the
human operator must do at each gate. The AI pipeline handles implementation — the human operator
controls all approval decisions.

> **Core invariant (ADR-008):** AI agents produce Draft artifacts. Only human operators advance
> artifacts to approved/accepted states. No AI may self-approve its own output.

---

## Human vs. AI Responsibility by Artifact

| Artifact | AI Role | Human Role |
|---|---|---|
| Intake item (`INTAKE.md`) | Reads intake; drafts downstream artifacts | **Creates** intake. Sets `status: accepted` after FRD approval |
| FRD (`Status: Draft`) | **Creates** Draft FRDs from intake context | Reviews content |
| FRD (`Status: Approved`) | Cannot set | **Sets `Status: Approved`** — this gates phase planning |
| ADR (`Status: Proposed`) | **Creates** Proposed ADRs | Reviews content |
| ADR (`Status: Accepted`) | Cannot set | **Sets `Status: Accepted`** — makes ADR binding |
| TDN (`Status: Draft`) | **Creates** Draft TDNs | Reviews content |
| TDN (`Status: Approved`) | Cannot set | **Sets `Status: Approved`** — gates Sprint 1 staging |
| Phase plan (`Status: Draft`) | **Creates** Draft phase plan | Reviews content |
| Phase plan (approved) | Cannot approve | **Clicks Approve / `/approve`** (Hard Stop A — ADR-003) |
| Sprint plan (`Status: Draft`) | **Creates** Draft sprint plan | Reviews content |
| Sprint plan (approved) | Cannot approve | **Clicks Approve** at gate message |
| Implementation commits | **Implements** and commits | Reviews, merges PR |

---

## Gate Sequence Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Human writes intake (INT-*)                     HUMAN AUTHORITY        │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ /plan intake <intake-path>
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Planner (Intake Drafting Mode)                  AI DRAFTS              │
│  Produces: Draft FRDs, PRD amendments                                   │
│  Stops — surfaces drafts for human review                               │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  GATE 1 — Human reviews AI drafts                HUMAN AUTHORITY        │
│  • Review each Draft FRD for accuracy and completeness                  │
│  • Edit FRDs as needed                                                  │
│  • Set FRD Status: Approved (in each FRD file)                          │
│  • If ADRs or TDNs needed: draft them (AI) then approve them (human)    │
│  • Set intake status: accepted                                          │
│  ─ GATE 1 BLOCKED until at least one FRD is Status: Approved ─          │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ /plan next-flow <description>
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Planner (Phase Planning Mode)                   AI DRAFTS              │
│  Reads: only Status: Approved FRDs                                      │
│  Produces: Draft phase plan                                             │
│  Stops if no Approved FRDs exist — surfaces Draft FRDs instead          │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  GATE 2 (Hard Stop A — ADR-003)                  HUMAN AUTHORITY        │
│  • Review Draft phase plan (scope, FR traceability, design artifacts)   │
│  • Click ✅ Approve or /approve <pipeline-id>                            │
│  ─ GATE 2 BLOCKED until human explicitly approves ─                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ Sprint Controller → Implementer → Verifier
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AI Coding Pipeline                              AI IMPLEMENTS           │
│  Sprint Controller stages sprints                                       │
│  Implementer codes tasks                                                │
│  Verifier runs tests                                                    │
│  Each gate requires human approval                                      │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Deployment                                      HUMAN AUTHORITY        │
│  • Human reviews and merges PR                                          │
│  • Human deploys to production                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 1 — Greenfield Feature (New Intake to Deployment)

**Use when:** Adding a new capability that does not exist in the system.

### Step 1 — Create intake
```
project_work/ai_project_tasks/intake/INT-YYYYMMDD-01/INTAKE.md
```
Fields required: Problem Statement, Findings Summary, Proposed Changes.

### Step 2 — Run Planner in intake-drafting mode
```
/plan intake project_work/ai_project_tasks/intake/INT-YYYYMMDD-01/INTAKE.md
```
AI drafts FRDs and PRD amendments. All output is `Status: Draft`.

### Step 3 — Review and approve FRDs (Gate 1)
1. Open each Draft FRD the Planner created.
2. Edit for accuracy, completeness, and testability.
3. Set `Status: Approved` in the frontmatter of each FRD you approve.
4. If architecture decisions are needed: ask AI to draft ADRs, review them, set `Status: Accepted`.
5. If TDNs are needed: ask AI to draft TDNs, review them, set `Status: Approved`.
6. Set intake `status: accepted` in `INTAKE.md`.

### Step 4 — Run Planner in phase-planning mode (Gate 2 / Hard Stop A)
```
/plan next-flow Build [feature name] based on approved FRDs
```
AI reads approved FRDs and produces a Draft phase plan. Review the plan and click **✅ Approve**.

### Step 5 — Let the coding pipeline run
```
/sprint next-flow PH-{STREAM}-1
```
Sprint Controller → Implementer → Verifier run automatically. Approve each gate as prompted.

### Step 6 — Review and merge PR
When Verifier posts PASS, review the PR in your Git host and merge.

---

## Flow 2 — Change to Existing Feature (Intake Required)

**Use when:** An existing FRD, ADR, or implementation needs to change.

Same steps as Flow 1. The key difference: in Step 2, the Planner produces amendments to existing
FRDs (adding/updating FR items) rather than entirely new FRDs. Review amendments carefully — the
`Status: Approved` step locks in the updated requirements before planning begins.

> If the change is architectural: an ADR must be created (`Status: Proposed` → human sets
> `Status: Accepted`) before phase planning proceeds.

---

## Flow 3 — Post-Incident Reconciliation

**Use when:** A P0/P1 fix was deployed outside normal planning (bypassed intake).

### Step 1 — Open reconciliation intake within 48 hours
```
project_work/ai_project_tasks/intake/INT-YYYYMMDD-P1-RECONCILE/INTAKE.md
```
Required fields: Problem Statement, Root Cause Analysis, What Bypassed Planning, Proposed FR Changes.

### Step 2 — AI drafts reconciliation FRDs
```
/plan intake project_work/ai_project_tasks/intake/INT-YYYYMMDD-P1-RECONCILE/INTAKE.md
```

### Step 3 — Human reviews and approves (Gate 1)
Review whether the emergency implementation matched the intent. Approve FRDs that accurately
reflect what was deployed. Note any deviations as new FR gaps.

### Step 4 — Proceed with normal planning for remaining gaps
Any FR gaps identified become new intake items. Run Flow 1 for each.

---

## Common Failure Modes and Recovery

### Problem: Planner returns `NO_APPROVED_FRDS` error

**Cause:** You invoked `/plan` in phase-planning mode but no FRD in the project has `Status: Approved`.

**Recovery:**
1. Run `/plan intake <intake-path>` to get Draft FRDs from the AI.
2. Review and approve the FRDs (Gate 1 above).
3. Re-run `/plan next-flow <description>`.

---

### Problem: Planner produces a phase plan that references no FR IDs

**Cause:** FR documents are present but contain no recognizable FR identifiers (e.g., `FR-001`).

**Recovery:**
1. Open your FRD files and ensure each functional requirement has a unique ID (e.g., `FR-AUTH-001`).
2. Re-run `/plan next-flow <description>`.

---

### Problem: Gate 1 — FRD approved but Planner still returns `NO_APPROVED_FRDS`

**Cause:** The `Status: Approved` text may not match exactly, or the FRD is in a directory not
scanned by the gate service (`FR_ROOTS` = `docs/functional_requirements`, `docs/prd`).

**Recovery:**
1. Confirm the FRD file contains exactly `Status: Approved` (case-sensitive) in the frontmatter.
2. Confirm the FRD is in `docs/functional_requirements/` or `docs/prd/`.
3. Re-run `/plan next-flow <description>`.

---

### Problem: AI set intake status to `accepted` without human review

**Cause:** This should not happen after ADR-008 enforcement. If it does, it is a governance violation.

**Recovery:**
1. Reset intake `status` to `open` manually.
2. Review all AI-drafted artifacts that were downstream of the unauthorized acceptance.
3. Open an intake item (INT-*-RECONCILE) to track the remediation.
4. File a bug against the platform gate service to enforce the ADR-008 boundary.

---

### Problem: ADR conflict flagged in phase plan

**Cause:** The Planner found a conflict between the proposed phase and an Accepted ADR.

**Recovery:**
1. Review the ADR and the proposed phase to understand the conflict.
2. Option A: Adjust the requirements to conform to the ADR.
3. Option B: Create a new ADR that supersedes the old one. Mark the old ADR `Superseded`.
   Set the new ADR to `Status: Accepted` before re-running the Planner.

---

## Quick Reference — Human-Approval Checklist Before Each Gate

### Before Gate 1 (FRD Approval)
- [ ] Each Draft FRD accurately reflects the intake intent
- [ ] All affected functional requirements are captured with unique IDs
- [ ] Acceptance criteria are measurable and falsifiable
- [ ] Required ADRs are `Status: Accepted`
- [ ] Required TDNs are `Status: Approved`
- [ ] FRD file is in `docs/functional_requirements/` or `docs/prd/`
- [ ] FRD frontmatter contains exactly `Status: Approved`
- [ ] Intake `status: accepted` is set in `INTAKE.md`

### Before Gate 2 / Hard Stop A (Phase Plan Approval)
- [ ] Phase plan references correct, approved FRDs
- [ ] `fr_ids_in_scope` is non-empty and matches actual FR identifiers
- [ ] No ADR conflicts remain unresolved in `required_design_artifacts`
- [ ] TDNs listed as Required are acknowledged (will be drafted before Sprint 1)
- [ ] Phase scope is appropriate (not over-scoped or under-scoped)

---

## Related Documents

- [ADR-003](../../ai-project_template/docs/adr/ADR-003-hard-stop-A-gate.md) — Hard Stop A gate
- [ADR-008](../../ai-project_template/docs/adr/ADR-008-human-ai-authority-boundary.md) — Human-AI Authority Boundary
- [ADR-031](../../ai-project_template/docs/adr/ADR-031-three-layer-governance.md) — Three-Layer Governance
- [user-flow-runbook.md](user-flow-runbook.md) — Slash command reference and platform flows
- [AI_INTAKE_PROCESS.md](../../ai-project_template/ai_dev_stack/ai_guidance/AI_INTAKE_PROCESS.md) — Intake lifecycle detail
- [AI_DESIGN_PROCESS.md](../../ai-project_template/ai_dev_stack/ai_guidance/AI_DESIGN_PROCESS.md) — ADR/TDN lifecycle detail
