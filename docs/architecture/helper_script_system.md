# Helper Script System (Production-Ready Version)
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **final, production-ready deterministic helper script system** aligned with:

- Canonical Governance (ai_dev_stack)
- Project Workspace (state + artifacts)
- n8n orchestration
- LLM bounded execution

This version removes ambiguity and enforces strict separation of concerns.

---

# 2. Core Architecture Model

## 2.1 Separation of Concerns

```
ai_dev_stack/        → Canonical Governance (REUSABLE)
project_workspace/   → Project State + Artifacts (INSTANCE)
docs/                → System Design (TRUTH)
n8n                  → Orchestration (CONTROL FLOW)
```

---

## 2.2 Mental Model

- ai_dev_stack = "brain"
- project_workspace = "memory"
- docs = "truth"
- n8n = "conductor"
- helper scripts = "hands"

---

# 3. Final Folder Structure

## 3.1 Canonical (Reusable)

```
ai_dev_stack/
└── ai_guidance/
    ├── governance_manifest.json
    ├── prompts/
    ├── rules/
    ├── templates/
    ├── schemas/
```

---

## 3.2 Project Workspace (State Engine)

```
project_workspace/
├── intake/
│   ├── features/
│   ├── bugs/
│   └── enhancements/
│
├── execution/
│   ├── planning/
│   │   ├── phases/
│   │   └── sprints/
│   ├── staging/
│   ├── active/
│   ├── validation/
│   └── completed/
│
├── artifacts/
│   ├── phases/
│   ├── sprints/
│   └── tasks/
│
├── state/
│   ├── current_state.json
│   ├── current_phase.json
│   └── current_sprint.json
│
├── logs/
└── runtime/
```

---

## 3.3 Documentation (Truth Layer)

```
docs/
├── prd/
├── architecture/
├── design/
├── functional_requirements/
├── roadmap/
├── adr/
├── features/
```

---

# 4. Project Configuration Contract

Every project MUST define:

```json
{
  "project_id": "string",
  "project_root": ".",
  "workspace_root": "project_workspace",
  "docs_root": "docs",
  "governance": {
    "ai_dev_stack_path": "../ai_dev_stack/ai_guidance",
    "manifest_path": "governance_manifest.json"
  }
}
```

---

# 5. Standard Script Interface

## Input

```json
{
  "workflow_id": "string",
  "request_id": "string",
  "role": "string",
  "project_config_path": "string",
  "payload": {}
}
```

---

## Output

```json
{
  "ok": true,
  "script": "string",
  "state_hint": "string",
  "artifacts": [],
  "data": {},
  "errors": []
}
```

---

# 6. Core Helper Scripts (Final Set)

## 6.1 load_project_config

Loads project configuration.

---

## 6.2 load_manifest

Loads governance from ai_dev_stack.

---

## 6.3 resolve_paths

Resolves ALL paths using:

- project_workspace
- docs
- governance

No hardcoded paths allowed.

---

## 6.4 build_execution_contract

Builds role-specific execution contract.

---

## 6.5 render_template

Writes ALL artifacts deterministically.

Templates ONLY from ai_dev_stack.

---

## 6.6 validate_artifacts

Validates existence + structure.

---

## 6.7 update_state (NEW)

Writes state files:

- current_state.json
- current_phase.json
- current_sprint.json

Postgres mirrors this state but is NOT source of truth.

---

# 7. State Model (Explicit)

## Valid States

```
intake → planning → staging → active → validation → completed
```

---

## State Source of Truth

```
project_workspace/state/*.json  ✅ TRUE
Postgres                        ❌ DERIVED
```

---

# 8. Feature Integration Model

## 8.1 Dual Representation

Feature exists in:

### Documentation
```
docs/features/feature-x.md
```

### Execution
```
project_workspace/intake/features/FEAT-xxx/
```

---

## 8.2 Flow

```
Feature Doc
→ Intake Folder
→ Planning Artifacts
→ Sprint Artifacts
→ Tasks
→ Validation
→ Completed
```

---

# 9. n8n Integration Pattern

## Planner Flow

```
load_project_config
→ load_manifest
→ resolve_paths
→ build_execution_contract
→ LLM
→ render_template
→ validate_artifacts
→ update_state
```

---

## Sprint Controller Flow

Same pattern.

---

# 10. Strict Rules (Non-Negotiable)

## Rule 1
n8n MUST NOT contain logic.

---

## Rule 2
Templates MUST live in ai_dev_stack.

---

## Rule 3
State MUST be file-based.

---

## Rule 4
All paths MUST be resolved via scripts.

---

## Rule 5
LLM outputs MUST be structured JSON.

---

# 11. Anti-Patterns (Explicitly Forbidden)

- Templates in project_workspace ❌
- Logic in n8n ❌
- Duplicate governance ❌
- Feature docs as truth ❌
- Postgres as source of truth ❌

---

# 12. Summary

This system ensures:

- reusable governance
- isolated project state
- deterministic execution
- strict architecture enforcement
- scalable multi-project orchestration

---

# 13. Guiding Principle

> Governance defines truth  
> Scripts enforce truth  
> n8n executes flow  
> Artifacts prove truth  
