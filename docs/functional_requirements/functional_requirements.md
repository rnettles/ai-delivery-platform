# Functional Requirements
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **functional requirements** for the governed AI orchestration system.

These requirements specify **what the system must do**, independent of implementation details.

---

# 2. Guiding Constraints

- Governance MUST reside in Git (`ai_guidance`)
- n8n MUST NOT duplicate governance logic
- All state transitions MUST be artifact-driven
- Deterministic execution MUST be preferred over LLM
- LLM MUST be bounded to reasoning and content generation only

---

# 3. Intake & Workflow Initialization

## FR-1.1 Slack Intake
- System SHALL accept user requests via Slack webhook
- System SHALL support structured and unstructured input

## FR-1.2 Request Normalization
- System SHALL normalize incoming requests into a structured format
- System SHALL attach metadata (user, timestamp, request_id)

## FR-1.3 Workflow Creation
- System SHALL create a workflow instance in Postgres
- System SHALL assign initial state = `received`

---

# 4. Governance Integration

## FR-2.1 Manifest Loading
- System SHALL load `governance_manifest.json` from Git at runtime

## FR-2.2 Prompt & Rules Resolution
- System SHALL resolve prompt paths from manifest
- System SHALL resolve rule paths from manifest
- System SHALL NOT hardcode prompts or rules in n8n

## FR-2.3 Template Resolution
- System SHALL load templates from Git via manifest
- System SHALL enforce template usage for all artifacts

---

# 5. Planner Execution

## FR-3.1 Role Invocation
- System SHALL invoke the Planner role when state = `planning`

## FR-3.2 Context Assembly
- System SHALL assemble execution context including:
  - request
  - governance rules
  - templates
  - relevant artifacts

## FR-3.3 LLM Interaction
- System SHALL invoke LLM with bounded prompt
- System SHALL require structured JSON output

## FR-3.4 Artifact Generation
- System SHALL generate:
  - Phase artifact
  - Sprint Plan artifact

## FR-3.5 Deterministic Rendering
- System SHALL render artifacts using templates via deterministic scripts

## FR-3.6 Persistence
- System SHALL persist artifacts in Git
- System SHALL store artifact references in Postgres

---

# 6. Sprint Controller Execution

## FR-4.1 Role Invocation
- System SHALL invoke Sprint Controller when state = `ready_for_staging`

## FR-4.2 Input Loading
- System SHALL load Sprint Plan artifact from Git

## FR-4.3 LLM Interaction
- System SHALL generate structured task definitions via LLM

## FR-4.4 Task Rendering
- System SHALL render task artifacts using templates

## FR-4.5 Task Persistence
- System SHALL store task artifacts in Git under governed paths

---

# 7. Artifact Management

## FR-5.1 Source of Truth
- System SHALL treat Git as the authoritative source of artifacts

## FR-5.2 Artifact Referencing
- System SHALL store only references (paths, commit hashes) in Postgres

## FR-5.3 Path Enforcement
- System SHALL enforce artifact directory structure:
  - docs/phases/
  - docs/sprints/
  - project_tasks/

---

# 8. Validation

## FR-6.1 Validation Requirement
- System SHALL require validation before any state transition

## FR-6.2 Level 1 Validation (Phase 1)
- System SHALL validate:
  - artifact existence
  - required sections present

## FR-6.3 Validation Failure Handling
- System SHALL pause workflow on validation failure
- System SHALL log validation errors

---

# 9. State Management

## FR-7.1 Runtime State Tracking
- System SHALL store workflow state in Postgres

## FR-7.2 Artifact-Derived State
- System SHALL derive true state from Git artifacts

## FR-7.3 Transition Rules
- System SHALL prevent transitions without validated artifacts

---

# 10. Human Interaction

## FR-8.1 Approval Points
- System SHALL pause for human approval after task staging

## FR-8.2 Supported Actions
- approve
- reject
- request_revision

## FR-8.3 State Updates
- System SHALL update state based on human action

---

# 11. Execution Flexibility

## FR-9.1 Hybrid Execution
- System SHALL support both AI and human execution paths

## FR-9.2 Actor Independence
- System SHALL validate outputs regardless of execution source

---

# 12. Error Handling

## FR-10.1 Failure Detection
- System SHALL detect:
  - missing artifacts
  - invalid outputs
  - LLM failures

## FR-10.2 Failure Response
- System SHALL pause workflow
- System SHALL allow retry or intervention

---

# 13. Observability (Future)

## FR-11.1 Logging
- System SHALL log workflow execution steps

## FR-11.2 Auditability
- System SHALL maintain traceable linkage:
  request → artifacts → state transitions

---

# 14. Extensibility

## FR-12.1 Role Expansion
- System SHALL support adding new roles via manifest

## FR-12.2 Workflow Reuse
- System SHALL support reusable orchestration subflows

---

# 15. Summary

These functional requirements ensure:

- Governance-first execution
- Deterministic orchestration
- Controlled LLM usage
- Artifact-driven state
- Scalable system evolution
