"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import { LiveBadge } from "@/components/LiveBadge";
import type { PipelineStatusChoice, PipelineStatus } from "@/types";

type DateRange = "today" | "yesterday" | "last7" | "all";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  today:     "Today",
  yesterday: "Yesterday",
  last7:     "Last 7 days",
  all:       "All time",
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function filterByDateRange(pipelines: PipelineStatusChoice[], range: DateRange): PipelineStatusChoice[] {
  if (range === "all") return pipelines;
  const now = new Date();
  const todayStart = startOfDay(now);
  if (range === "today") {
    return pipelines.filter((p) => new Date(p.updated_at) >= todayStart);
  }
  if (range === "yesterday") {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return pipelines.filter((p) => {
      const d = new Date(p.updated_at);
      return d >= yesterdayStart && d < todayStart;
    });
  }
  // last7
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  return pipelines.filter((p) => new Date(p.updated_at) >= sevenDaysAgo);
}

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

function PipelineRow({ pipeline }: { pipeline: PipelineStatusChoice }) {
  const updatedAt = new Date(pipeline.updated_at).toLocaleString();

  return (
    <Link
      href={`/pipelines/${pipeline.pipeline_id}`}
      className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-gray-500 truncate">{pipeline.pipeline_id}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {pipeline.current_step}
          {pipeline.current_actor ? ` · ${pipeline.current_actor}` : ""}
          {pipeline.sprint_branch ? ` · ${pipeline.sprint_branch}` : ""}
          {" · "}
          {updatedAt}
        </p>
        {pipeline.wait_state && (
          <p className="mt-0.5 text-xs text-amber-600">{pipeline.wait_state}</p>
        )}
      </div>
      <StatusBadge status={pipeline.status} />
    </Link>
  );
}

const INACTIVE_STATUSES: PipelineStatus[] = ["failed", "complete", "cancelled"];

const STATUS_ORDER: PipelineStatus[] = ["failed", "complete", "cancelled"];

const FILTER_LABEL: Record<PipelineStatus, string> = {
  running: "Running",
  awaiting_approval: "Awaiting Approval",
  awaiting_pr_review: "Awaiting PR Review",
  paused_takeover: "Paused Takeover",
  failed: "Failed",
  complete: "Complete",
  cancelled: "Cancelled",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectPipelinesPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: allPipelines, isLoading, isError, isLive } = useProjectPipelines(id);
  const [filterStatus, setFilterStatus] = useState<PipelineStatus | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("today");

  const inactivePipelines = (allPipelines ?? [])
    .filter((p) => INACTIVE_STATUSES.includes(p.status))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const pipelines = filterByDateRange(inactivePipelines, dateRange);

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

  if (!allPipelines || inactivePipelines.length === 0) {
    return (
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Inactive Pipelines</h1>
          <Link href={`/projects/${id}`} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back to project
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-gray-400">
          No inactive pipelines yet.
        </div>
      </div>
    );
  }

  // Build per-status counts from filtered (by date) pipelines
  const counts = pipelines.reduce<Partial<Record<PipelineStatus, number>>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  // Statuses present in this data, in priority order
  const presentStatuses = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  const visible = filterStatus
    ? pipelines.filter((p) => p.status === filterStatus)
    : pipelines;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-900">
            Inactive Pipelines
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({visible.length}{filterStatus ? ` of ${pipelines.length}` : ""})
            </span>
          </h1>
          <LiveBadge active={isLive} />
        </div>
        <div className="flex items-center gap-3">
          {/* Date range dropdown */}
          <select
            value={dateRange}
            onChange={(e) => {
              setDateRange(e.target.value as DateRange);
              setFilterStatus(null);
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((key) => (
              <option key={key} value={key}>
                {DATE_RANGE_LABELS[key]}
              </option>
            ))}
          </select>
          <Link href={`/projects/${id}`} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back to project
          </Link>
        </div>
      </div>

      {/* Status filter pills */}
      {presentStatuses.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterStatus === null
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All ({pipelines.length})
          </button>
          {presentStatuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(filterStatus === s ? null : s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterStatus === s
                  ? `${STATUS_STYLES[s]} ring-2 ring-offset-1 ring-current`
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {FILTER_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-gray-400">
          No pipelines for {DATE_RANGE_LABELS[dateRange].toLowerCase()}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((pipeline) => (
            <PipelineRow key={pipeline.pipeline_id} pipeline={pipeline} />
          ))}
        </div>
      )}
    </div>
  );
}
