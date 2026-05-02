# Stage 3 — Application Shell

## Status: READY FOR IMPLEMENTATION

## Context (What's Already Built)

This is the third stage of the AI Delivery Platform frontend build.

**Already complete:**
- `platform/frontend/app/pipelines/[id]/page.tsx` — Pipeline Detail page (fully functional)
- All pipeline components: `PipelineHeader`, `PipelineTimeline`, `ActionBar`, `SidePanel`,
  `ArtifactViewer`, `GateCard`, `StepGroup`, `StepCard`, `ArtifactBadge`
- `platform/frontend/app/layout.tsx` — root HTML shell with fonts + ReactQueryProvider
- `platform/frontend/app/page.tsx` — Next.js default landing page (to be replaced)

**Stack:** Next.js 16 App Router · TypeScript · Tailwind CSS v4 · React Query

---

## Goal

Add a persistent sidebar and shell layout that wraps all pages. Establish the URL structure.
The existing pipeline detail page moves into the shell group — no URL changes.

---

## Implementation

### Phase A — Sidebar component

**New file:** `platform/frontend/components/layout/Sidebar.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { label: "Projects", href: "/projects" },
  ];

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="px-4 py-5 border-b border-gray-100">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          AI Delivery Platform
        </span>
      </div>
      <ul className="flex flex-col gap-1 p-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`block rounded px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

---

### Phase B — Shell layout (route group)

**New file:** `platform/frontend/app/(shell)/layout.tsx`

```tsx
import { Sidebar } from "@/components/layout/Sidebar";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

Note: This is a server component (no `"use client"`). The Sidebar itself is client-side for `usePathname`.

---

### Phase C — Move pipeline detail into shell group

**Action:** Create new file at `platform/frontend/app/(shell)/pipelines/[id]/page.tsx`
with the content of the existing `platform/frontend/app/pipelines/[id]/page.tsx`,
then delete the old file and directory `platform/frontend/app/pipelines/`.

**Content change:** Remove `min-h-screen` from the root `<div>` — the shell layout owns the viewport height.

```tsx
// Change this:
<div className="flex min-h-screen flex-col">

// To this:
<div className="flex flex-col">
```

All other content is identical to the existing pipeline detail page.

---

### Phase D — Root page redirect

**Update file:** `platform/frontend/app/page.tsx`

Replace all existing content with:

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/projects");
}
```

Note: `/projects` will return 404 until Stage 4 is implemented. This is acceptable.

---

## File Summary

### New Files
- `platform/frontend/components/layout/Sidebar.tsx`
- `platform/frontend/app/(shell)/layout.tsx`
- `platform/frontend/app/(shell)/pipelines/[id]/page.tsx` (moved from `app/pipelines/[id]/`)

### Modified Files
- `platform/frontend/app/page.tsx` — replace with redirect

### Deleted Files
- `platform/frontend/app/pipelines/[id]/page.tsx`
- `platform/frontend/app/pipelines/[id]/` directory
- `platform/frontend/app/pipelines/` directory (if now empty)

### Unchanged Files
- `platform/frontend/app/layout.tsx` — do not modify
- All pipeline components in `platform/frontend/components/pipeline/`
- All hooks, lib, and types files

---

## Verification

1. `cd platform/frontend && npm run dev`
2. Navigate to `http://localhost:3000/` → should redirect to `/projects` (404 page is acceptable)
3. Navigate to `http://localhost:3000/pipelines/{any-pipeline-id}` → pipeline detail renders with sidebar on the left
4. Sidebar shows "AI Delivery Platform" header and "Projects" link
5. "Projects" link is highlighted when on `/projects/*` routes (not highlighted on `/pipelines/*`)
6. No layout shift or double-scrollbar: only the main content area scrolls, not the whole page
7. `cd platform/frontend && npx tsc --noEmit` → zero TypeScript errors

---

## Decisions

- Route group `(shell)` used so a future `/login` page (Stage 10) can exist outside the shell without restructuring
- URL `/pipelines/[id]` is kept flat — pipeline IDs are globally unique UUIDs; project-scoped URLs not needed yet
- Sidebar is minimal (Projects only) — grows as subsequent stages add views
- Project selector dropdown deferred to Stage 5 (no project data available yet)
- `app/layout.tsx` root layout is untouched — ReactQueryProvider stays at root level

## Out of Scope (later stages)

- Project selector in sidebar (Stage 5)
- Active pipeline badge/count in sidebar (Stage 7)
- Mobile/responsive layout
