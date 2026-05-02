# Stage 5 — Pipeline List Page

## Status: READY FOR IMPLEMENTATION

## Prerequisites

**Stages 3 and 4 must be complete before starting this stage.**

After Stages 3–4 the following exist:
- `platform/frontend/app/(shell)/layout.tsx` — sidebar shell
- `platform/frontend/app/(shell)/projects/[id]/page.tsx` — project detail with "View Pipelines →" link
- `platform/frontend/app/api/projects/[id]/route.ts` — proxy returning project + channels
- `platform/frontend/hooks/useProjects.ts` — `useProject(id)` hook
- `platform/frontend/types/pipeline.ts` — includes `Project`, `ProjectChannel`, `PipelineRun`, `PipelineStatus`

**Stack:** Next.js 16 App Router · TypeScript · Tailwind CSS v4 · React Query

---

## Goal

Add `/projects/[id]/pipelines` — a list of recent pipelines for a project, showing status, entry
point, description, and last-updated time. Clicking a row navigates to the existing pipeline
detail page at `/pipelines/[id]`.

---

## Backend Endpoint Being Consumed

| Method | Backend URL | Purpose |
|---|---|---|
| `GET` | `/pipeline/status-summary/by-channel?channel_id=CHANNEL_ID&limit=50` | List pipelines for a channel |

The project's Slack channel ID (`channels[0].channel_id`) is used as the channel identifier.
The proxy route fetches the project first to obtain the channel, then fetches the pipeline list.

**Response shape** (inferred from backend — verify against
`platform/backend-api/src/services/pipeline.service.ts` method `listStatusByChannel`):

```ts
// Array of objects — backend may return a subset of PipelineRun fields
interface PipelineStatusSummary {
  pipeline_id: string;
  status: PipelineStatus;
  entry_point: string;
  current_step: string;
  description?: string;
  sprint_branch?: string;
  created_at: string;
  updated_at: string;
}
```

If the backend returns full `PipelineRun` objects, use `PipelineRun` type from existing types
instead and drop the `PipelineStatusSummary` type.

---

## Implementation

### Phase A — PipelineStatusSummary type

**Update file:** `platform/frontend/types/pipeline.ts`

Add to the bottom (only if the backend does NOT return full `PipelineRun` objects — confirm first):

```ts
export interface PipelineStatusSummary {
  pipeline_id: string;
  status: PipelineStatus;
  entry_point: string;
  current_step: string;
  description?: string;
  sprint_branch?: string;
  created_at: string;
  updated_at: string;
}
```

---

### Phase B — API proxy route

**New file:** `platform/frontend/app/api/projects/[id]/pipelines/route.ts`

