"use client";

import { use, useState } from "react";
import { useProjectWork } from "@/hooks/useProjectWork";
import { WorkStatusBadge } from "@/components/work/WorkStatusBadge";
import type { WorkPhase, WorkSprint, WorkTask } from "@/hooks/useProjectWork";

interface PageProps {
  params: Promise<{ id: string }>;
}

// ── Task row ────────────────────────────────────────────────────────────────

function TaskRow({ task }: { task: WorkTask }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-gray-100 bg-white px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-xs text-gray-400 mr-2">{task.task_id}</span>
        <span className="text-gray-700">{task.label}</span>
      </div>
      <WorkStatusBadge status={task.workStatus} />
    </div>
  );
}

// ── Sprint accordion ─────────────────────────────────────────────────────────

function SprintAccordion({
  sprint,
  defaultOpen,
}: {
  sprint: WorkSprint;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded border border-gray-200 bg-gray-50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-100 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-400 mr-1">{open ? "▼" : "▶"}</span>
          <span className="font-medium text-sm text-gray-800 truncate">
            {sprint.name ?? sprint.sprint_id}
          </span>
          <span className="font-mono text-xs text-gray-400 hidden sm:inline">
            {sprint.sprint_id}
          </span>
        </div>
        <WorkStatusBadge status={sprint.workStatus} />
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 space-y-1.5 border-t border-gray-200 bg-white">
          {sprint.tasks.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">No tasks found.</p>
          ) : (
            sprint.tasks.map((task) => <TaskRow key={task.task_id} task={task} />)
          )}
        </div>
      )}
    </div>
  );
}

// ── Phase accordion ──────────────────────────────────────────────────────────

function PhaseAccordion({ phase }: { phase: WorkPhase }) {
  const defaultOpen = phase.workStatus === "current";
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm text-gray-400">{open ? "▼" : "▶"}</span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">
              {phase.name ?? phase.phase_id}
            </p>
            <p className="font-mono text-xs text-gray-400">{phase.phase_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {phase.sprints.length > 0 && (
            <span className="text-xs text-gray-400">
              {phase.sprints.length} sprint{phase.sprints.length !== 1 ? "s" : ""}
            </span>
          )}
          <WorkStatusBadge status={phase.workStatus} />
        </div>
      </button>

      {open && (
        <div className="px-5 pb-4 pt-1 space-y-2 border-t border-gray-100 bg-gray-50">
          {phase.sprints.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No sprints found for this phase.</p>
          ) : (
            phase.sprints.map((sprint) => (
              <SprintAccordion
                key={sprint.sprint_id}
                sprint={sprint}
                defaultOpen={sprint.workStatus === "current"}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2].map((n) => (
        <div key={n} className="h-16 rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WorkPage({ params }: PageProps) {
  const { id } = use(params);
  const { phases, isLoading, isError, error } = useProjectWork(id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-base font-semibold text-gray-900">Work</h1>

      {isLoading && <Skeleton />}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error instanceof Error ? error.message : "Failed to load work hierarchy."}
        </div>
      )}

      {phases && phases.length === 0 && !isLoading && (
        <p className="text-sm text-gray-500">No phases found for this project.</p>
      )}

      {phases && phases.length > 0 && (
        <div className="space-y-3">
          {phases.map((phase) => (
            <PhaseAccordion key={phase.phase_id} phase={phase} />
          ))}
        </div>
      )}
    </div>
  );
}
