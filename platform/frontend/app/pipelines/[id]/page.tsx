"use client";

import { use } from "react";
import { usePipeline } from "@/hooks/usePipeline";
import { PipelineHeader } from "@/components/pipeline/PipelineHeader";
import { PipelineTimeline } from "@/components/pipeline/PipelineTimeline";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PipelineDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { pipeline, timeline, isLoading, isError, error } = usePipeline(id);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="h-24 rounded-lg bg-gray-200" />
        <div className="h-16 rounded-lg bg-gray-200" />
        <div className="h-16 rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (isError || !pipeline || !timeline) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error?.message ?? "Failed to load pipeline."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PipelineHeader pipeline={pipeline} />
      <div className="flex flex-1 gap-6 p-6">
        {/* Timeline — left column */}
        <main className="flex-1 min-w-0">
          <PipelineTimeline groups={timeline.groups} />
        </main>

        {/* Right panel placeholder — Slice 2 (SidePanel / ArtifactViewer) */}
        <aside className="w-80 flex-shrink-0 rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
          Artifact panel — Slice 2
        </aside>
      </div>
    </div>
  );
}
