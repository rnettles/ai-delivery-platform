# Design Document: API Layer for Execution and Coordination Context

---

## 1. Overview

This document defines the API layer that supports:

- Canonical governed execution
- Shared coordination context for workflows and agents
- Strict separation between authoritative artifacts and transient runtime context

The API layer does not introduce mutable system truth.

---

## 2. Goals

### Primary Goals

- Provide one canonical execution interface
- Provide coordination context APIs for orchestration/runtime collaboration
- Eliminate direct database access from external systems
- Support replayability, observability, and deterministic behavior

### Non-Goals

- Owning business logic implementation inside the API facade
- Replacing artifact-driven truth with mutable records
- UI-specific concerns

---

## 3. High-Level Architecture

```text
Clients (n8n, VSCode, Agents)
            ↓
         API Layer
     ┌───────────────────────┐
     │ Canonical Execute API │
     │ Coordination API      │
     └───────────────────────┘
            ↓
     Internal Services
     ├─ Execution Service
     └─ Coordination Service
            ↓
     Storage Layer
     ├─ Postgres (coordination context)
     ├─ Execution records
     └─ Artifacts (authoritative outputs)
```

---

## 4. Core Concepts

### 4.1 Execution

A deterministic unit of governed work:

- Identified by execution_id
- Executes a target (script or role) with explicit version
- Produces structured output and artifacts

### 4.2 Coordination Context

Shared transient runtime data across workflows and agents:

- Workflow progression context
- Agent handoff context
- Intermediate non-authoritative data

### 4.3 Artifact

Authoritative persisted output of execution:

- Plans
- Task outputs
- Validated generated files

Artifacts remain the source of truth for derived system state.

---

## 5. API Surface

### 5.1 Canonical Execute API

#### POST /execute

Request:

```json
{
  "request_id": "string",
  "correlation_id": "string",
  "target": {
    "type": "script|role",
    "name": "string",
    "version": "string"
  },
  "input": {},
  "metadata": {
    "workflow_id": "string",
    "caller": "n8n|ui|cli|agent"
  }
}
```

Response:

```json
{
  "ok": true,
  "execution_id": "string",
  "target": {
    "type": "script|role",
    "name": "string",
    "version": "string"
  },
  "artifacts": [],
  "output": {},
  "errors": []
}
```

### 5.2 Coordination API

#### POST /coordination

Create coordination entry.

#### GET /coordination/:id

Read coordination entry.

#### PATCH /coordination/:id

Update coordination entry.

#### POST /coordination/query

Query coordination entries.

#### DELETE /coordination/:id

Archive or expire entry.

Coordination APIs are non-authoritative and must not be used as final truth.

---

## 6. Data Model

### 6.1 Execution Record Model

```json
{
  "execution_id": "uuid",
  "target": {
    "type": "script|role",
    "name": "string",
    "version": "string"
  },
  "status": "pending|completed|failed",
  "input": {},
  "output": {},
  "errors": [],
  "started_at": "timestamp",
  "completed_at": "timestamp",
  "metadata": {}
}
```

### 6.2 Coordination Model

```json
{
  "coordination_id": "uuid",
  "kind": "workflow|agent|session",
  "scope": "planner|sprint|execution",
  "data": {},
  "metadata": {},
  "expires_at": "timestamp|null",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

---

## 7. Storage Strategy

### Postgres

Stores coordination context and queryable execution metadata.

### Artifacts + Execution Records

Provide authoritative inputs for derived state and replay.

### Git

Remains authoritative for governance definitions and versioned architecture artifacts.

---

## 8. Execution and Coordination Flow

### Execution Flow

```text
1. Client -> POST /execute
2. Execution Service validates request + response schemas
3. Target@version executes deterministically
4. Artifacts and execution record persisted
5. Structured response returned
```

### Coordination Flow

```text
1. n8n/agent -> POST /coordination
2. Runtime context updated as workflow progresses
3. Consumers read context via GET/query endpoints
4. Context expires or is archived
```

---

## 9. Security Considerations

- API authentication and authorization required
- No direct DB access from clients
- Contract-level input validation required

---

## 10. Observability

- Structured logs include execution_id/request_id/correlation_id
- Coordination entries link to workflow and execution identifiers
- Replay support depends on preserved artifacts and execution records

---

## 11. Trade-offs

### Pros

- Consistent execution boundary
- Shared runtime coordination without mutable truth drift
- Strong observability and replay support

### Cons

- More explicit contract governance required
- Additional complexity in context lifecycle management

---

## 12. Guiding Principle

Authoritative truth comes from artifacts. Coordination context enables collaboration.