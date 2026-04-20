# ADR-028: Project-Scoped Git Repository Lifecycle

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

ADR-011 established that the Execution Service exclusively owns all Git operations. ADR-010 established that a persistent filesystem (Azure Files) is mounted at `/mnt/` to survive container restarts. ADR-027 introduced Projects as first-class entities, each associated with a distinct Git repository.

With multiple projects active simultaneously, the Git synchronization strategy must address three specific problems that the original single-repository design did not encounter:

**1. Singleton coupling**
The existing `GitSyncService` is instantiated once at application startup, bound to a single clone path derived from the global `GIT_CLONE_PATH` environment variable. It cannot serve multiple projects.

**2. Clone-per-call risk**
Without explicit lifecycle management, a naive multi-project implementation could re-clone a repository on every pipeline request if the service instance is not reused or if it fails to detect an existing clone. A full clone on every call is unacceptable: it is slow, consumes bandwidth, and is unnecessary when the persistent workspace (ADR-010) already holds the repository.

**3. Concurrent sync races**
Multiple pipeline runs for the same project may start simultaneously (e.g., two users running `/plan` in the same channel seconds apart). Without coordination, both would invoke `git pull` concurrently against the same working tree, producing filesystem corruption or inconsistent execution state.

**4. Context-switch isolation**
If the platform switches between projects across consecutive pipeline calls, the repository state of one project must not be affected by operations on another. Each project's working tree must be independently managed.

---

## Decision

The Execution Service SHALL implement a **Project-Scoped Git Repository Lifecycle** with the following properties.

### 1. Isolated Per-Project Clone Paths

Each project clones to a dedicated subdirectory on the Azure Files mount:

```
/mnt/repo/{project_name}/
```

Where `project_name` is the slug-safe name field from the `projects` table (ADR-027). This path is derived automatically; operators do not configure clone paths.

No two projects share a clone path. Switching between projects — processing requests from different Slack channels in any order — produces no interaction between working trees. Deleting, corrupting, or updating one project's working tree has no effect on any other.

### 2. Clone-Once, Pull-on-Demand

The Execution Service SHALL apply the following logic on every pipeline sync request for a project:

```
IF .git directory does not exist at clone path
  → git clone (full initial checkout)
ELSE
  → git pull --ff-only (incremental update)
```

Because the clone path lives on Azure Files (persistent across container restarts, ADR-010), the `.git` directory survives restarts. After a container restart, the first sync for a project performs a `git pull`, not a `git clone`. Cloning occurs exactly once per project per persistent storage lifetime.

### 3. TTL-Guarded Sync

A `git pull` on every pipeline request is unnecessary and introduces latency. The Execution Service SHALL maintain an **in-memory TTL registry** keyed by `project_id`:

```
Map<project_id, last_synced_at: timestamp>
```

Sync behavior:

- If `now - last_synced_at < GIT_SYNC_TTL_MS`: skip pull, use existing working tree
- If `now - last_synced_at >= GIT_SYNC_TTL_MS` (or no entry exists): perform pull, update registry

The default TTL is **120 seconds**, configurable via the `GIT_SYNC_TTL_MS` environment variable.

The TTL registry is in-memory and is intentionally not persisted. On container restart, the registry is empty and the first request for each project triggers a pull regardless of how recently the prior container synced. This is safe: a pull against an up-to-date working tree is fast and idempotent.

### 4. Per-Project Async Mutex

To prevent concurrent sync races, the Execution Service SHALL maintain a **per-project async mutex** keyed by `project_id`:

```
Map<project_id, AsyncMutex>
```

Before any sync operation for a project, the caller acquires the project's mutex. The mutex serializes concurrent sync calls:

- First caller: acquires lock, performs pull (or clone), releases lock
- Concurrent callers: wait for the lock, then re-check the TTL — if the first caller's pull updated `last_synced_at` within the TTL window, subsequent callers skip the pull and proceed immediately

This eliminates concurrent `git pull` invocations against the same working tree without requiring a database lock or distributed coordination mechanism.

### 5. Scope of This Decision

The mutex and TTL registry are **in-process, single-instance** mechanisms. They are sufficient for a single container replica.

If the Execution Service is scaled horizontally to multiple replicas in the future, concurrent pulls from different instances to the same Azure Files path would reintroduce the race condition. At that point, a distributed lease (e.g., Azure Blob Storage lease, database advisory lock) would be required. This is explicitly deferred; horizontal scaling of the Execution Service is not a current requirement.

### 6. GitSyncContext Stamping

Every execution record (ADR-019) SHALL continue to record a `git_sync` context containing:

- `repo_path`: the project's clone path
- `head_commit`: the Git commit hash at the time of execution
- `is_repo_accessible`: boolean

This context is captured after sync completes and is attached to the execution record, preserving the association between each execution and the exact repository state it operated on.

---

## Core Principle

> Clone once. Pull only when stale. Never race. Never lose a working tree.

---

## Sync Decision Flow

```
POST /pipeline (slack_channel: C123)
        │
        ▼
Resolve project from channel
        │
        ▼
Acquire per-project mutex (project_id)
        │
        ▼
Check TTL registry
        │
  ┌─────┴──────┐
  │             │
stale/miss    fresh
  │             │
  ▼             ▼
.git exists?   Skip pull
  │
  ├── No  → git clone → update TTL
  └── Yes → git pull --ff-only → update TTL
        │
        ▼
Release mutex
        │
        ▼
Capture GitSyncContext (head_commit)
        │
        ▼
Execute pipeline role
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GIT_CLONE_BASE` | `/mnt/repo` | Root directory under which per-project clone paths are derived |
| `GIT_SYNC_TTL_MS` | `120000` | Minimum milliseconds between pulls for the same project |
| `GIT_PAT` | — | Organization-level Personal Access Token (no per-project override) |

---

## Consequences

### Positive

- Cloning happens exactly once per project per persistent storage lifetime
- Container restarts do not trigger re-clones; they trigger at most one pull per project on the first request
- Project context switches have zero effect on other projects' working trees
- Concurrent pipeline starts for the same project are safely serialized without database involvement
- Execution records remain stamped with the exact commit each role operated on (determinism, ADR-018)

### Negative

- The TTL and mutex are in-memory only; they reset on container restart. This is acceptable: a pull after restart is fast and correct.
- Horizontal scaling is not supported without a distributed locking mechanism (explicitly deferred)

### Neutral

- The `git pull --ff-only` strategy means merge conflicts or force-pushed branches will cause sync to fail. This is intentional: governance repositories should not have diverged or force-pushed branches during active platform operation. Operators must resolve such conditions manually.

---

## Related ADRs

- ADR-001: Git as Source of Truth
- ADR-003: Deterministic Over LLM
- ADR-009: Execution Service
- ADR-010: Azure Files Persistent Storage
- ADR-011: Execution Service Owns Git
- ADR-018: Execution Determinism
- ADR-019: Observability and Replayability
- ADR-027: Multi-Project Support
