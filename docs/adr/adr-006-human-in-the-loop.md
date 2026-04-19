# ADR-006: Human-in-the-Loop Approval Model

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system incorporates:

- AI-driven planning and reasoning (ADR-003, ADR-005)
- Deterministic execution (ADR-018)
- Artifact-driven state (ADR-002)
- Governance-first architecture (ADR-004)

While automation enables efficiency, fully autonomous execution introduces risks:

- Incorrect or low-quality outputs from AI components
- Invalid or unintended system behavior
- Propagation of errors into downstream artifacts and state
- Loss of human oversight in critical decision points

To ensure safety, correctness, and governance, the system must provide **controlled human oversight at key decision points**.

---

## Decision

The system SHALL implement a **Human-in-the-Loop (HITL) Approval Model**, where designated artifacts and execution stages require explicit human approval before proceeding.

---

## Core Principle

> Automation proposes.  
> Humans approve.  
> Execution enforces.

---

## Approval Scope

Human approval SHALL apply to:

### 1. Artifact Approval

Artifacts produced by roles or execution MAY require approval before being accepted as valid.

Examples:
- Plans (phase plans, sprint plans)
- Task definitions
- Workflow configurations
- Critical transformation outputs

---

### 2. Execution Approval

Certain executions MAY require approval before being executed.

Examples:
- High-impact operations
- External system interactions
- Destructive or irreversible actions

---

### 3. State Impact Approval

Artifacts that significantly impact derived state MAY require approval before being included in state derivation.

---

## Approval Model

The system SHALL support:

```
Candidate Artifact → Approval Required → Human Decision → Approved Artifact → State
```

Unapproved artifacts MUST NOT:
- Contribute to state
- Trigger downstream execution
- Be treated as authoritative

---

## Approval States

Artifacts and executions SHALL support the following states:

- `pending_approval`
- `approved`
- `rejected`

Optional:
- `needs_revision`

---

## Approval as Artifact

All approvals MUST be recorded as artifacts.

Approval records MUST include:

- approval_id
- artifact_reference (or execution_id)
- decision (approved/rejected)
- approver (user_id)
- timestamp
- optional comments

This ensures:
- Traceability
- Auditability
- Reproducibility

---

## Relationship to Artifact-Driven State (ADR-002)

- Only **approved artifacts** MAY contribute to system state
- State derivation MUST exclude:
  - pending artifacts
  - rejected artifacts

---

## Relationship to Roles (ADR-005)

- Roles MAY generate candidate artifacts
- Roles MUST NOT bypass approval requirements
- Roles MUST NOT self-approve outputs

---

## Relationship to Deterministic Execution (ADR-018)

- Approval gates occur **before or after execution**, not within execution logic
- Execution remains deterministic
- Approval decisions do not alter execution contracts

---

## Relationship to Observability (ADR-019)

- Approval decisions MUST be observable
- Approval events MUST be linked to:
  - ExecutionRecords
  - Artifacts

The system MUST allow:
- Inspection of approval history
- Correlation between execution and approval

---

## Relationship to Governance (ADR-004)

- Approval requirements SHALL be defined in governance artifacts (Git)
- Governance determines:
  - Which artifacts require approval
  - Which roles require approval
  - Approval rules and policies

Runtime systems MUST NOT:
- Define approval logic outside governance

---

## Enforcement Requirements

The system MUST enforce:

- No execution proceeds past an approval gate without approval
- No artifact contributes to state without required approval
- No silent bypass of approval checkpoints

---

## Prohibited Behavior

The system MUST NOT:

- Automatically approve artifacts without explicit policy
- Allow roles or execution systems to self-approve
- Allow unapproved artifacts to affect state
- Allow approval decisions to be modified without audit trail

---

## Performance Considerations

The system MUST support:

- Asynchronous approval workflows
- Queuing of pending approvals
- Notification mechanisms (future)

The system SHOULD allow:
- Configurable approval thresholds
- Batch approvals (future)

---

## Consequences

### Positive

- Increased safety and correctness
- Human oversight at critical decision points
- Prevention of invalid or harmful actions
- Improved trust in system outputs
- Strong auditability and compliance support

---

### Negative

- Reduced execution throughput
- Increased latency due to approval steps
- Requires user interface and workflow support
- Additional complexity in orchestration

---

## Alternatives Considered

### 1. Fully Autonomous Execution (Rejected)

Allow system to execute without human intervention.

**Rejected because:**
- High risk of incorrect or harmful outputs
- No safety checkpoints
- Reduced trust and auditability

---

### 2. Optional Approval Without Enforcement (Rejected)

Allow approvals but do not enforce them strictly.

**Rejected because:**
- Leads to inconsistent behavior
- Approval becomes advisory rather than authoritative
- Risk of bypassing safety controls

---

### 3. Manual-Only System (Rejected)

Require human intervention for all actions.

**Rejected because:**
- Eliminates benefits of automation
- Reduces system scalability

---

## Future Considerations

- Role-based approval permissions
- Multi-stage approval workflows
- Automated policy-based approvals (with strict constraints)
- Integration with external approval systems
- UI for approval management
- SLA tracking for approvals
- Conditional approvals based on risk level