# Helper Script System (Production-Ready Version)
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the deterministic helper script model aligned with:

- Governance-first architecture
- Canonical execution contract (`POST /execute`)
- Artifact-driven state derivation
- Replayable execution records

---

# 2. Core Architecture Model

## 2.1 Separation of Concerns

```
ai_dev_stack/      -> Canonical governance inputs
docs/              -> Architectural decisions and design references
execution service  -> Deterministic execution + validation
n8n                -> Orchestration only
artifacts/         -> Authoritative outputs
snapshots/         -> Derived, non-authoritative views
```

## 2.2 Mental Model

- Governance defines allowed behavior
- Execution Service enforces contracts
- Scripts implement versioned logic units
- Artifacts define truth

---

# 3. Script Contract

Scripts are versioned execution units resolved as `name@version`.

Scripts MUST:

- Accept structured input
- Produce structured output
- Execute under explicit immutable version selection
- Remain deterministic relative to input + context

Scripts MUST NOT:

- Own schema validation responsibilities
- Mutate authoritative state directly
- Depend on floating version aliases

---

# 4. Standard Execution Envelope

## Input

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

## Output

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

---

# 5. Script Lifecycle

```
Request -> Resolve target@version -> Validate input -> Execute script -> Validate output -> Persist artifacts -> Return response
```

Validation is owned by the Execution Service contract boundary.

---

# 6. Artifact and Snapshot Model

- Artifacts are authoritative persisted outputs.
- Any state snapshot files are projections derived from artifacts.
- Snapshots are optional and non-authoritative.

If snapshot reconstruction from artifacts fails, the system is invalid.

---

# 7. Observability Requirements

Every execution must record:

- execution_id
- target name + version
- normalized input/output/error envelopes
- artifact references

This enables deterministic replay and auditability.

---

# 8. n8n Integration Pattern

Planner flow pattern:

```
Webhook -> POST /execute (planner role) -> LLM (if required) -> POST /execute (render) -> POST /execute (validate)
```

n8n MUST NOT contain business logic.

---

# 9. Prohibited Patterns

- Specialized execution behavior endpoints
- Script-local contract/schema ownership
- Floating target aliases (for example, `latest`)
- Mutable runtime state treated as source of truth
- Direct client/database coupling for coordination data

---

# 10. Guiding Principle

> Versioned execution produces artifacts. Artifacts define truth.