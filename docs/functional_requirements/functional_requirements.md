# Functional Requirements
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **functional requirements** for the governed AI orchestration system.

These requirements specify **what the system must do**, independent of implementation details.

---

# 2. Guiding Constraints

- Governance definitions MUST reside in Git (`ai_guidance`)
- All governed execution MUST cross the canonical execution contract boundary
- Artifacts MUST be the authoritative source of truth for derived system state
- Coordination context MUST be non-authoritative and transient
- Deterministic, version-pinned execution MUST be enforced
- Human approval and observability MUST be first-class execution concerns

---

# 3. Canonical Execution Contract

## FR-1.1 Single Governed Execution Boundary
- System SHALL expose a canonical execution contract as the only interface for governed execution.
- System SHALL reject governed execution attempts that bypass the contract boundary.

## FR-1.2 Request Envelope
- System SHALL accept structured execution requests containing:
  - request identifier
  - correlation identifier
  - target descriptor (script or role)
  - explicit immutable target version
  - structured input payload
  - caller metadata

## FR-1.3 Response Envelope
- System SHALL return structured execution responses containing:
  - execution identifier
  - resolved target identity (name + version)
  - deterministic output or structured error
  - artifact references (when produced)

---

# 4. Script and Role Registry

## FR-2.1 Registry Resolution
- System SHALL resolve all execution targets through a registry model.
- System SHALL support script and role targets.

## FR-2.2 Role Mapping
- System SHALL map role targets to governed script executions.
- System SHALL preserve role abstraction while recording resolved script identity.

## FR-2.3 Version Determinism
- System SHALL require explicit immutable version selection at execution time.
- System SHALL reject floating aliases (for example: latest, stable) for governed execution.

---

# 5. Governance Inputs and Policy Enforcement

## FR-3.1 Governance Source
- System SHALL load prompts, rules, templates, and schema references from governed sources.
- System SHALL prevent orchestration clients from hardcoding governance logic.

## FR-3.2 Contract Validation
- System SHALL validate execution request and response payloads against defined schemas.
- System SHALL reject non-conforming payloads before they affect downstream workflow behavior.

## FR-3.3 LLM Boundary
- System SHALL allow LLM usage only within governed, schema-bounded execution steps.
- System SHALL require structured outputs at the contract boundary.

---

# 6. Artifact Truth and Derived Views

## FR-4.1 Authoritative Outputs
- System SHALL treat artifacts as authoritative outputs for derived system state.
- System SHALL ensure artifacts are attributable to execution identifiers.

## FR-4.2 Derived Lifecycle Views
- System MAY provide derived lifecycle or state snapshot views for usability.
- System SHALL treat such views as non-authoritative projections.
- System SHALL ensure projections are reconstructable from artifacts and execution records.

## FR-4.3 No Mutable Truth Layer
- System SHALL NOT introduce mutable runtime records as authoritative system truth.
- System SHALL NOT derive final truth from coordination context stores.

---

# 7. Coordination Context

## FR-5.1 Shared Context API
- System SHALL provide an API for transient coordination context used by workflows, agents, and interfaces.
- System SHALL support create, read, update, query, and expiry/archive behavior for coordination entries.

## FR-5.2 Context Boundaries
- Coordination context SHALL support multi-step orchestration and handoffs.
- Coordination context SHALL NOT be used as final state derivation input.

## FR-5.3 Access Discipline
- External clients SHALL access coordination context only through the API layer.
- System SHALL prevent direct client-side database coupling for coordination storage.

---

# 8. Approval and Human-in-the-Loop

## FR-6.1 Approval Gates
- System SHALL support governed approval checkpoints for selected artifact classes and workflow milestones.
- System SHALL block progression past gated checkpoints until approval outcome is recorded.

## FR-6.2 Approval Actions
- System SHALL support approval, rejection, and revision request actions.
- System SHALL capture actor identity, timestamp, and rationale metadata for approval outcomes.

## FR-6.3 Approval Auditability
- System SHALL record approval outcomes as traceable artifacts or artifact-linked records.
- System SHALL preserve linkage between approvals, execution identifiers, and affected artifacts.

---

# 9. Observability and Replay

## FR-7.1 Execution Recording
- System SHALL persist immutable ExecutionRecords for all governed executions.
- System SHALL include target, version, input, output or error, timing, and trace metadata.

## FR-7.2 Traceability
- System SHALL propagate correlation identifiers across interface, orchestration, execution, and logging surfaces.
- System SHALL support querying execution history by identifiers and metadata filters.

## FR-7.3 Deterministic Replay
- System SHALL support replay using original target identity, version, input, and context definition.
- System SHALL create a new execution record that references the original execution during replay.

---

# 10. Conversational Interface

## FR-8.1 Interface Role
- System SHALL support conversational clients (for example, Slack) as intent interfaces.
- System SHALL treat conversational clients as non-executing interface layers.

## FR-8.2 Command Interpretation
- System SHALL interpret conversational input into structured execution intents.
- System SHALL map interpreted commands to canonical execution requests.

## FR-8.3 Conversational Transparency
- System SHALL surface execution identifiers, status updates, and approval requests back to the conversation channel.
- System SHALL preserve thread-level continuity through correlation metadata.

---

# 11. Orchestration Responsibilities

## FR-9.1 Orchestration Scope
- n8n or equivalent orchestration SHALL manage sequencing, retries, and routing only.
- Orchestration SHALL NOT embed governed business logic.

## FR-9.2 Generalized Execution Model
- System SHALL support generalized target execution (role or script) through one contract model.
- System SHALL NOT require specialized planner/sprint-controller endpoint patterns to execute governed logic.

