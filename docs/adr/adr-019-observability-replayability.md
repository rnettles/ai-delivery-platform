# ADR-019: Execution Observability and Replayability

## Status
Proposed

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

ADR-018 established the Execution Service as a **deterministic, contract-enforced execution layer**.

While this guarantees:
- Valid input/output contracts
- Structured error handling
- Deterministic behavior

…it does **not guarantee operational visibility or traceability**.

At present, the system lacks:
- Persistent execution records
- Queryable execution history
- Replay capability
- Cross-system traceability (e.g., n8n workflows)

This creates critical gaps:

- Failures cannot be reliably investigated after the fact
- Execution behavior cannot be audited or validated
- Debugging requires guesswork instead of evidence
- Workflow-level tracing across systems is not possible
- Agents and automation cannot safely retry or reason about past executions

To operate reliably at scale, the system must treat execution as a **first-class, persistent, and queryable artifact**.

---

## Decision

The Execution Service SHALL implement **Execution Observability and Replayability**, ensuring that all executions are:

- Persisted
- Queryable
- Replayable
- Traceable across systems

---

### 1. Execution Record (Canonical Model)

Every execution MUST produce a persistent **ExecutionRecord**.

```ts
interface ExecutionRecord {
  execution_id: string;

  script: string;
  script_version: string;

  input: unknown;
  output?: unknown;

  status: "success" | "error";

  error?: {
    code: string;
    message: string;
    details?: any;
  };

  started_at: string;
  completed_at?: string;
  duration_ms?: number;

  metadata?: {
    source?: string;          // e.g., n8n, API, CLI
    correlation_id?: string;  // workflow or request trace
    user_id?: string;
  };
}
```

#### Requirement

> If an execution is not recorded, it is considered not to have occurred.

---

### 2. Execution Persistence

ExecutionRecords MUST be persisted in a durable data store.

Acceptable initial implementations:
- SQLite
- PostgreSQL

The system MUST NOT rely on:
- In-memory storage
- Ephemeral logs without persistence

Persistence MUST ensure:
- Durability across restarts
- Queryability
- Consistency with execution results

---

### 3. Execution Query API

The Execution Service SHALL expose APIs to retrieve execution history.

#### Endpoints

```
GET /executions
GET /executions/:id
```

#### Behavior

- `GET /executions` returns a list of execution summaries
- `GET /executions/:id` returns the full ExecutionRecord

Responses MUST include:
- Input
- Output (if success)
- Error (if failure)
- Metadata
- Timing information

---

### 4. Execution Replay Capability

The Execution Service SHALL support deterministic replay of executions.

#### Endpoint

```
POST /executions/:id/replay
```

#### Behavior

- Re-executes the original script using:
  - same script name
  - same script version
  - same input

#### Constraint

Replay MUST adhere to ADR-018 determinism guarantees:

> Replay MUST produce:
> - the same output  
> OR  
> - the same structured error  

---

### 5. Execution Lifecycle Events

The system SHALL emit structured lifecycle events for each execution.

#### Required Events

- `execution.started`
- `execution.completed`
- `execution.failed`

#### Minimum Event Fields

- `execution_id`
- `script`
- `script_version`
- `timestamp`
- `status`

These events MUST be:
- Logged
- Correlated with ExecutionRecords

---

### 6. Correlation and Traceability

The system SHALL support cross-system tracing via `correlation_id`.

#### Requirements

- ExecutionRequests MAY include a `correlation_id`
- The Execution Service MUST persist this value in the ExecutionRecord
- All logs and events MUST include the `correlation_id` when present

#### Purpose

Enables tracing across systems:

```
External Trigger → n8n → Execution Service → Script(s)
```

---

### 7. Orchestration Integration (n8n)

n8n SHALL provide metadata for traceability:

```json
{
  "metadata": {
    "source": "n8n",
    "correlation_id": "<workflow_run_id>"
  }
}
```

n8n MUST NOT:
- Store execution state as source of truth
- Replace Execution Service observability
- Break correlation chains

The Execution Service remains the **system of record for execution history**.

---

### 8. Replay Safety Constraints

Replay functionality MUST NOT:
- Mutate original ExecutionRecords
- Override historical data
- Introduce non-deterministic behavior

Each replay MUST:
- Create a new ExecutionRecord
- Reference the original execution (e.g., `replayed_from_execution_id`)

---

### 9. Data Retention Considerations

ExecutionRecords SHOULD support:
- Retention policies
- Archival strategies
- Filtering/query capabilities

Initial implementation MAY store all executions without pruning, but future scalability MUST be considered.

---

## Consequences

### Positive

- Full visibility into all executions
- Deterministic debugging and failure analysis
- Replay capability enables root cause validation
- Enables UI tooling (execution history, dashboards)
- Supports agent-based retry and reasoning workflows
- Establishes foundation for auditability and compliance
- Improves trust in system behavior

---

### Negative

- Increased storage requirements
- Additional implementation complexity
- Potential performance overhead for persistence
- Requires schema design and indexing for scalability

---

## Alternatives Considered

### 1. Log-Only Observability (Rejected)

Rely solely on logs without structured execution records.

**Rejected because:**
- Logs are unstructured and difficult to query
- Cannot reliably reconstruct execution state
- No replay capability

---

### 2. Partial Recording (Rejected)

Record only failures or only metadata.

**Rejected because:**
- Prevents full traceability
- Breaks determinism validation
- Limits debugging capability

---

### 3. External Observability Only (Rejected)

Delegate observability entirely to external systems (e.g., logging platforms).

**Rejected because:**
- Execution Service loses control of its own state
- Tight coupling to external tooling
- No guaranteed replay support

---

### 4. Replay Without Persistence (Rejected)

Allow replay via re-sending inputs without stored execution context.

**Rejected because:**
- No guarantee inputs are preserved
- Cannot verify determinism
- Breaks auditability

---

## Relationship to ADR-018

ADR-018 defined:
- Deterministic execution
- Contract enforcement
- Structured error handling

ADR-019 extends this by:
- Persisting execution results
- Enabling query and inspection
- Supporting deterministic replay
- Introducing cross-system traceability

Together:

- ADR-018 ensures **execution correctness**
- ADR-019 ensures **execution visibility and reproducibility**

---

## Future Considerations

- Execution indexing and search optimization
- Distributed tracing integration (e.g., OpenTelemetry)
- Execution visualization UI
- Metrics and alerting (latency, failure rates)
- Role-based access to execution data
- Data redaction and privacy controls
- Batch replay and workflow-level replay
- Integration with Canonical Knowledge System (CKS) for execution intelligence