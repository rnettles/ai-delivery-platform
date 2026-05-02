"use client";

import { useEffect, useState } from "react";
import { useStagedPhases } from "@/hooks/useStagedPhases";
import { useStagedSprints } from "@/hooks/useStagedSprints";
import { useStagedTasks } from "@/hooks/useStagedTasks";
import { ArtifactBadge } from "./ArtifactBadge";
import type {
  StagedPhaseRecord,
  StagedSprintRecord,
  StagedTaskRecord,
} from "@/types";

type Tab = "phases" | "sprints" | "tasks";

interface StagedWorkPanelProps {
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
}

function SkeletonRows() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3].map((n) => (
        <div key={n} className="h-10 rounded bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="p-4 text-sm text-gray-400">No {label} found for this pipeline.</p>
  );
}

function PhaseRow({
  phase,
  pipelineId,
  onSelect,
}: {
  phase: StagedPhaseRecord;
  pipelineId: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-gray-100 bg-white px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-800 truncate">{phase.name ?? phase.phase_id}</p>
        <div className="mt-1">
          <ArtifactBadge path={phase.artifact_path} pipelineId={pipelineId} onSelect={onSelect} />
        </div>
      </div>
      <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        {phase.status}
      </span>
    </div>
  );
}

function SprintRow({
  sprint,
  pipelineId,
  onSelect,
}: {
  sprint: StagedSprintRecord;
  pipelineId: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-gray-100 bg-white px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-800 truncate">{sprint.name ?? sprint.sprint_id}</p>
        <div className="mt-1">
          <ArtifactBadge path={sprint.sprint_plan_path} pipelineId={pipelineId} onSelect={onSelect} />
        </div>
      </div>
      <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        {sprint.status}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  pipelineId,
  onSelect,
}: {
  task: StagedTaskRecord;
  pipelineId: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded border border-gray-100 bg-white px-3 py-2 text-sm">
      <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
      <div className="min-w-0 flex-1">
        <p className="text-gray-800 truncate">{task.label}</p>
        <p className="text-xs text-gray-400 font-mono">{task.task_id}</p>
        <div className="mt-1">
          <ArtifactBadge path={task.sprint_plan_path} pipelineId={pipelineId} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}

export function StagedWorkPanel({ pipelineId, onArtifactSelect }: StagedWorkPanelProps) {
  const phasesQuery = useStagedPhases(pipelineId);
  const sprintsQuery = useStagedSprints(pipelineId);
  const tasksQuery = useStagedTasks(pipelineId);

  const phaseCount = phasesQuery.data?.phases.length ?? 0;
  const sprintCount = sprintsQuery.data?.sprints.length ?? 0;
  const taskCount = tasksQuery.data?.tasks.length ?? 0;
  const totalCount = phaseCount + sprintCount + taskCount;

  // Auto-open on mount; start open so the panel is immediately visible.
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("phases");
  const [tabAutoSelected, setTabAutoSelected] = useState(false);

  // Once all queries finish loading, pick the best default tab (tasks > sprints > phases).
  // Only fires once so subsequent user tab clicks are not overridden.
  useEffect(() => {
    if (tabAutoSelected) return;
    if (phasesQuery.isLoading || sprintsQuery.isLoading || tasksQuery.isLoading) return;
    const best: Tab = taskCount > 0 ? "tasks" : sprintCount > 0 ? "sprints" : "phases";
    setActiveTab(best);
    setTabAutoSelected(true);
  }, [
    tabAutoSelected,
    phasesQuery.isLoading,
    sprintsQuery.isLoading,
    tasksQuery.isLoading,
    taskCount,
    sprintCount,
  ]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "phases", label: "Phases", count: phaseCount },
    { id: "sprints", label: "Sprints", count: sprintCount },
    { id: "tasks", label: "Tasks", count: taskCount },
  ];

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-gray-100 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          Staged Work
          {totalCount > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {totalCount}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-6 pb-4">
          {/* Tab bar */}
          <div className="mb-3 flex gap-1 border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "phases" && (
            <div className="space-y-2">
              {phasesQuery.isLoading && <SkeletonRows />}
              {phasesQuery.isError && (
                <p className="text-sm text-red-600">Failed to load phases.</p>
              )}
              {phasesQuery.data && phasesQuery.data.phases.length === 0 && (
                <EmptyState label="phases" />
              )}
              {phasesQuery.data?.phases.map((phase) => (
                <PhaseRow key={phase.phase_id} phase={phase} pipelineId={pipelineId} onSelect={onArtifactSelect} />
              ))}
            </div>
          )}

          {activeTab === "sprints" && (
            <div className="space-y-2">
              {sprintsQuery.isLoading && <SkeletonRows />}
              {sprintsQuery.isError && (
                <p className="text-sm text-red-600">Failed to load sprints.</p>
              )}
              {sprintsQuery.data && sprintsQuery.data.sprints.length === 0 && (
                <EmptyState label="sprints" />
              )}
              {sprintsQuery.data?.sprints.map((sprint) => (
                <SprintRow key={sprint.sprint_id} sprint={sprint} pipelineId={pipelineId} onSelect={onArtifactSelect} />
              ))}
            </div>
          )}

          {activeTab === "tasks" && (
            <div className="space-y-2">
              {tasksQuery.isLoading && <SkeletonRows />}
              {tasksQuery.isError && (
                <p className="text-sm text-red-600">Failed to load tasks.</p>
              )}
              {tasksQuery.data && tasksQuery.data.tasks.length === 0 && (
                <EmptyState label="tasks" />
              )}
              {tasksQuery.data?.tasks.map((task) => (
                <TaskRow key={task.task_id} task={task} pipelineId={pipelineId} onSelect={onArtifactSelect} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
