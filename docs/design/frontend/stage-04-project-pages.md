# Stage 4 — Project Pages

## Status: READY FOR IMPLEMENTATION

## Prerequisites

**Stage 3 (Application Shell) must be complete before starting this stage.**

After Stage 3 the following exist:
- `platform/frontend/app/(shell)/layout.tsx` — sidebar shell
- `platform/frontend/components/layout/Sidebar.tsx` — nav sidebar
- `platform/frontend/app/page.tsx` — redirects to `/projects` (currently 404)

**Stack:** Next.js 16 App Router · TypeScript · Tailwind CSS v4 · React Query

---

## Goal

Add two project views:
- `/projects` — list of all projects
- `/projects/[id]` — project detail with metadata

Both live inside the `(shell)` route group so they automatically get the sidebar.
The "Projects" sidebar link becomes functional after this stage.

---

## Backend Endpoints Being Consumed

| Method | Backend URL | Purpose |
|---|---|---|
| `GET` | `/projects` | List all projects |
| `GET` | `/projects/:projectId` | Get single project with channels |

Backend base URL: read from `NEXT_PUBLIC_API_URL` env var (already used by existing api-client).

---

## Implementation

### Phase A — Project type

**Update file:** `platform/frontend/types/pipeline.ts`

Add to the bottom of the file:

```ts
export interface ProjectChannel {
  channel_id: string;
  channel_name?: string;
}

export interface Project {
  project_id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  channels?: ProjectChannel[];
  created_at: string;
  updated_at: string;
}
```

---

### Phase B — API proxy routes

**New file:** `platform/frontend/app/api/projects/route.ts`

```ts
import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${BACKEND}/projects?include_channels=true`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: res.status });
  }
  const data = await res.json();
  return NextResponse.json(data);
}
```

**New file:** `platform/frontend/app/api/projects/[id]/route.ts`

```ts
import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Project not found" }, { status: res.status });
  }
  const data = await res.json();
  return NextResponse.json(data);
}
```

Note: Use `BACKEND_URL` env var (server-side, not `NEXT_PUBLIC_`) to match the existing
pattern in `platform/frontend/app/api/pipelines/[id]/actions/route.ts`.

---

### Phase C — API client functions

**Update file:** `platform/frontend/lib/api-client.ts`

Add these two functions:

```ts
export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`Failed to fetch project: ${projectId}`);
  return res.json();
}
```

Add the `Project` import from `@/types` at the top of the file.

---

### Phase D — React Query hooks

**New file:** `platform/frontend/hooks/useProjects.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchProjects, fetchProject } from "@/lib/api-client";
import type { Project } from "@/types";

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });
}

export function useProject(projectId: string) {
  return useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId),
  });
}
```

---

### Phase E — Project list page

**New file:** `platform/frontend/app/(shell)/projects/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/types";

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.project_id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50"
    >
      <p className="font-medium text-gray-900">{project.name}</p>
      <p className="mt-1 font-mono text-xs text-gray-500 truncate">{project.repo_url}</p>
      <p className="mt-1 text-xs text-gray-400">Branch: {project.default_branch}</p>
      {project.channels && project.channels.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          {project.channels.length} channel{project.channels.length !== 1 ? "s" : ""}
        </p>
      )}
    </Link>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading, isError } = useProjects();

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-4 h-6 w-40 rounded bg-gray-200 animate-pulse" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-gray-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load projects.
        </div>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center text-sm text-gray-400">
        No projects found.
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Projects</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.project_id} project={project} />
        ))}
      </div>
    </div>
  );
}
```

---

### Phase F — Project detail page

**New file:** `platform/frontend/app/(shell)/projects/[id]/page.tsx`

```tsx
"use client";

import { use } from "react";
import Link from "next/link";
import { useProject } from "@/hooks/useProjects";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: project, isLoading, isError } = useProject(id);

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse">
        <div className="mb-4 h-6 w-48 rounded bg-gray-200" />
        <div className="h-4 w-64 rounded bg-gray-200" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Project not found.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">{project.name}</h1>
      <p className="mb-6 font-mono text-xs text-gray-500">{project.repo_url}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm mb-8">
        <dt className="font-medium text-gray-500">Default branch</dt>
        <dd className="text-gray-800">{project.default_branch}</dd>

        <dt className="font-medium text-gray-500">Project ID</dt>
        <dd className="font-mono text-xs text-gray-600">{project.project_id}</dd>

        {project.channels && project.channels.length > 0 && (
          <>
            <dt className="font-medium text-gray-500">Slack channels</dt>
            <dd className="text-gray-800">
              {project.channels.map((ch) => ch.channel_id).join(", ")}
            </dd>
          </>
        )}
      </dl>

      <Link
        href={`/projects/${project.project_id}/pipelines`}
        className="inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
      >
        View Pipelines →
      </Link>
    </div>
  );
}
```

---

## File Summary

### New Files
- `platform/frontend/app/api/projects/route.ts`
- `platform/frontend/app/api/projects/[id]/route.ts`
- `platform/frontend/hooks/useProjects.ts`
- `platform/frontend/app/(shell)/projects/page.tsx`
- `platform/frontend/app/(shell)/projects/[id]/page.tsx`

### Modified Files
- `platform/frontend/types/pipeline.ts` — add `Project`, `ProjectChannel` types
- `platform/frontend/lib/api-client.ts` — add `fetchProjects`, `fetchProject`

### Unchanged Files
- All files from Stages 1–3
- `platform/frontend/app/(shell)/layout.tsx`
- `platform/frontend/components/layout/Sidebar.tsx`

---

## Types Reference

Export the new types from `platform/frontend/types/index.ts` (or wherever the barrel export lives).
Check how existing types are re-exported and follow the same pattern.

---

## Verification

1. `cd platform/frontend && npm run dev` (also ensure `cd platform/backend-api && npm run dev` is running)
2. Navigate to `http://localhost:3000/projects` → renders project list with cards
3. Each card shows: name, repo URL, default branch, channel count
4. Click a project card → navigates to `/projects/{project_id}`
5. Project detail shows name, repo URL, default branch, project ID, channels
6. "View Pipelines →" link navigates to `/projects/{id}/pipelines` (404 is acceptable — Stage 5)
7. Sidebar "Projects" link is highlighted when on `/projects/*`
8. Back navigation: browser back button returns to project list
9. `cd platform/frontend && npx tsc --noEmit` → zero TypeScript errors

---

## Decisions

- `Project` type added to `types/pipeline.ts` alongside other domain types (single domain types file)
- `include_channels=true` passed in proxy to `GET /projects` so channel data is available on the list page
- No pagination — project list is expected to be small (operator-internal tool)
- "View Pipelines" CTA on project detail links to Stage 5 URL — acceptable 404 until then
- Project creation form deferred to Stage 6

## Out of Scope (later stages)

- Pipeline creation form on project detail (Stage 6)
- Project creation UI
- Editing project metadata
