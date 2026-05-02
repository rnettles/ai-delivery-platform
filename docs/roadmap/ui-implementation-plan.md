# UI Implementation Plan
## Governed AI Delivery Platform — Control Plane Frontend

---

## Status: ACTIVE

## Context

Slices 1 and 2 of the Pipeline Detail view are complete:
- **Slice 1** — Read path: fetch → map → timeline render
- **Slice 2** — Interactive layer: ActionBar, SidePanel/ArtifactViewer, GateCard, action proxy routes

This document defines the remaining stages to build a complete, navigable UI control plane.
Each stage is a vertical slice with its own detailed plan written before implementation begins.

---

## Stage 3 — Application Shell

**Goal:** Global layout, sidebar navigation, project selector, and URL structure.

**Scope:**
- `platform/frontend/app/layout.tsx` — top-level shell with sidebar + main content region
- Sidebar nav: Projects link, active pipeline indicator
- Project selector dropdown (static or context-driven)
- Canonical URL structure: `/projects/[id]/pipelines/[pid]` for pipeline detail
- Move existing `app/pipelines/[id]` route to `app/projects/[id]/pipelines/[pid]`

**Backend:** None required.

**Unblocks:** All subsequent stages — navigation requires a shell.

---

## Stage 4 — Pipeline List Page

**Goal:** List all pipelines for a selected project, with status and navigation to detail.

**Scope:**
- `app/projects/[id]/pipelines/page.tsx` — pipeline list view
- New Next.js proxy route: `GET /api/projects/[id]/pipelines`
- Pipeline row: pipeline_id, status badge, description, last-updated, entry-point
- Row click → navigate to pipeline detail
- Empty state when no pipelines exist

**Backend:** Consumes existing `GET /pipeline` endpoint (filtered by project).

---

## Stage 5 — Project Pages

**Goal:** Project list and project detail views — entry point for all pipeline activity.

**Scope:**
- `app/projects/page.tsx` — list of projects (name, repo_url, slack_channel)
- `app/projects/[id]/page.tsx` — project detail: metadata + "New Pipeline" CTA
- New Next.js proxy routes: `GET /api/projects`, `GET /api/projects/[id]`
- Root `app/page.tsx` redirects to `/projects`

**Backend:** Consumes existing `GET /projects` and `GET /projects/:projectId` endpoints.

---

## Stage 6 — Pipeline Creation

**Goal:** Allow operator to trigger a new pipeline from the UI.

**Scope:**
- Create-pipeline form on Project Detail page (or dedicated modal)
- Fields: entry-point, execution-mode, description, sprint-branch
- New Next.js proxy route: `POST /api/projects/[id]/pipelines` → `POST /pipeline`
- On success: redirect to new pipeline detail page

**Backend:** Consumes existing `POST /pipeline` endpoint.

---

## Stage 7 — Live Updates

**Goal:** Pipeline detail and list pages reflect real-time state without manual refresh.

**Scope:**
- React Query `refetchInterval` on pipeline detail + list (configurable, e.g. 5s)
- Visual "LIVE" indicator badge when polling is active
- Stale-data overlay when pipeline is in a terminal state (polling stops)
- Graceful handling of pipeline-not-found after cancellation

**Backend:** None required — polling existing endpoints.

---

## Stage 8 — Staged Items Viewer

**Goal:** Show staged phases, sprints, and tasks inline per pipeline.

**Scope:**
- Collapsible panel on Pipeline Detail: "Staged Work"
- Tabs or sections: Phases / Sprints / Tasks
- New Next.js proxy routes:
  - `GET /api/pipelines/[id]/staged/phases`
  - `GET /api/pipelines/[id]/staged/sprints`
  - `GET /api/pipelines/[id]/staged/tasks`

**Backend:** Consumes existing `GET /pipeline/:id/staged/phases|sprints|tasks` endpoints.

---

## Stage 9 — Rich Artifact Rendering

**Goal:** Improve artifact readability beyond raw `<pre>` text.

**Scope:**
- `react-markdown` rendering for `.md` files in ArtifactViewer
- JSON syntax highlighting (e.g. `react-json-view` or manual tokenization)
- File type detection from path extension
- (Phase 2) Diff view between artifact versions

**Backend:** None required.

---

## Stage 10 — Auth + Identity

**Goal:** Real session identity; replace hardcoded `actor = "operator"`.

**Scope:**
- Login page + session management (provider TBD: NextAuth, Clerk, or custom)
- Actor identity threaded into action proxy routes
- Access control: admin-only actions gated in UI
- User display in PipelineHeader and ActionBar

**Backend:** May require new `/auth` or `/session` endpoints.

**Note:** Deliberately last — system is internal/operator-facing with no public users until this stage.

---

## Decisions

- Backend is feature-complete for Stages 3–8: no backend changes required
- `actor = "operator"` (hardcoded) is acceptable through Stage 9
- Each stage begins with a detailed slice plan; no implementation starts without one
- Stages are ordered by dependency + user value: Shell → Navigation → Content → Polish → Auth

## Related Documents

- `docs/ux/views/global-layout.md` — shell wireframe
- `docs/ux/views/pipeline-list.md` — pipeline list wireframe
- `docs/ux/views/project-detail.md` — project detail wireframe
- `docs/ux/views/pipeline-detail.md` — pipeline detail wireframe (Slices 1+2 complete)
- `docs/roadmap/implementation_plan.md` — backend phase plan
