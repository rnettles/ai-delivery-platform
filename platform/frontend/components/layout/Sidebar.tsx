"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useCurrentProject } from "@/hooks/useCurrentProject";

function usePrGateCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/pr-gates");
        if (!res.ok) return;
        const data = (await res.json()) as unknown[];
        setCount(Array.isArray(data) ? data.length : 0);
      } catch {
        // silent — sidebar badge is best-effort
      }
    }
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, 30_000);
    return () => clearInterval(id);
  }, []);
  return count;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const prGateCount = usePrGateCount();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { currentProjectId, setCurrentProject } = useCurrentProject();

  // When visiting a project page, auto-set it as current
  const urlProjectMatch = pathname.match(/\/projects\/([^/]+)/);
  const urlProjectId = urlProjectMatch?.[1] ?? null;

  const currentProject = projects?.find((p) => p.project_id === currentProjectId);

  function handleProjectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (!id) return;
    setCurrentProject(id);
    router.push(`/projects/${id}`);
  }

  const bottomNavItems = [
    { label: "PR Gates", href: "/pr-gates", badge: prGateCount > 0 ? prGateCount : null },
    { label: "Logs", href: "/logs" },
  ];

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="px-4 py-5 border-b border-gray-100">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          AI Delivery Platform
        </span>
      </div>

      {/* Current project switcher */}
      <div className="border-b border-gray-100 px-3 py-3 flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Current Project
        </span>

        {projectsLoading ? (
          <div className="h-8 rounded bg-gray-100 animate-pulse" />
        ) : (
          <select
            value={currentProjectId ?? urlProjectId ?? ""}
            onChange={handleProjectChange}
            className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {!currentProjectId && !urlProjectId && (
              <option value="">— select a project —</option>
            )}
            {projects?.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {/* Back to current project — visible from any page */}
        {currentProject && (
          <Link
            href={`/projects/${currentProject.project_id}`}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              urlProjectId === currentProject.project_id && !pathname.includes("/work")
                ? "bg-blue-50 text-blue-700"
                : "text-blue-600 hover:bg-blue-50 hover:text-blue-800"
            }`}
          >
            <span>←</span>
            <span className="truncate">{currentProject.name}</span>
          </Link>
        )}

        {/* Work link — phases / sprints / tasks hierarchy */}
        {currentProject && (
          <Link
            href={`/projects/${currentProject.project_id}/work`}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              pathname.startsWith(`/projects/${currentProject.project_id}/work`)
                ? "bg-blue-50 text-blue-700"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
            }`}
          >
            <span className="ml-3">Work</span>
          </Link>
        )}
      </div>

      {/* Bottom nav */}
      <ul className="flex flex-col gap-1 p-2">
        {bottomNavItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center justify-between rounded px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.label}
                {"badge" in item && item.badge != null && (
                  <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-white">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
