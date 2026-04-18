# ADR-017: Script Registry & Execution Model

## Status

Accepted

## Date

2026-04-18

---

## Context

The platform requires a **flexible, scalable, and deterministic execution model** to support:

* AI-driven workflows (e.g., planner → implementer → verifier)
* Orchestrators such as n8n
* Future multi-tenant SaaS execution
* Dynamic feature expansion without redeploying core services

Historically, execution logic has been:

* Hardcoded
* Workflow-specific
* Tightly coupled to orchestration layers

This approach does not scale for:

* Rapid iteration
* Contract enforcement
* Versioned behavior
* Observability and debugging

---

## Decision

We will introduce a **Script Registry & Execution Model** as the foundational execution mechanism for the platform.

### Core Principles

1. **Scripts are first-class execution units**
2. **Execution is dynamically resolved at runtime**
3. **All execution is contract-driven**
4. **Execution is context-aware and observable**
5. **Versioning is mandatory**

---

## Architecture Overview

### High-Level Flow

```
Execution Request
      ↓
Execution Service
      ↓
Script Registry (resolve script + version)
      ↓
Schema Validation (input)
      ↓
Script Execution (with context)
      ↓
Schema Validation (output)
      ↓
Execution Response
```

---

## Script Definition

Scripts encapsulate discrete units of execution logic.

```ts
interface Script<I = any, O = any> {
  name: string
  version: string

  validateInput?: (input: unknown) => I
  validateOutput?: (output: unknown) => O

  run(input: I, context: ScriptContext): Promise<O>
}
```

---

## Script Context

All scripts receive a standardized execution context.

```ts
interface ScriptContext {
  executionId: string
  state?: any

  logger: {
    info(message: string, data?: any): void
    error(message: string, data?: any): void
  }
}
```

### Responsibilities

* Correlate logs via `executionId`
* Provide access to state (future: external state service)
* Enable observability and tracing

---

## Script Registry

A centralized registry responsible for script lifecycle and lookup.

```ts
class ScriptRegistry {
  register(script: Script): void
  get(name: string, version?: string): Script | undefined
}
```

### Behavior

* Scripts are stored as `name@version`
* If no version is provided, the **latest version** is returned
* Supports multiple concurrent versions

---

## Execution Request Contract

```ts
interface ExecutionRequest {
  execution_id?: string
  script: string
  version?: string
  input: unknown
  metadata?: Record<string, any>
}
```

---

## Execution Response Contract

```ts
interface ExecutionResponse {
  execution_id: string
  status: "success" | "error"
  output?: unknown
  error?: {
    message: string
    code?: string
    details?: any
  }
}
```

---

## Execution Engine

The Execution Service orchestrates the full lifecycle.

### Execution Flow

1. Resolve script from registry
2. Create execution context
3. Validate input
4. Execute script
5. Validate output
6. Return standardized response

### Example

```ts
async function execute(request: ExecutionRequest): Promise<ExecutionResponse> {
  const executionId = request.execution_id ?? crypto.randomUUID()

  try {
    const script = registry.get(request.script, request.version)

    if (!script) {
      throw new Error("SCRIPT_NOT_FOUND")
    }

    const context: ScriptContext = {
      executionId,
      logger: console
    }

    const input = script.validateInput
      ? script.validateInput(request.input)
      : request.input

    const output = await script.run(input, context)

    const validatedOutput = script.validateOutput
      ? script.validateOutput(output)
      : output

    return {
      execution_id: executionId,
      status: "success",
      output: validatedOutput
    }

  } catch (err: any) {
    return {
      execution_id: executionId,
      status: "error",
      error: {
        message: err.message || "Execution failed"
      }
    }
  }
}
```

---

## Contract Enforcement

All scripts must align with schema definitions:

* `script_input.schema.json`
* `script_output.schema.json`
* `execution_contract.schema.json`

### Requirements

* Input must be validated before execution
* Output must be validated before returning
* Validation failures must return structured errors

---

## Error Handling Model

Errors must be normalized and never leak raw exceptions.

### Error Types

* `SCRIPT_NOT_FOUND`
* `VALIDATION_ERROR`
* `EXECUTION_ERROR`
* `TIMEOUT_ERROR` (future)

### Format

```json
{
  "execution_id": "uuid",
  "status": "error",
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "details": {}
  }
}
```

---

## Versioning Strategy

* All scripts must include a semantic version
* Multiple versions may coexist
* Default resolution returns latest version

### Benefits

* Backward compatibility
* Safe iteration
* A/B experimentation

---

## Observability

Execution must support:

* Structured logging (with execution_id)
* Metrics (future)
* Distributed tracing (future)

---

## Script Manifest (Future Extension)

```ts
interface ScriptManifest {
  name: string
  version: string
  inputSchema: string
  outputSchema: string
  timeoutMs?: number
}
```

### Purpose

* Bind scripts to schema files
* Enable dynamic loading
* Support UI discovery and documentation

---

## API Surface

### Execute Script

```
POST /execute
```

### List Scripts (Future)

```
GET /scripts
```

---

## Consequences

### Positive

* Decouples execution from orchestration
* Enables dynamic behavior without redeployments
* Provides strong contract enforcement
* Supports versioned evolution of logic
* Improves observability and debugging

---

### Negative

* Introduces additional complexity
* Requires strict schema governance
* Adds overhead for validation and version management

---

## Alternatives Considered

### 1. Hardcoded Execution Logic

Rejected: Not scalable, tightly coupled, no versioning

### 2. Workflow-Driven Execution Only (e.g., n8n)

Rejected: Orchestration should not own execution logic

### 3. Function-as-a-Service (FaaS) Only

Deferred: May be integrated later, but does not replace registry model

---

## Future Enhancements

* Filesystem-based script loading
* Remote script registry (distributed)
* Execution isolation (containers/sandboxes)
* Rate limiting and quotas
* Multi-tenant context injection
* Retry and idempotency support

---

## Summary

ADR-017 establishes the **Script Registry & Execution Model** as the foundational execution layer of the platform.

It enables:

* Dynamic, versioned execution
* Strong contract enforcement
* Clean separation between orchestration and execution
* Scalable architecture for AI-driven systems

This ADR is a **core architectural boundary** and must be adhered to by all execution-related components.

---
