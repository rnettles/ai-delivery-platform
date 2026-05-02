"use client";

import { use } from "react";
import Link from "next/link";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import type { PipelineStatusChoice, PipelineStatus } from "@/types";

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
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Pipelines</h1>
          <Link href={`/projects/${id}`} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back to project
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-gray-400">
          No pipelines found for this project.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          Pipelines
          <span className="ml-2 text-sm font-normal text-gray-400">({pipelines.length})</span>
        </h1>
        <Link href={`/projects/${id}`} className="text-xs text-gray-400 hover:text-gray-600">
          ← Back to project
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {pipelines.map((pipeline) => (
          <PipelineRow key={pipeline.pipeline_id} pipeline={pipeline} />
        ))}
      </div>
    </div>
  );
}
