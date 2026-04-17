# ADR-010: Use Azure Files for Persistent Project Workspace

## Status
Accepted

## Context

Azure Container Apps are ephemeral. Without persistent storage:

- Git clones are lost on restart
- Generated artifacts are lost
- System state cannot be preserved

The system requires a persistent, shared filesystem for:

- Governance repository (ai_dev_stack)
- Project workspace (project_workspace)
- Generated artifacts
- State files

## Decision

Use **Azure Files** as a mounted volume shared between:

- Execution Service container
- n8n container (read-only or limited use)

Mount path:

```
/mnt/repo
```

This will store:

- ai_dev_stack/
- project_workspace/
- scripts/
- docs/
- project_config.json

## Consequences

### Positive

- Durable artifact storage
- Shared access between services
- Enables Git-based workflow
- Supports multi-container architecture

### Negative

- Slight latency compared to local disk
- Requires mount configuration and permissions

## Alternatives Considered

### 1. Local container filesystem
Rejected due to:
- Ephemeral nature
- Data loss risk

### 2. Azure Blob Storage
Rejected due to:
- Not a native filesystem
- Complex file operations

### 3. Database-only storage
Rejected due to:
- Loss of artifact-driven architecture
- Reduced transparency and traceability

## Notes

Azure Files becomes the **system memory layer**.
