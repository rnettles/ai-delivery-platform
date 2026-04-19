# ADR-010: Persistent Workspace and Artifact Storage Layer

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system architecture includes:

- Governance artifacts stored in Git (ADR-001, ADR-004)
- Deterministic execution via the Execution Service (ADR-009)
- Artifact-driven state (ADR-002)
- Observability via ExecutionRecords (ADR-019)
- Orchestration via n8n (ADR-007)

The runtime environment (e.g., container-based services) is inherently **ephemeral**, meaning:

- Filesystem state is lost on restart
- Generated artifacts cannot be persisted locally
- Git clones must be rehydrated
- Execution context cannot be maintained across runs

The system requires a **persistent, shared workspace layer** to support:

- Local access to governance repositories
- Storage of generated artifacts
- Project-specific working directories
- Script execution context
- Inter-service file sharing (Execution Service, n8n)

---

## Decision

The system SHALL implement a **Persistent Workspace and Artifact Storage Layer**.

This layer SHALL:

- Provide a shared filesystem accessible by runtime services
- Persist artifacts, workspace files, and repositories
- Support execution and orchestration workflows

The initial implementation SHALL use **Azure Files** as the backing storage system.

---

## Core Principle

> Git is the source of truth.  
> Workspace is the working memory.  
> Artifacts are the evidence.

---

## Storage Model

The system SHALL define three distinct storage layers:

---

### 1. Governance Layer (Git)

- Stores governance artifacts (ADR-001)
- Authoritative and versioned
- Immutable per commit

---

### 2. Workspace Layer (Persistent Filesystem)

- Local working copy of governance artifacts
- Project-specific files
- Execution context for scripts

This layer SHALL:

- Be persistent across container restarts
- Be accessible to execution and orchestration services
- Support standard filesystem operations

---

### 3. Artifact Layer

- Stores generated outputs (artifacts)
- Supports artifact-driven state (ADR-002)

Artifacts MAY be stored:
- In the workspace filesystem
- In dedicated artifact storage (future)

---

## Workspace Structure

The system SHOULD organize the workspace as:

```
/mnt/repo/
  ├── ai_dev_stack/          # Governance repository (Git clone)
  ├── project_workspace/     # Project-specific working files
  ├── scripts/               # Executable scripts
  ├── docs/                  # Generated documentation
  ├── artifacts/             # Generated outputs
  └── project_config.json
```

Structure MAY evolve but MUST remain consistent and governed.

---

## Relationship to Execution Service (ADR-009)

The Execution Service SHALL:

- Use the workspace as its working directory
- Read governance artifacts from local Git clones
- Read/write artifacts to the workspace
- Maintain execution context within the workspace

The Execution Service MUST NOT rely on ephemeral local storage.

---

## Relationship to n8n (ADR-007)

n8n MAY:

- Access the workspace for read operations
- Use limited write access if required

n8n MUST NOT:
- Use the workspace as a source of truth
- Modify governance artifacts directly
- Introduce logic via filesystem manipulation

---

## Relationship to Artifact-Driven State (ADR-002)

- Artifacts stored in the workspace are inputs to state derivation
- Workspace contents MUST be:
  - Validated
  - Traceable
  - Reproducible

Workspace storage alone does not define state; artifacts do.

---

## Relationship to Observability (ADR-019)

- ExecutionRecords remain the authoritative record of execution
- Workspace files MAY be referenced by ExecutionRecords
- File-based artifacts MUST be traceable to execution_id

---

## Synchronization with Git

The system SHALL support:

- Cloning governance repositories into the workspace
- Updating local copies from Git
- Maintaining alignment between Git and workspace

The workspace MUST NOT:

- Override Git as the source of truth
- Introduce untracked governance changes

---

## Implementation: Azure Files

Azure Files SHALL be used as the initial implementation because it:

- Provides a shared, persistent filesystem
- Supports multi-container access
- Integrates with container-based environments
- Enables standard file operations

Mount configuration:

```
/mnt/repo
```

---

## Prohibited Behavior

The system MUST NOT:

- Treat the workspace as the source of truth (Git remains authoritative)
- Store critical state only in ephemeral storage
- Allow uncontrolled mutation of governance artifacts
- Bypass validation when reading/writing artifacts

---

## Consequences

### Positive

- Durable storage for artifacts and workspace
- Enables multi-container coordination
- Supports execution workflows requiring filesystem access
- Maintains alignment with artifact-driven architecture
- Enables reproducibility and traceability

---

### Negative

- Introduces storage latency compared to local disk
- Requires mount configuration and access control
- Adds operational complexity
- Requires discipline to prevent misuse of workspace as source of truth

---

## Alternatives Considered

### 1. Local Container Filesystem (Rejected)

**Rejected because:**
- Ephemeral and non-persistent
- Data loss on restart
- Not suitable for artifact-driven architecture

---

### 2. Azure Blob Storage (Rejected as Primary Layer)

**Rejected because:**
- Not a native filesystem
- Complex file operations for scripts
- Poor fit for execution workspace

---

### 3. Database-Only Storage (Rejected)

**Rejected because:**
- Breaks artifact-driven architecture (ADR-002)
- Reduces transparency
- Limits flexibility for file-based workflows

---

## Future Considerations

- Separation of artifact storage from workspace
- Tiered storage strategies (hot vs cold artifacts)
- Workspace isolation per project or tenant
- Access control and security policies
- Integration with object storage for large artifacts
- Caching strategies for performance optimization
- Distributed filesystem alternatives if scaling requires