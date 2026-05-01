import type { PipelineRun, PipelineStatus } from "@/types";

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

interface PipelineHeaderProps {
  pipeline: PipelineRun;
}

export function PipelineHeader({ pipeline }: PipelineHeaderProps) {
  const mode = (pipeline.metadata as Record<string, unknown>)?.execution_mode as
    | string
    | undefined;

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Pipeline
          </p>
          <h1 className="mt-0.5 font-mono text-sm text-gray-800">
            {pipeline.pipeline_id}
          </h1>
        </div>
        <StatusBadge status={pipeline.status} />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">Current step:</dt>
          <dd>{pipeline.current_step}</dd>
        </div>
        {mode && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Mode:</dt>
            <dd>{mode}</dd>
          </div>
        )}
        {pipeline.sprint_branch && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Branch:</dt>
            <dd className="font-mono">{pipeline.sprint_branch}</dd>
          </div>
        )}
        {pipeline.pr_url && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">PR:</dt>
            <dd>
              <a
                href={pipeline.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                #{pipeline.pr_number}
              </a>
            </dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">Updated:</dt>
          <dd>
            {new Date(pipeline.updated_at).toLocaleString()}
          </dd>
        </div>
      </dl>
    </header>
  );
}
