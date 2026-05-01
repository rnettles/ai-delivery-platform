# ADR-021: Conversational Interface and Command Model

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The platform provides a deterministic, contract-driven execution system (ADR-017, ADR-018, ADR-013) with:

- Artifact-driven state (ADR-002)
- Human-in-the-loop approval (ADR-006)
- Observability and replayability (ADR-019)
- Coordination and execution context (ADR-014)

To make this system usable by humans and agents, a primary interaction layer is required.

Traditional interfaces (UI dashboards, CLI tools) introduce friction and fragmentation.

A conversational interface—particularly via messaging platforms such as Slack—offers:

- Low-friction interaction
- Natural human-in-the-loop workflows
- Real-time feedback and collaboration
- Persistent, contextual communication

However, without architectural constraints, such interfaces risk:

- Embedding business logic in the interface layer
- Bypassing execution contracts
- Introducing inconsistent execution paths
- Creating alternative sources of truth

---

## Decision

The system SHALL implement a **Conversational Interface and Command Model** as a primary interaction layer.

This model SHALL:

- Interpret user messages as structured execution intents
- Map all interactions to the canonical execution contract (ADR-013)
- Preserve deterministic, observable execution behavior
- Maintain strict separation between interface and execution logic

Slack (or similar platforms) SHALL be treated as **interface clients**, not execution environments.

---

## Core Principle

> Conversations express intent.  
> Execution enforces behavior.

---

## Interface Abstraction

The conversational interface SHALL follow:

```
User Message
   ↓
Command Interpretation Layer
   ↓
Execution Request (ADR-013)
   ↓
Execution Service
   ↓
Execution Response
   ↓
Interface Response
```

The interface layer MUST NOT:

- Execute business logic
- Perform contract validation
- Bypass the execution API

---

## Context Model

### Channel Context

A conversational channel SHALL map to a **project or repository context**.

Examples:

- Slack channel → repository
- Channel metadata → configuration scope

This allows:

- implicit targeting of execution
- reduced need for repetitive parameters

---

### Thread Context

A conversation thread SHALL map to an **execution context**, identified by:

- correlation_id (ADR-019)
- execution_id (if applicable)

Threads enable:

- tracking multi-step workflows
- grouping related execution events
- human/system interaction continuity

---

## Command Model

The system SHALL define **command categories**, not platform-specific syntax.

---

### 1. Execution Commands

Initiate execution of scripts or roles:

- start workflow
- generate plan
- execute task

---

### 2. Query Commands

Retrieve system information:

- current state (derived)
- execution progress
- work remaining
- execution history

---

### 3. Control Commands

Modify execution flow:

- abort execution
- retry execution
- pause or resume workflows (future)

---

### 4. Approval Commands

Support human-in-the-loop workflows (ADR-006):

- approve artifact
- reject artifact
- request revision

---

### 5. Escalation / Handoff Commands

Transfer control:

- request human intervention
- escalate issue
- assign responsibility

---

## Command Interpretation

The Command Interpretation Layer SHALL:

- parse user intent
- resolve context (channel + thread)
- construct a canonical ExecutionRequest

Interpretation MAY use:

- structured parsing
- LLM-assisted intent extraction

Regardless of method, the output MUST be:

- deterministic at the contract boundary
- validated before execution

---

## Execution Mapping

All commands MUST map to:

```
ExecutionRequest → Execution Service → ExecutionResponse
```

The interface MUST NOT:

- define alternate execution paths
- call scripts directly
- modify contracts

---

## Observability Integration (ADR-019)

The interface SHALL:

- include correlation_id in all requests
- display execution_id in responses
- surface execution status and results

Threads SHOULD reflect:

- execution lifecycle events
- logs and summaries
- final outcomes

---

## Human-in-the-Loop Integration (ADR-006)

The conversational interface SHALL:

- surface approval requests
- accept approval/rejection commands
- reflect approval outcomes

Approval actions MUST:

- be recorded as artifacts
- follow governance rules

---

## Determinism Constraints

The conversational interface MUST NOT introduce non-determinism.

Specifically:

- interpretation MUST resolve to a deterministic execution request
- implicit context MUST be explicit at execution boundary
- ambiguous commands MUST be rejected or clarified

---

## Security and Access Considerations

The interface MUST:

- authenticate users
- enforce authorization rules (future ADR)
- prevent unauthorized execution

Channel and thread context MUST NOT bypass:

- identity checks
- permission boundaries

---

## Platform Independence

While Slack is the initial implementation, the model SHALL be platform-agnostic.

Other clients MAY include:

- CLI tools
- Web interfaces
- API consumers
- Other messaging platforms

All clients MUST adhere to the same command and execution model.

---

## Prohibited Behavior

The system MUST NOT:

- embed business logic in the conversational interface
- allow direct script execution from the interface
- bypass the execution API (ADR-013)
- maintain separate state outside artifacts and execution records
- create alternate sources of truth

---

## Consequences

### Positive

- Natural, low-friction user interaction
- Strong alignment with human-in-the-loop workflows
- Unified interface across tools
- Maintains architectural boundaries
- Enables agent and human collaboration

---

### Negative

- Requires robust command interpretation layer
- Potential ambiguity in natural language input
- Additional complexity in context management
- Requires careful UX design for clarity

---

## Alternatives Considered

### 1. UI-Only Interaction (Rejected)

**Rejected because:**
- higher friction
- less natural for iterative workflows
- weaker collaboration model

---

### 2. Direct Slack Logic Execution (Rejected)

**Rejected because:**
- violates ADR-007 and ADR-013
- introduces inconsistent execution paths
- reduces determinism

---

### 3. CLI-Only Interaction (Rejected)

**Rejected because:**
- limited accessibility
- poor collaboration
- not aligned with conversational workflows

---

## Future Considerations

- advanced command parsing and intent classification
- structured command syntax alongside natural language
- multi-channel coordination
- UI overlays for Slack (buttons, forms)
- agent-to-agent conversational workflows
- integration with notification and alerting systems

---

## Summary

ADR-021 defines a **conversational interaction model** for the platform that:

- maps user intent to structured execution
- preserves deterministic behavior
- integrates seamlessly with observability and approval workflows
- remains decoupled from execution logic

This ADR establishes the **primary human interface** to the system while maintaining all architectural guarantees.