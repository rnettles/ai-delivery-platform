# System Overview
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **high-level architecture** of the governed AI orchestration system.

It explains:
- System components
- Responsibilities of each layer
- How data and control flow through the system
- How governance is enforced end-to-end

---

# 2. Architectural Principles

## 2.1 Governance-First Design
All rules, prompts, templates, and logic originate from the Git-based AI Governance system.

---

## 2.2 Separation of Concerns

| Layer | Responsibility |
|------|--------|
| Git | Governance + artifacts |
| n8n | Orchestration |
| Postgres | Runtime state |
| Slack | Interface |
| Scripts | Deterministic execution |
| LLM | Reasoning only |

---

## 2.3 Artifact-Driven Execution

System state is determined by:
- What artifacts exist
- Whether they are valid

NOT by:
- Who performed the action
- What the system “thinks” happened

---

# 3. System Components

---

## 3.1 Git (AI Governance System)

### Location
```
\ai_dev_stack\ai_guidance
```

### Responsibilities
- Store prompts
- Store rules
- Store templates
- Store artifacts (Phase, Sprint Plan, Tasks)
- Define role behavior
- Define validation expectations

### Key Property
> Git is the **single source of truth**

---

## 3.2 n8n (Orchestration Layer)

### Responsibilities
- Execute workflows
- Load governance manifest
- Build execution contracts
- Invoke roles (Planner, Sprint Controller)
- Coordinate validation
- Transition workflow state
- Manage human approval steps

### Non-Responsibilities
- Defining business logic
- Storing artifacts
- Interpreting governance rules

---

## 3.3 Postgres (Runtime State)

### Responsibilities
- Track workflow instances
- Store current state
- Store execution metadata
- Store artifact references (paths + commit hashes)

### Key Constraint
> Postgres state must be reconstructable from Git + events

---

## 3.4 Slack (Interface Layer)

### Responsibilities
- Receive user requests
- Display workflow progress
- Provide approval interface
- Capture human decisions

---

## 3.5 Deterministic Script Layer

### Responsibilities
- Render templates
- Validate artifacts
- Resolve paths
- Load governance manifest
- Perform repo inspections

### Key Principle
> All repeatable logic should be deterministic

---

## 3.6 LLM (Reasoning Layer)

### Responsibilities
- Interpret requests
- Generate structured outputs
- Fill template content

### Constraints
- Must return structured JSON
- Cannot control workflow logic
- Cannot define state transitions

---

# 4. End-to-End Flow

---

## 4.1 High-Level Flow

```
Slack Request
→ n8n Orchestrator
→ Load Governance Manifest
→ Planner Execution
→ Phase + Sprint Plan Artifacts (Git)
→ Validation
→ Sprint Controller Execution
→ Task Artifacts (Git)
→ Validation
→ Human Approval
→ State Transition
```

---

## 4.2 Detailed Flow

### Step 1 — Intake
- Slack sends request
- n8n creates workflow instance
- State = received

---

### Step 2 — Planning
- n8n loads planner configuration
- LLM generates structured plan
- Scripts render Phase + Sprint Plan
- Validation ensures artifacts exist

---

### Step 3 — Staging
- n8n invokes Sprint Controller
- LLM generates tasks
- Scripts render task artifacts
- Validation ensures tasks exist

---

### Step 4 — Approval
- System pauses
- Human reviews artifacts
- Decision determines next state

---

# 5. Data Flow

---

## 5.1 Inputs
- Slack requests
- Governance artifacts (Git)
- Existing project artifacts

---

## 5.2 Outputs
- Phase documents
- Sprint Plans
- Task artifacts
- Runtime state updates

---

## 5.3 Data Ownership

| Data Type | Owner |
|----------|------|
| Governance | Git |
| Artifacts | Git |
| Runtime state | Postgres |
| Workflow control | n8n |

---

# 6. Control Flow

---

## 6.1 Orchestration Logic

n8n controls:
- Which role runs next
- When validation occurs
- When to pause
- When to resume

---

## 6.2 Transition Rules

Transitions occur only when:
- Required artifacts exist
- Validation passes
- Human approval (if required) is received

---

# 7. Validation Enforcement

---

## Phase 1
- File existence
- Required sections

---

## Future
- Schema validation
- Rule validation
- Semantic validation

---

# 8. Failure Handling

---

## Failure Types
- Missing artifacts
- Invalid structure
- LLM output failure

---

## Behavior
- Pause workflow
- Log issue
- Require retry or intervention

---

# 9. Extensibility

This architecture supports adding:

- Implementer role
- Verifier role
- Fixer role
- Documentation agent

Without changing:
- n8n core logic
- system architecture

---

# 10. Key Guarantees

- Governance-aligned execution
- Deterministic validation
- Hybrid execution support
- Reproducible workflows
- No logic duplication

---

# 11. Summary

The system is a **governed execution engine** where:

- Git defines truth
- n8n enforces flow
- Scripts ensure correctness
- LLM provides intelligence
- Humans provide control

---

# 12. Guiding Principle

> The system does not execute intent — it executes validated, governed state.
