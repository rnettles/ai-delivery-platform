"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useProjectWork } from "@/hooks/useProjectWork";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import { useProjectBranches } from "@/hooks/useProjectBranches";
import { WorkStatusBadge } from "@/components/work/WorkStatusBadge";
import type { WorkPhase, WorkSprint, WorkTask } from "@/hooks/useProjectWork";
import type { PipelineStatus, PipelineStatusChoice, ProjectBranchSummary } from "@/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

// ── Raw status helpers ───────────────────────────────────────────────────────

const RAW_STATUS_LABELS: Record<string, string> = {
  ready_for_verification: "Ready for Review",
  approved:               "Approved",
  staged:                 "Staged",
  planning:               "Planning",
  awaiting_approval:      "Awaiting Approval",
  awaiting_pr_review:     "Awaiting PR Review",
};

function rawStatusLabel(status: string): string {
  return (
    RAW_STATUS_LABELS[status] ??
    status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

function RawStatusChip({ status }: { status: string }) {
  const isApproved = status === "approved";
  const cls = isApproved
    ? "rounded border px-1.5 py-0.5 text-xs bg-green-50 text-green-600 border-green-200"
    : "rounded border px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 border-gray-200";
  return <span className={cls}>{rawStatusLabel(status)}</span>;
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <RawStatusChip status={sprint.status} />
          <WorkStatusBadge status={sprint.workStatus} />
        </div>
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
        <div className="flex items-center gap-2 flex-shrink-0">
          {phase.sprints.length > 0 && (
            <span className="text-xs text-gray-400">
              {phase.sprints.length} sprint{phase.sprints.length !== 1 ? "s" : ""}
            </span>
          )}
          <RawStatusChip status={phase.status} />
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

// ── Pipeline status badge (for Execution tab) ────────────────────────────────

const PIPELINE_STATUS_STYLES: Record<PipelineStatus, string> = {
  running:            "bg-blue-100 text-blue-800",
  awaiting_approval:  "bg-yellow-100 text-yellow-800",
  awaiting_pr_review: "bg-purple-100 text-purple-800",
  paused_takeover:    "bg-orange-100 text-orange-800",
  failed:             "bg-red-100 text-red-800",
  complete:           "bg-green-100 text-green-800",
  cancelled:          "bg-gray-100 text-gray-600",
};

const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  running:            "Running",
  awaiting_approval:  "Awaiting Approval",
  awaiting_pr_review: "PR Review",
  paused_takeover:    "Paused",
  failed:             "Failed",
  complete:           "Complete",
  cancelled:          "Cancelled",
};

function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${PIPELINE_STATUS_STYLES[status]}`}
    >
      {PIPELINE_STATUS_LABELS[status]}
    </span>
  );
}

// ── BranchCard (Execution tab) ───────────────────────────────────────────────

const ACTIVE_STATUSES: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "awaiting_pr_review",
  "paused_takeover",
];

function BranchCard({
  branch,
  pipelines,
}: {
  branch: ProjectBranchSummary;
  pipelines: PipelineStatusChoice[];
}) {
  const defaultOpen = ACTIVE_STATUSES.includes(branch.status) || branch.status === "failed";
  const [open, setOpen] = useState(defaultOpen);

  // Active pipelines first within each branch
  const sorted = [...pipelines].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.includes(a.status) ? 0 : 1;
    const bActive = ACTIVE_STATUSES.includes(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

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
            <p className="font-mono text-sm text-gray-900 truncate">{branch.sprint_branch}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {branch.current_step} · {new Date(branch.updated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">{pipelines.length} run{pipelines.length !== 1 ? "s" : ""}</span>
          <PipelineStatusBadge status={branch.status} />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 pb-4 pt-2 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">No runs yet.</p>
          ) : (
            sorted.map((p) => (
              <Link
                key={p.pipeline_id}
                href={`/pipelines/${p.pipeline_id}`}
                className="flex items-center justify-between gap-4 rounded border border-gray-200 bg-white px-3 py-2 text-sm hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-gray-500 truncate">{p.pipeline_id}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {p.current_step}
                    {p.current_actor ? ` · ${p.current_actor}` : ""}
                    {" · "}
                    {new Date(p.updated_at).toLocaleString()}
                  </p>
                  {p.wait_state && (
                    <p className="text-xs text-amber-600 mt-0.5">{p.wait_state}</p>
                  )}
                </div>
                <PipelineStatusBadge status={p.status} />
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── ExecutionTab ─────────────────────────────────────────────────────────────

const STATUS_SORT_ORDER: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "awaiting_pr_review",
  "paused_takeover",
  "failed",
  "complete",
  "cancelled",
];

type FilterStatus = PipelineStatus | "all";

function ExecutionTab({ projectId }: { projectId: string }) {
  const { data: branches, isLoading: branchesLoading } = useProjectBranches(projectId);
  const { data: allPipelines, isLoading: pipelinesLoading } = useProjectPipelines(projectId);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  const isLoading = branchesLoading || pipelinesLoading;

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-16 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (!branches || branches.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">No branches have been executed yet.</p>
    );
  }

  // Group pipelines by sprint_branch
  const pipelinesByBranch = new Map<string, PipelineStatusChoice[]>();
  for (const p of allPipelines ?? []) {
    if (!p.sprint_branch) continue;
    const existing = pipelinesByBranch.get(p.sprint_branch) ?? [];
    pipelinesByBranch.set(p.sprint_branch, [...existing, p]);
  }

  // Derive filter options from statuses actually present
  const presentStatuses = STATUS_SORT_ORDER.filter((s) =>
    branches.some((b) => b.status === s)
  );

  // Apply filter
  const visibleBranches = filterStatus === "all"
    ? branches
    : branches.filter((b) => b.status === filterStatus);

  // Sort: active first, failed, complete/cancelled last
  const sortedBranches = [...visibleBranches].sort((a, b) => {
    const aOrder = STATUS_SORT_ORDER.indexOf(a.status);
    const bOrder = STATUS_SORT_ORDER.indexOf(b.status);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus("all")}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            filterStatus === "all"
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
          }`}
        >
          All ({branches.length})
        </button>
        {presentStatuses.map((s) => {
          const count = branches.filter((b) => b.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filterStatus === s
                  ? "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {PIPELINE_STATUS_LABELS[s]} ({count})
            </button>
          );
        })}
      </div>

      {/* Branch cards */}
      {sortedBranches.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No branches match this filter.</p>
      ) : (
        <div className="space-y-3">
          {sortedBranches.map((branch) => (
            <BranchCard
              key={branch.sprint_branch}
              branch={branch}
              pipelines={pipelinesByBranch.get(branch.sprint_branch) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WorkPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: pipelines } = useProjectPipelines(id);
  const [activeTab, setActiveTab] = useState<"plan" | "execution">("plan");

  const awaitingPipeline = pipelines?.find((p) => p.status === "awaiting_approval");

  // Pass all non-terminal pipeline IDs so useProjectWork can supplement default-branch
  // plan data with artifact-store data from active feature branches.
  const activePipelineIds = (pipelines ?? [])
    .filter((p) => !["complete", "cancelled"].includes(p.status))
    .map((p) => p.pipeline_id);

  const { phases, isLoading, isError, error } = useProjectWork(id, activePipelineIds);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-6 border-b border-gray-200">
        {(["plan", "execution"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "plan" ? "Plan" : "Execution"}
          </button>
        ))}
      </div>

      {/* Approval banner */}
      {activeTab === "plan" && awaitingPipeline && (
        <div className="mb-4 flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>
            Pipeline awaiting approval — <span className="font-semibold">{awaitingPipeline.current_step}</span> step complete
          </span>
          <Link
            href={`/pipelines/${awaitingPipeline.pipeline_id}`}
            className="ml-4 whitespace-nowrap font-medium underline hover:text-amber-900"
          >
            Review →
          </Link>
        </div>
      )}

      {/* Plan tab */}
      {activeTab === "plan" && (
        <>
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
        </>
      )}

      {/* Execution tab */}
      {activeTab === "execution" && <ExecutionTab projectId={id} />}
    </div>
  );
}
