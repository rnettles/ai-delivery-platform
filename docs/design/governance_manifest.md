# Governance Manifest
## Governed AI Software Development Orchestration System

---

# 1. Purpose

The Governance Manifest is the **central runtime contract** between:

- The AI Governance System (Git)
- The Orchestration Layer (n8n)
- Deterministic Script Layer
- Role Execution (LLM)

It defines:

- Where governance artifacts live
- How roles are configured
- What outputs are expected
- How validation is performed
- How state transitions occur

---

# 2. Core Principles

## 2.1 Git is the Source of Truth
All configuration in this manifest references files in Git.

## 2.2 No Logic Duplication
The manifest references rules — it does not redefine them.

## 2.3 Deterministic Execution First
The manifest enables deterministic orchestration; LLM is bounded.

## 2.4 Role-Centric Design
Each role defines:
- inputs
- outputs
- templates
- validation
- transitions

---

# 3. Manifest Structure Overview

```
{
  version,
  global,
  roles,
  state_machine,
  execution
}
```

---

# 4. Global Configuration

## Purpose
Defines shared system behavior.

### Example

```
"global": {
  "artifact_roots": {
    "phases": "docs/phases/",
    "sprints": "docs/sprints/",
    "tasks": "project_tasks/"
  },
  "common_rules": [
    "ai_guidance/rules/global_rules.md"
  ]
}
```

---

# 5. Role Configuration Model

Each role entry defines how that role executes.

## Standard Structure

```
"role_name": {
  "prompt": "...",
  "rules": [...],
  "templates": {...},
  "inputs": [...],
  "outputs": [...],
  "validation": {...},
  "transitions": {...}
}
```

---

# 6. Planner Role Definition

## Purpose
Convert request into planning artifacts.

### Example

```
"planner": {
  "prompt": "ai_guidance/prompts/planner.md",
  "rules": [
    "ai_guidance/rules/planner_rules.md"
  ],
  "templates": {
    "phase": "ai_guidance/templates/phase_template.md",
    "sprint_plan": "ai_guidance/templates/sprint_plan_template.md"
  },
  "outputs": [
    {
      "type": "phase",
      "path": "docs/phases/{phase_id}.md"
    },
    {
      "type": "sprint_plan",
      "path": "docs/sprints/{sprint_id}.md"
    }
  ],
  "validation": {
    "level_1": [
      "phase_exists",
      "sprint_plan_exists"
    ]
  },
  "transitions": {
    "on_success": "ready_for_staging",
    "on_failure": "planning_failed"
  }
}
```

---

# 7. Sprint Controller Role Definition

## Purpose
Convert Sprint Plan into staged tasks.

### Example

```
"sprint_controller": {
  "prompt": "ai_guidance/prompts/sprint_controller.md",
  "rules": [
    "ai_guidance/rules/sprint_controller_rules.md"
  ],
  "templates": {
    "task": "ai_guidance/templates/task_template.md"
  },
  "inputs": [
    "sprint_plan"
  ],
  "outputs": [
    {
      "type": "task",
      "path": "project_tasks/{sprint_id}/{task_id}.md"
    }
  ],
  "validation": {
    "level_1": [
      "tasks_exist"
    ]
  },
  "transitions": {
    "on_success": "awaiting_staging_approval",
    "on_failure": "staging_failed"
  }
}
```

---

# 8. State Machine Definition

## Purpose
Defines allowed system states.

```
"state_machine": {
  "states": [
    "received",
    "planning",
    "phase_created",
    "sprint_plan_created",
    "ready_for_staging",
    "tasks_staged",
    "awaiting_staging_approval",
    "approved",
    "rejected",
    "failed"
  ]
}
```

---

# 9. Validation Model

## Levels

- Level 1: Structural (Phase 1)
- Level 2: Governance rules
- Level 3: Semantic validation

---

# 10. Execution Configuration

```
"execution": {
  "artifact_strategy": "artifact_first",
  "state_source": "git",
  "runtime_state": "postgres",
  "validation_required": true
}
```

---

# 11. Runtime Usage (n8n)

n8n performs:

1. Load manifest
2. Resolve role configuration
3. Build execution contract
4. Invoke LLM
5. Render artifacts (scripts)
6. Validate outputs
7. Transition state

---

# 12. Extensibility

New roles can be added without modifying n8n:

- implementer
- verifier
- fixer

---

# 13. Future Enhancements

- validation scripts mapping
- JSON schemas
- context loading rules
- approval configuration

---

# 14. Summary

The Governance Manifest enables:

- dynamic orchestration
- strict governance alignment
- deterministic execution
- scalable role expansion

---

# 15. Guiding Principle

> The manifest defines WHAT the system must do.  
> n8n defines WHEN it happens.  
> Scripts define HOW it is executed.  
> LLM defines HOW content is generated.
