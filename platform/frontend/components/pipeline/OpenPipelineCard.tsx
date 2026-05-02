import Link from "next/link";
import type { PipelineStatus, PipelineStatusChoice } from "@/types";

const STATUS_STYLES: Record<PipelineStatus, { badge: string; border: string; dot: string }> = {
  running:            { badge: "bg-blue-100 text-blue-800",   border: "border-blue-300",  dot: "bg-blue-500 animate-pulse" },
  awaiting_approval:  { badge: "bg-yellow-100 text-yellow-800", border: "border-yellow-300", dot: "bg-yellow-500" },
  awaiting_pr_review: { badge: "bg-purple-100 text-purple-800", border: "border-purple-300", dot: "bg-purple-500" },
  paused_takeover:    { badge: "bg-orange-100 text-orange-800", border: "border-orange-300", dot: "bg-orange-500" },
  failed:             { badge: "bg-red-100 text-red-800",     border: "border-red-300",    dot: "bg-red-500" },
  complete:           { badge: "bg-green-100 text-green-800", border: "border-green-300",  dot: "bg-green-500" },
  cancelled:          { badge: "bg-gray-100 text-gray-600",   border: "border-gray-200",   dot: "bg-gray-400" },
};

const STEP_LABELS: Record<string, string> = {
  planner:           "Planner",
  "sprint-controller": "Sprint Controller",
  implementer:       "Implementer",
  verifier:          "Verifier",
  complete:          "Complete",
};

interface OpenPipelineCardProps {
  pipeline: PipelineStatusChoice;
}

export function OpenPipelineCard({ pipeline }: OpenPipelineCardProps) {
  const style = STATUS_STYLES[pipeline.status];
  const stepLabel = STEP_LABELS[pipeline.current_step] ?? pipeline.current_step;
  const updatedAt = new Date(pipeline.updated_at).toLocaleString();

  return (
    <Link
      href={`/pipelines/${pipeline.pipeline_id}`}
      className={`block rounded-lg border-2 bg-white p-4 shadow-sm transition-all hover:shadow-md ${style.border}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${style.dot}`} />
          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${style.badge}`}>
            {pipeline.status.replace(/_/g, " ")}
          </span>
        </div>
        <span className="font-mono text-[10px] text-gray-400 truncate max-w-[180px]">
          {pipeline.pipeline_id}
        </span>
      </div>

      {/* Current step — primary info */}
      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Current Step</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{stepLabel}</p>
      </div>

      {/* Secondary meta */}
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {pipeline.sprint_branch && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Branch:</dt>
            <dd className="font-mono">{pipeline.sprint_branch}</dd>
          </div>
        )}
        {pipeline.current_actor && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Actor:</dt>
            <dd>{pipeline.current_actor}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">Updated:</dt>
          <dd>{updatedAt}</dd>
        </div>
      </dl>

      {/* Wait state callout */}
      {pipeline.wait_state && (
        <div className="mt-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {pipeline.wait_state}
        </div>
      )}
    </Link>
  );
}
