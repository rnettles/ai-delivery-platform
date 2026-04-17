# How n8n Uses the Governance Manifest

## Overview

This document describes how the n8n orchestration layer interacts with the Governance Manifest stored in:

```
\ai_dev_stack\ai_guidance\governance_manifest.json
```

n8n does not contain governance logic. It dynamically loads and executes based on the manifest.

---

## Execution Flow

### Step 1 — Load Governance Manifest

n8n loads the manifest from the Git repository.

**Purpose:**
- Retrieve role definitions
- Retrieve prompts, rules, templates
- Retrieve expected outputs and validation rules

---

### Step 2 — Resolve Role Configuration

Based on the current workflow state, n8n determines the active role.

Example:
```
role = "planner"
```

n8n extracts:
- Prompt path
- Ruleset paths
- Template paths
- Output definitions
- Validation rules
- State transitions

---

### Step 3 — Build Execution Contract

n8n constructs a structured execution contract:

```
{
  "workflow_id": "...",
  "role": "...",
  "governance_refs": {...},
  "context_refs": {...},
  "expected_outputs": [...]
}
```

**Purpose:**
- Standardize all role execution inputs
- Ensure deterministic behavior

---

### Step 4 — Load Context and Templates

n8n (or supporting scripts) loads:

- Governance prompts
- Rules documents
- Templates
- Relevant artifacts (Phase, Sprint Plan, etc.)

---

### Step 5 — Invoke LLM (Bounded)

n8n sends a structured prompt to the LLM.

**LLM responsibilities:**
- Interpret input
- Generate structured JSON output
- Fill content sections only

---

### Step 6 — Deterministic Post-Processing

After LLM execution:

- Parse JSON output
- Render templates using deterministic code
- Write artifacts to Git-controlled paths
- Apply naming and folder conventions

---

### Step 7 — Validate Outputs

n8n performs validation using manifest rules.

**Phase 1 (Level 1 Validation):**
- Artifact existence
- Required sections present

If validation fails:
- Pause workflow
- Flag for review

---

### Step 8 — Transition Workflow State

n8n updates runtime state in Postgres based on manifest transitions.

Example:
```
on_success → ready_for_staging
on_failure → planning_failed
```

---

## Key Principles

- n8n does NOT define business logic
- All rules are loaded from Git
- State progression is artifact-driven
- Validation gates all transitions
- LLM is used only for reasoning and content generation

---

## Summary

n8n acts as an execution engine that:

1. Loads governance rules from Git
2. Builds execution context
3. Invokes bounded AI roles
4. Validates outputs deterministically
5. Transitions workflow state safely

This ensures:
- No duplication of logic
- Strong governance alignment
- Predictable, reproducible execution
