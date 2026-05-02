# Stage 7 — Live Updates

## Goal

Pipeline detail and list pages reflect real-time state without manual refresh.

---

## Scope

- `refetchInterval` polling on both **pipeline detail** (`usePipeline`) and **pipeline list**
  (`useProjectPipelines`) while any pipeline is in an active state
- Visual **"LIVE"** indicator badge rendered when polling is active
- **Stale-data overlay** on pipeline detail when status is terminal (polling has stopped)
- Graceful **404 handling** on pipeline detail after cancellation

---

## Active vs Terminal statuses

| Active (poll every 5 s) | Terminal (stop polling) |
|---|---|
| `running` | `complete` |
| `awaiting_approval` | `failed` |
| `awaiting_pr_review` | `cancelled` |
| `paused_takeover` | |

---

## Hook Changes

### `usePipeline` (updated)

Adds two new return values:

```ts
isLive: boolean  // true while refetchInterval is active (status is active)
isStale: boolean // true when status is terminal and data is present — "read-only snapshot"
```

`refetchInterval` was already present; this stage only surfaces the derived booleans.

### `useProjectPipelines` (updated)

Adds polling and two new return values:

```ts
isLive: boolean  // true when at least one pipeline in the list has an active status
```

Polling logic: poll every 5 s when any row has an active status; stop when all are terminal
or the list is empty.

---

## New Component

### `LiveBadge`

Location: `platform/frontend/components/LiveBadge.tsx`

```tsx
// Renders a pulsing green "LIVE" pill when active=true
<LiveBadge active={isLive} />
```

- When `active=true`: green pulsing dot + "LIVE" text
- When `active=false`: renders nothing (null)

---

## Pipeline Detail Page Changes

`platform/frontend/app/(shell)/pipelines/[id]/page.tsx`

- Pass `isLive` to `PipelineHeader` via new prop
- When `isStale=true`, render a dismissible banner:
  > "Pipeline has finished. This is a final snapshot."

### `PipelineHeader` (updated)

Accepts `isLive?: boolean` prop. Renders `<LiveBadge>` inline with the status badge.

---

## Pipeline List Page Changes

`platform/frontend/app/(shell)/projects/[id]/pipelines/page.tsx`

- Render `<LiveBadge active={isLive} />` in the page header row
- When a 404 is returned (pipeline cancelled and purged), show an empty-state instead
  of an error state

---

## Constraints

- Polling interval is 5 000 ms (5 s) — not configurable in the UI
- No WebSocket/SSE — polling only
- `actor` field remains hardcoded — no change
- No new backend routes required

---

## Files Changed

| File | Change |
|---|---|
| `hooks/usePipeline.ts` | expose `isLive`, `isStale` |
| `hooks/useProjectPipelines.ts` | add polling, expose `isLive` |
| `components/LiveBadge.tsx` | NEW |
| `components/pipeline/PipelineHeader.tsx` | accept + render `isLive` |
| `app/(shell)/pipelines/[id]/page.tsx` | stale banner, pass `isLive` |
| `app/(shell)/projects/[id]/pipelines/page.tsx` | LIVE badge, 404 handling |
