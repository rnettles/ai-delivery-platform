"use client";

import { use, useState } from "react";
import { usePipeline } from "@/hooks/usePipeline";
import { useStagedPhases } from "@/hooks/useStagedPhases";
import { useStagedSprints } from "@/hooks/useStagedSprints";
import { PipelineHeader } from "@/components/pipeline/PipelineHeader";
import { PipelineTimeline } from "@/components/pipeline/PipelineTimeline";
import { ActionBar } from "@/components/pipeline/ActionBar";
import { SidePanel } from "@/components/pipeline/SidePanel";
import { StagedWorkPanel } from "@/components/pipeline/StagedWorkPanel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PipelineDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { pipeline, timeline, isLoading, isError, error, isLive, isStale } = usePipeline(id);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [staleBannerDismissed, setStaleBannerDismissed] = useState(false);

  // Fetch staged phases and sprints for the Planner supplemental artifact display.
  // These queries are shared with StagedWorkPanel via React Query cache — no double fetch.
  const phasesQuery = useStagedPhases(id);
  const sprintsQuery = useStagedSprints(id);

  const plannerSupplementalPaths = [
    ...(phasesQuery.data?.phases.map((p) => p.artifact_path) ?? []),
    ...(sprintsQuery.data?.sprints.map((s) => s.sprint_plan_path) ?? []),
  ];

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
    const is404 = error?.message?.includes("404") || error?.message?.includes("not found");
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {is404
            ? "Pipeline not found — it may have been cancelled or removed."
            : (error?.message ?? "Failed to load pipeline.")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PipelineHeader pipeline={pipeline} isLive={isLive} />
      {isStale && !staleBannerDismissed && (
        <div className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
          <span>Pipeline has finished. This is a final snapshot.</span>
          <button
            onClick={() => setStaleBannerDismissed(true)}
            className="text-amber-600 hover:text-amber-900 font-medium"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <ActionBar pipeline={pipeline} />
      <div className="flex flex-1 gap-6 p-6">
        {/* Timeline — left column */}
        <main className="flex-1 min-w-0">
          <PipelineTimeline
            groups={timeline.groups}
            pipelineId={pipeline.pipeline_id}
            onArtifactSelect={setSelectedArtifact}
            plannerSupplementalPaths={plannerSupplementalPaths}
          />
        </main>

        {/* Right panel — artifact viewer */}
        <SidePanel
          pipelineId={pipeline.pipeline_id}
          selectedPath={selectedArtifact}
          onClose={() => setSelectedArtifact(null)}
        />
      </div>
      {/* Staged work — collapsible panel below timeline */}
      <StagedWorkPanel pipelineId={pipeline.pipeline_id} onArtifactSelect={setSelectedArtifact} />
    </div>
  );
}