## FR-9.3 Failure Handling
- System SHALL emit structured errors for contract, validation, authorization, and runtime failures.
- Orchestration SHALL be able to branch deterministically on error category.

---

# 12. Security and Access Control

## FR-10.1 AuthN/AuthZ
- System SHALL authenticate and authorize execution and coordination API requests.
- System SHALL enforce policy constraints for sensitive or privileged operations.

## FR-10.2 Input Safety
- System SHALL validate and sanitize external inputs before contract processing.
- System SHALL avoid leaking internal implementation details in external error responses.

---

# 13. Extensibility

## FR-11.1 Registry Expansion
- System SHALL support adding new scripts and roles through governed registration processes.
- System SHALL support concurrent version operation during controlled evolution.

## FR-11.2 Contract Evolution
- System SHALL support API and target versioning for non-breaking and breaking changes.
- System SHALL provide migration paths for breaking contract updates.

---

# 14. Multi-Agent Pipeline Execution

## FR-12.1 Pipeline Run Entity
- System SHALL support Pipeline Runs as first-class, persistent entities with unique identifiers.
- A Pipeline Run SHALL track current step, status, step history, and artifact references across its full lifecycle.
- Pipeline Run state SHALL be recoverable after failure, restart, or human intervention.

## FR-12.2 Role Sequence
- System SHALL execute governed roles in a defined sequence: Planner → Sprint Controller → Implementer → Verifier → Fixer (conditional) → Sprint Controller (close-out).
- Role sequence SHALL be governed by role definitions in the registry, not hardcoded in orchestration workflows.
- The Fixer role SHALL be invoked only when Verifier produces a failing result.

## FR-12.3 Variable Entry Points
- System SHALL support starting a Pipeline Run at any role in the sequence.
- Steps prior to the configured entry point SHALL be recorded as `not_applicable` in the run history.
- Entry point SHALL be specified at pipeline creation time and SHALL not be changeable after creation.

## FR-12.4 Pipeline Notifications
- System SHALL emit a structured notification to the configured callback URL when a pipeline step completes or a gate is reached.
- Notifications SHALL include: pipeline_id, step, status, gate_required flag, artifact paths, and interface correlation metadata.
- The notification mechanism SHALL be decoupled from the interface layer (Slack, web, API).

## FR-12.5 Step Artifact Linkage
- System SHALL record the artifact paths produced at each pipeline step.
- Artifact paths SHALL be queryable by pipeline_id and step name.
- Each pipeline step SHALL reference the execution_id of the underlying governed execution.

---

# 15. Pipeline Human Override and Control

## FR-13.1 Approve Action
- System SHALL support an Approve action that advances the pipeline past the current gate.
- Approve SHALL be rejected if the pipeline is not in `awaiting_approval` state.
- Actor identity and timestamp SHALL be recorded on approval.

## FR-13.2 Takeover Action
- System SHALL support a Takeover action that pauses the pipeline and assigns the current step to a human actor.
- Once taken over, the system SHALL NOT attempt to execute the current step via AI.
- Actor identity and timestamp SHALL be recorded on takeover.

## FR-13.3 Handoff Action
- System SHALL support a Handoff action that resumes the pipeline after a human has completed a taken-over step.
- Handoff SHALL optionally accept an artifact path reference representing the human-produced output.
- Pipeline SHALL advance to the next step upon successful handoff.

## FR-13.4 Skip Action
- System SHALL support a Skip action that advances past the current step without AI or human execution.
- Skip SHALL require a justification string.
- Justification, actor, and timestamp SHALL be recorded in the step history.

## FR-13.5 Override Auditability
- All human override actions (approve, takeover, handoff, skip) SHALL produce immutable records in the pipeline step history.
- The complete pipeline history — including all AI executions and human actions — SHALL be queryable via the pipeline API.

---

# 16. Conversational Command Interface

## FR-14.1 Slash Commands
- System SHALL support the following slash commands as pipeline entry points:
  - `/plan [description]` — create a full pipeline run from Planner
  - `/sprint [phase-id]` — create a pipeline run from Sprint Controller
  - `/implement [task-id]` — create a pipeline run from Implementer
  - `/verify [task-id]` — create a pipeline run from Verifier
- System SHALL support the following pipeline control commands:
  - `/status` — return current pipeline run state for the active channel
  - `/approve` — approve the current gate
  - `/takeover` — claim the current step
  - `/handoff` — signal human step complete and resume pipeline

## FR-14.2 Thread Continuity
- All pipeline notifications, gate messages, and status updates SHALL be posted to the same Slack thread that originated the pipeline run.
- Thread correlation SHALL be preserved across the full pipeline lifecycle.

## FR-14.3 Interface Isolation
- Slack credentials and message formatting SHALL reside exclusively in the orchestration layer (n8n).
- The Execution Service SHALL NOT call Slack APIs directly.
- The interface layer SHALL be replaceable without modifying the Execution Service.

## FR-14.4 Interactive Gate Messages
- At each human approval gate, the system SHALL post an interactive message to the conversation thread.
- The message SHALL include: role that completed, artifact reference, and action buttons (Approve, Take Over).
- Verifier failure gates SHALL additionally include: Fix (invoke Fixer) and Take Over Fix options.

---

# 17. Summary

These functional requirements ensure:

- Canonical contract-first execution
- Deterministic registry-driven behavior
- Artifact-based truth with derived projections
- Governed approvals and human oversight
- Immutable observability and replayability
- Conversational interface consistency
- Safe coordination context without mutable truth drift
- First-class pipeline execution with persistent state
- Human override and takeover at every pipeline step
- Interface-isolated Slack integration with thread continuity

