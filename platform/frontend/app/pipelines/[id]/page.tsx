"use client";

import { use, useState } from "react";
import { usePipeline } from "@/hooks/usePipeline";
import { PipelineHeader } from "@/components/pipeline/PipelineHeader";
import { PipelineTimeline } from "@/components/pipeline/PipelineTimeline";
import { ActionBar } from "@/components/pipeline/ActionBar";
import { SidePanel } from "@/components/pipeline/SidePanel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PipelineDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { pipeline, timeline, isLoading, isError, error } = usePipeline(id);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);

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
      <ActionBar pipeline={pipeline} />
      <div className="flex flex-1 gap-6 p-6">
        {/* Timeline — left column */}
        <main className="flex-1 min-w-0">
          <PipelineTimeline
            groups={timeline.groups}
            pipelineId={pipeline.pipeline_id}
            onArtifactSelect={setSelectedArtifact}
          />
        </main>

        {/* Right panel — artifact viewer */}
        <SidePanel
          pipelineId={pipeline.pipeline_id}
          selectedPath={selectedArtifact}
          onClose={() => setSelectedArtifact(null)}
        />
      </div>
    </div>
  );
}
