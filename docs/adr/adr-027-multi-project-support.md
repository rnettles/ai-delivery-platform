# ADR-027: Multi-Project Support

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The platform was initially designed for a single software project: one Git repository, one clone path, one execution context. Configuration was global via environment variables (`GIT_REPO_URL`, `GIT_CLONE_PATH`).

As the platform grows, multiple independent projects must be managed concurrently. Each project has:

- Its own Git repository (distinct URL, distinct working tree)
- Its own execution context (artifact paths, state scope, governance artifacts)
- Its own human interaction surface (a dedicated Slack channel)

Without a first-class project concept, the system would require one deployment per project — duplicating infrastructure, configuration, and operational overhead across all managed projects.

The Slack interface (ADR-021, ADR-023) already passes `slack_channel` as metadata on every pipeline request. Humans naturally associate a Slack channel with the work they are doing. This creates a natural, low-friction mapping: **channel = project**.

---

## Decision

The Execution Service SHALL implement **Projects as a first-class entity**.

A **Project** represents a distinct software initiative managed by the platform. Each project owns:

- A unique identifier and human-readable name
- A Git repository URL
- A derived clone path on the persistent workspace (ADR-010)
- An association to one or more Slack channels

### Channel-to-Project Resolution

The Execution Service SHALL resolve the active project from `metadata.slack_channel` on every inbound pipeline request.

- Each Slack channel maps to **exactly one project** (1:1 channel-to-project)
- The n8n layer forwards `slack_channel` exactly as it does today — **no changes to existing n8n workflows**
- If no project is associated with the requesting channel, the Execution Service SHALL return a clear error response; execution will not proceed

This places project resolution entirely within the Execution Service, consistent with ADR-009 and ADR-023.

### Project Data Model

Projects and channel associations SHALL be persisted in the Execution Service database:

```
projects
  project_id    UUID (PK)
  name          text (unique, slug-safe)
  git_repo_url  text
  git_clone_path text  -- derived: {GIT_CLONE_BASE}/{name}/
  working_directory text (nullable) -- for monorepo sub-paths
  created_at    timestamp

project_channels
  channel_id    text (PK) -- Slack channel ID
  project_id    UUID (FK → projects)
  created_at    timestamp
```

The `git_clone_path` is derived automatically from the project name and the configured clone base path. Users do not specify clone paths directly.

The nullable `working_directory` field supports monorepo configurations where two projects share a repository root but operate in different subdirectories.

### Pipeline Run Association

Every pipeline run SHALL record the `project_id` of the project it was resolved from. This:

- Scopes execution artifacts to the correct working tree
- Sets `state.scope = project_id`, isolating state per project using the existing index (ADR-014)
- Enables audit and replay queries filtered by project (ADR-019)

### Project Administration

Projects are managed via:

1. **REST API** — `POST /projects`, `GET /projects`, `POST /projects/:id/channels`, `GET /channels/:channelId/project`
2. **Slack admin commands** (via n8n) — `/project register <name> <repo-url>`, `/project assign <name>`, `/project status`

The Slack admin commands are additive — a new n8n workflow handles them without modifying existing pipeline workflows.

### Credential Model

The platform uses a single organization-level Git PAT (`GIT_PAT` environment variable) with access to all managed repositories. Per-project credentials are not required. The schema reserves space for a nullable `git_pat` column if per-project credential isolation becomes necessary in the future.

### Backward Compatibility

If `GIT_REPO_URL` is set in the environment at startup, the Execution Service SHALL automatically register or update a project named `default` using that URL and assign it to no channel. Existing deployments continue to function; operators associate a channel with the default project at their convenience.

---

## Core Principle

> One channel. One project. One repository.  
> The Execution Service resolves the context. n8n never needs to know.

---

## Consequences

### Positive

- Multiple projects managed by a single platform deployment
- Natural human UX: the Slack channel you are in defines the project you are working on
- n8n workflows require no modification for existing pipeline commands
- Project isolation is enforced by the Execution Service, not by deployment topology
- State, artifacts, and audit records are scoped per project
- Monorepo support via `working_directory` without duplicating clone overhead

### Negative

- A new administrative step is required before a channel can be used: project registration and channel assignment
- Unregistered channels produce an error rather than silently using a default — operators must onboard projects before use (this is intentional)

### Neutral

- The global `GIT_REPO_URL` / `GIT_CLONE_PATH` configuration is deprecated in favor of the project registry. It is retained for backward compatibility only and will be removed in a future release.

---

## Related ADRs

- ADR-001: Git as Source of Truth
- ADR-009: Execution Service
- ADR-010: Azure Files Persistent Storage
- ADR-011: Execution Service Owns Git
- ADR-014: API-Driven State Management
- ADR-019: Observability and Replayability
- ADR-021: Conversational Interface and Command Model
- ADR-022: Multi-Agent Pipeline Execution Model
- ADR-023: n8n as Slack Interface Adapter
- ADR-028: Project-Scoped Git Repository Lifecycle
