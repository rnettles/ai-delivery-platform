# Execution Service API Specification
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the canonical API contract between:

- n8n (orchestration layer)
- Execution Service (deterministic runtime engine)
- External clients (UI/CLI/agents)

This API is the only integration boundary for governed execution.

---

# 2. Core Principle

> All governed execution flows through one contract boundary.

---

# 3. Canonical Endpoint

## POST /execute

This is the single endpoint for governed execution requests.

The target behavior (script/role/capability) is selected by contract fields in the request body, not by endpoint proliferation.

---

# 4. Standard Request Envelope

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

## Request Requirements

- `target.version` MUST be explicit and immutable
- `input` MUST be structured JSON
- Request MUST validate against the request schema

---

# 5. Standard Response Envelope

```json
{
  "ok": true,
  "execution_id": "string",
  "request_id": "string",
  "correlation_id": "string",
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

## Response Requirements

- Exactly one of `output` or `errors` represents the terminal result
- Errors MUST be structured and machine-readable
- All responses MUST be traceable by `execution_id`

---

# 6. Error Format

```json
{
  "code": "STRING_CODE",
  "message": "Human readable message",
  "details": {}
}
```

## Standard Error Codes

- `VALIDATION_ERROR`
- `SCRIPT_NOT_FOUND`
- `VERSION_RESOLUTION_ERROR`
- `EXECUTION_ERROR`
- `UNAUTHORIZED`

---

# 7. Contract Rules

- Execution Service owns request/output schema validation
- Clients MUST NOT bypass this boundary
- Specialized behavior endpoints for execution logic are prohibited
- Floating version aliases (for example, `latest`) are prohibited for governed execution

---

# 8. Optional Supporting Endpoints

Supporting endpoints MAY exist (health/discovery/replay metadata), but:

- They MUST NOT execute governed logic directly
- They MUST NOT bypass schema validation, observability, or policy checks

---

# 9. Observability Requirements

Every `POST /execute` request MUST:

- Create an ExecutionRecord
- Capture target name + explicit version
- Capture normalized input/output/error envelopes
- Preserve replayability under the same contract

---

# 10. Artifact and State Alignment

- Authoritative truth is in artifacts (ADR-002)
- API responses may include artifact references
- Any state snapshots are derived projections and non-authoritative

---

# 11. Guiding Principle

> n8n orchestrates. Execution Service executes. Artifacts define truth.