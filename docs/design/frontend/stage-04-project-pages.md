# Stage 4 — Project Pages

## Goal

Implement the **project pages** layer of the frontend: project list and project detail views.

Projects are the top-level execution context. Every pipeline is scoped to a project. The project
pages allow operators to browse available projects, inspect their metadata, and navigate into
pipeline execution.

---

## Scope

This stage delivers:

- `Project` and `ProjectWithChannels` TypeScript types (mirrored from backend)
- Design specification for the project list page
- Design specification for the project detail page
- Route structure for project pages

---

## TypeScript Types

Location: `platform/frontend/types/project.ts`

```ts
export interface Project {
  project_id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  clone_path: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithChannels extends Project {
  channel_ids?: string[];
}
```

Mirrors `platform/backend-api/src/services/project.service.ts`. No transformation needed — the
API returns these shapes directly.

---

## Route Structure

```plaintext
/projects                       ← project list page
/projects/[projectId]           ← project detail page
/projects/[projectId]/pipelines ← pipeline list scoped to project (Stage 5)
```

---

## Page: Project List

### Purpose

Display all available projects. Entry point for selecting an active project context.

### Data Source

```
GET /projects?include_channels=true
```

Returns `ProjectWithChannels[]`.

### Layout

```
Project List
  ├── Page header ("Projects")
  ├── Project cards (one per project)
  │     ├── Project name
  │     ├── Repo URL
  │     ├── Default branch
  │     ├── Channel count (badge)
  │     └── Link → project detail
  └── Empty state (no projects found)
```

### Component Breakdown

| Component         | Responsibility                                       |
|-------------------|------------------------------------------------------|
| `ProjectListPage` | Route container; fetches project list via hook       |
| `ProjectCard`     | Renders a single project row/card                    |
| `useProjects`     | React Query hook: `GET /projects?include_channels=true` |

### Behaviour

- On load: show skeleton while fetching
- On error: show inline error with retry
- Empty state: show "No projects found" message
- Each card navigates to `/projects/[projectId]` on click

---

## Page: Project Detail

### Purpose

Show metadata and execution context for a single project. Entry point for pipeline creation and
navigation to project pipelines.

### Data Source

```
GET /projects/:projectId
```

Returns `ProjectWithChannels`.

### Layout

```
Project Detail
  ├── Page header (project name)
  ├── Metadata section
  │     ├── Project ID
  │     ├── Repo URL
  │     ├── Default branch
  │     ├── Clone path
  │     ├── Channels (list)
  │     ├── Created at
  │     └── Updated at
  └── Actions
        └── "View Pipelines" → /projects/[projectId]/pipelines
```

### Component Breakdown

| Component            | Responsibility                                     |
|----------------------|----------------------------------------------------|
| `ProjectDetailPage`  | Route container; fetches project by ID via hook    |
| `ProjectMetadata`    | Renders project fields in a structured layout      |
| `useProject`         | React Query hook: `GET /projects/:projectId`       |

### Behaviour

- On load: show skeleton while fetching
- On 404: show "Project not found" message
- On error: show inline error with retry
- No mutations on this page (read-only)

---

## Hooks

### `useProjects`

```ts
function useProjects(): UseQueryResult<ProjectWithChannels[]>
```

- Endpoint: `GET /projects?include_channels=true`
- Polling: not required (static data)
- Cache key: `['projects']`

### `useProject`

```ts
function useProject(projectId: string): UseQueryResult<ProjectWithChannels>
```

- Endpoint: `GET /projects/:projectId`
- Polling: not required
- Cache key: `['projects', projectId]`

---

## API Proxy

All fetches route through the Next.js API proxy layer:

```
/api/projects           → GET /projects
/api/projects/[id]      → GET /projects/:id
```

No direct backend calls from client components.

---

## Constraints

- No business logic in components
- No hardcoded project data
- All rendering traces to API response
- Project detail is read-only — no inline mutations

---

## Anti-Patterns

- Caching project state in local/global state
- Rendering pipeline data on the project detail page (belongs in Stage 5)
- Hardcoding channel IDs or project names

---

## Dependencies

- `platform/frontend/types/project.ts` — project TypeScript types
- `docs/frontend/component-architecture.md` — component structure conventions
- `docs/frontend/data-fetching.md` — React Query strategy
- `docs/ux/views/project-detail.md` — UX intent for project detail

---

## Exit Criteria

- [ ] `Project` and `ProjectWithChannels` types defined in `platform/frontend/types/project.ts`
- [ ] Project list page design specified
- [ ] Project detail page design specified
- [ ] Hook signatures defined (`useProjects`, `useProject`)
- [ ] API proxy routes identified
- [ ] No business logic in page components

---

## Completion Statement

Stage 4 establishes the project pages as the operator's entry point for execution context
selection. Projects are fetched from the API, rendered as read-only views, and navigate into the
pipeline execution surface defined in Stage 5.
