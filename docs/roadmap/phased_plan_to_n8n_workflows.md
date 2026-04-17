# Phased Plan to n8n Workflows Design

## Overview
This document maps the phased implementation plan to concrete n8n workflows, aligning with the AI Governance system.

Core principle:
- Git = governance + artifacts
- n8n = orchestration
- Postgres = runtime state
- Scripts = deterministic logic
- LLM = bounded reasoning

---

# Architecture Pattern

Main Orchestrator → Subflows

Reusable subflows:
- sf_load_governance_manifest
- sf_build_execution_contract
- sf_execute_role
- sf_render_artifacts
- sf_validate_artifacts
- sf_transition_state

---

# Phase 1 — Foundation

Workflow: wf_orchestrator_entry

Flow:
Webhook → Normalize → Create DB Record → Load Manifest → Set State (planning)

Purpose:
- Establish intake
- Verify manifest loading
- Initialize runtime tracking

---

# Phase 2 — Planner

Workflow: wf_planner_execution

Flow:
Input → Resolve planner → Load config → Build contract → LLM → Parse JSON → Render Phase + Sprint Plan → Validate → Transition

Key:
- Templates rendered via scripts
- LLM returns JSON only

---

# Phase 3 — Sprint Controller

Workflow: wf_sprint_controller_execution

Flow:
Trigger (ready_for_staging) → Load Sprint Plan → Resolve role → Build contract → LLM → Parse → Render tasks → Validate → Transition

---

# Phase 4 — Human Approval

Workflow: wf_human_approval

Flow:
Trigger (awaiting approval) → Send Slack → Wait → Branch:
- approve → approved
- reject → rejected
- revision → return to planning/staging

---

# Phase 5 — Validation Expansion

Replace simple IF checks with script:
validate_artifacts.py

Flow:
Execute script → pass/fail → transition or pause

---

# Phase 6 — Execution Pipeline Prep

Add routing logic:
Determine next role based on state

Example:
approved → implementer

---

# Phase 7 — Hardening

Add:
- Retry logic
- Logging
- State reconciliation (Git-based)

---

# Key Design Rules

- n8n does not define business logic
- All rules come from governance manifest
- All artifacts live in Git
- Postgres stores references only
- State transitions require validation

---

# Summary

This mapping provides a deterministic, scalable orchestration layer that:
- Enforces governance
- Supports hybrid AI/human execution
- Prevents drift
- Enables incremental system growth
