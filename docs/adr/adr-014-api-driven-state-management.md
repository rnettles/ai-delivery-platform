# ADR-014: API-Driven State Management for Execution and Agent Workflows

## Status

Proposed

---

## Context

The system is evolving into a hybrid execution environment supporting:

* Local human/AI-assisted development (e.g., VSCode + Copilot)
* n8n-based agentic workflows
* A centralized Execution Service deployed in Azure (Container Apps)
* Shared infrastructure (Postgres, Storage, ACR)

Currently:

* The Execution Service exposes `/health` and `/execute`
* n8n can invoke execution logic via HTTP
* There is no persistent, shared state layer
* State (if any) is transient or tool-specific (n8n memory, local files, etc.)

### Problem

We need a **consistent, shared state model** that:

* Works across **local development and n8n workflows**
* Avoids **direct database access from n8n**
* Enables **execution traceability, replay, and debugging**
* Supports **agent coordination and handoffs**
* Does not conflict with **Git as the canonical source of truth**

Without this:

* State becomes fragmented across tools
* Debugging becomes difficult
* Agent workflows cannot reliably coordinate
* Tight coupling to Postgres spreads across the system

---

## Decision

Introduce an **API-driven State Management Layer**, exposed via the Execution Service (or a closely related service), with the following principles:

---

### 1. All State Access Occurs via API

* n8n **must not** directly access Postgres
* Local development tools **must use the same API**
* The API becomes the **single interface to system state**

---

### 2. State is Explicitly Modeled and Typed

State is categorized into three types:

#### a. Execution State (short-lived)

* execution_id
* status
* timestamps
* logs

#### b. Workflow / Agent State (medium-lived)

* current phase
* task progression
* intermediate outputs
* agent coordination data

#### c. Canonical State (long-lived)

* plans
* architecture artifacts
* schemas
* documentation

> Canonical state remains stored in **Git** and is not replaced by the State API.

---

### 3. Introduce State API Endpoints

#### Create / Update State

```http
POST /state
```

```json
{
  "state_id": "optional",
  "type": "workflow | agent | session",
  "scope": "planner | sprint | execution",
  "data": {},
  "metadata": {
    "source": "n8n | local | api"
  }
}
```

---

#### Retrieve State

```http
GET /state/:id
```

---

#### Query State

```http
POST /state/query
```

---

#### Partial Update

```http
PATCH /state/:id
```

---

#### Delete / Archive

```http
DELETE /state/:id
```

---

### 4. Backing Storage

* Primary: **Postgres (JSONB-based storage)**
* Accessed only through API layer
* Designed to support:

  * flexible schemas
  * versioning
  * indexing on metadata fields

---

### 5. Separation of Concerns

| Responsibility      | Component         |
| ------------------- | ----------------- |
| Execute logic       | Execution Service |
| Manage state        | State API Layer   |
| Persist data        | Postgres          |
| Canonical artifacts | Git               |

---

### 6. Git Remains Source of Truth

State API is **not authoritative** for long-term artifacts.

Instead:

1. Agents write intermediate results to State API
2. Results are reviewed/promoted
3. Promoted artifacts are committed to Git
4. Git becomes canonical record

---

## Consequences

---

### Positive

#### ✅ Consistent Access Model

* All components (n8n, local dev, future agents) use the same interface

#### ✅ Decoupling from Database

* No direct Postgres usage outside backend
* Enables storage evolution (Redis, event store, etc.)

#### ✅ Improved Observability

* Execution history and workflow progression are trackable

#### ✅ Agent Interoperability

* Shared memory model enables coordinated agent workflows

#### ✅ Replay and Debugging

* Historical state enables deterministic replay

---

### Negative

#### ⚠️ Increased System Complexity

* Introduces new API surface and data model

#### ⚠️ Requires Schema Discipline

* Poorly structured `data` fields can lead to entropy

#### ⚠️ Potential Over-Centralization

* Risk of creating a “god service” if boundaries are not enforced

---

### Risks

* State model becomes inconsistent without governance
* Versioning not implemented early → difficult migrations later
* Execution and state concerns may become tightly coupled if not carefully separated

---

## Alternatives Considered

---

### 1. Direct Postgres Access from n8n

**Rejected**

* Tight coupling
* Schema leakage
* Hard to evolve
* Security concerns

---

### 2. Store All State in Git

**Rejected**

* Too slow for runtime state
* Poor fit for transient / intermediate data
* High friction for agent workflows

---

### 3. Keep State Local to Each Tool

**Rejected**

* Fragmented system
* No shared memory
* No coordination between agents

---

## Implementation Plan

---

### Phase 1 (Immediate)

* Add minimal endpoints:

  * `POST /state`
  * `GET /state/:id`
* Store data in Postgres JSONB
* Integrate execution results → state

---

### Phase 2

* Add:

  * query endpoint
  * partial updates
* Introduce indexing strategy
* Wire n8n workflows to use State API

---

### Phase 3

* Add:

  * versioning
  * lineage tracking
  * audit logs

---

### Phase 4

* Integrate with:

  * Git promotion workflows
  * Canonical Knowledge System (CKS)

---

## Decision Outcome

Adopt an **API-first state management model** to unify:

* execution tracking
* workflow coordination
* human + AI collaboration

while preserving:

* clean architectural boundaries
* Git as canonical source of truth
* future extensibility of storage and orchestration layers

---

## Notes

This decision establishes the foundation for:

* agentic system coordination
* reproducible workflows
* scalable multi-environment execution

It should be revisited once:

* persistence layer is implemented
* first multi-agent workflows are operational

```markdown
# ADR-005: API-Driven State Management for Execution and Agent Workflows
...
```