```ts
import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;

  // Step 1: fetch project to get channel_id
  const projectRes = await fetch(`${BACKEND}/projects/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!projectRes.ok) {
    return NextResponse.json({ error: "Project not found" }, { status: projectRes.status });
  }
  const project = await projectRes.json();

  const channelId: string | undefined = project.channels?.[0]?.channel_id;
  if (!channelId) {
    // Project exists but has no channel — return empty list
    return NextResponse.json([]);
  }

  // Step 2: fetch pipelines for the channel
  const pipelinesRes = await fetch(
    `${BACKEND}/pipeline/status-summary/by-channel?channel_id=${encodeURIComponent(channelId)}&limit=50`,
    { cache: "no-store" }
  );
  if (!pipelinesRes.ok) {
    return NextResponse.json({ error: "Failed to fetch pipelines" }, { status: pipelinesRes.status });
  }
  const pipelines = await pipelinesRes.json();
  return NextResponse.json(pipelines);
}
```

---

### Phase C — API client function

**Update file:** `platform/frontend/lib/api-client.ts`

Add:

```ts
export async function fetchProjectPipelines(projectId: string): Promise<PipelineStatusSummary[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pipelines`);
  if (!res.ok) throw new Error("Failed to fetch pipelines");
  return res.json();
}
```

Add `PipelineStatusSummary` to the import from `@/types`.

---

### Phase D — React Query hook

**New file:** `platform/frontend/hooks/useProjectPipelines.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchProjectPipelines } from "@/lib/api-client";
import type { PipelineStatusSummary } from "@/types";

export function useProjectPipelines(projectId: string) {
  return useQuery<PipelineStatusSummary[]>({
    queryKey: ["project-pipelines", projectId],
    queryFn: () => fetchProjectPipelines(projectId),
    enabled: Boolean(projectId),
  });
}
```

---

### Phase E — Pipeline list page

**New file:** `platform/frontend/app/(shell)/projects/[id]/pipelines/page.tsx`

```tsx
"use client";

import { use } from "react";
import Link from "next/link";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import type { PipelineStatusSummary, PipelineStatus } from "@/types";

const STATUS_STYLES: Record<PipelineStatus, string> = {
  running:            "bg-blue-100 text-blue-800",
  awaiting_approval:  "bg-yellow-100 text-yellow-800",
  awaiting_pr_review: "bg-purple-100 text-purple-800",
  paused_takeover:    "bg-orange-100 text-orange-800",
  failed:             "bg-red-100 text-red-800",
  complete:           "bg-green-100 text-green-800",
  cancelled:          "bg-gray-100 text-gray-600",
};

function StatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PipelineListItem({ pipeline, projectId }: { pipeline: PipelineStatusSummary; projectId: string }) {
  const updatedAt = new Date(pipeline.updated_at).toLocaleString();

  return (
    <Link
      href={`/pipelines/${pipeline.pipeline_id}`}
      className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-gray-500 truncate">{pipeline.pipeline_id}</p>
        {pipeline.description && (
          <p className="mt-0.5 text-sm text-gray-700 truncate">{pipeline.description}</p>
        )}
        <p className="mt-0.5 text-xs text-gray-400">
          {pipeline.entry_point} · {pipeline.current_step} · {updatedAt}
        </p>
      </div>
      <StatusBadge status={pipeline.status} />
    </Link>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectPipelinesPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: pipelines, isLoading, isError } = useProjectPipelines(id);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-4 h-6 w-32 rounded bg-gray-200 animate-pulse" />
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load pipelines.
        </div>
      </div>
    );
  }

  if (!pipelines || pipelines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center text-sm text-gray-400">
        No pipelines found for this project.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Pipelines</h1>
        <Link
          href={`/projects/${id}`}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          ← Back to project
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {pipelines.map((pipeline) => (
          <PipelineListItem key={pipeline.pipeline_id} pipeline={pipeline} projectId={id} />
        ))}
      </div>
    </div>
  );
}
```

---

## File Summary

### New Files
- `platform/frontend/app/api/projects/[id]/pipelines/route.ts`
- `platform/frontend/hooks/useProjectPipelines.ts`
- `platform/frontend/app/(shell)/projects/[id]/pipelines/page.tsx`

### Modified Files
- `platform/frontend/types/pipeline.ts` — add `PipelineStatusSummary` (if needed — verify first)
- `platform/frontend/lib/api-client.ts` — add `fetchProjectPipelines`

### Unchanged Files
- All files from Stages 1–4

---

## Verification

1. `cd platform/frontend && npm run dev` (also ensure `cd platform/backend-api && npm run dev`)
2. Navigate to `/projects` → click a project → click "View Pipelines →"
3. `/projects/{id}/pipelines` renders a list of pipelines for that project
4. Each row shows: pipeline_id (monospace), description, entry_point, current_step, updated_at, status badge
5. Click a pipeline row → navigates to `/pipelines/{pipeline_id}` (existing Slice 1/2 detail page)
6. Project with no Slack channel assigned → empty state renders without error
7. Project not found → error state renders without crash
8. Back link returns to project detail page
9. `cd platform/frontend && npx tsc --noEmit` → zero TypeScript errors

---

## Decisions

- Proxy route does two backend fetches (project → channel → pipelines) rather than requiring
  a dedicated `GET /pipeline?project_id=...` backend endpoint — keeps backend unchanged
- `channels[0]` used as the primary channel — if a project has multiple channels, only the first
  is queried (sufficient for current operator use; multi-channel support is future scope)
- Returns empty list (not error) when project has no channel configured
- Pipeline rows link to `/pipelines/[id]` (flat URL) — matches existing pipeline detail route
- `limit=50` hardcoded in proxy — pagination deferred to later stage
- `StatusBadge` is duplicated from `PipelineHeader.tsx` — intentional for Stage 5
  (shared component extraction deferred until 3+ consumers exist)

## Out of Scope (later stages)

- Pagination of pipeline list
- Filter by status (backend supports it via `status` query param — UI not wired)
- Pipeline creation from this page (Stage 6)
- Live auto-refresh of pipeline status (Stage 7)
- Shared `StatusBadge` component extraction
