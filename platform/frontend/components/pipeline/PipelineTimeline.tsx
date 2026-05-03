import { useEffect, useRef } from "react";
import type { UIStepGroup } from "@/types";
import { StepGroup } from "./StepGroup";

interface PipelineTimelineProps {
  groups: UIStepGroup[];
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
  /** Artifact paths from staged phases/sprints to supplement the Planner stage display. */
  plannerSupplementalPaths?: string[];
}

export function PipelineTimeline({ groups, pipelineId, onArtifactSelect, plannerSupplementalPaths }: PipelineTimelineProps) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Scroll the active (running) step into view on mount and when pipeline changes.
  // Not triggered on every poll — dependency on pipelineId only.
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">No steps recorded yet.</p>
    );
  }

  // Collect the full set of artifact_paths per role across all groups.
  const allArtifactsByRole = new Map<string, string[]>();
  for (const group of groups) {
    const existing = allArtifactsByRole.get(group.role) ?? [];
    allArtifactsByRole.set(group.role, [...existing, ...group.record.artifact_paths]);
  }

  return (
    <ol className="flex flex-col gap-3 py-4">
      {groups.map((group, i) => {
        const isActive = group.status === "running";

        // Build the extraArtifacts set for this group:
        // All artifacts accumulated for this role + role-specific supplementals,
        // excluding this step's own artifact_paths to prevent duplication.
        const thisStepSet = new Set(group.record.artifact_paths);
        const roleAccumulated = (allArtifactsByRole.get(group.role) ?? []).filter(
          (p) => !thisStepSet.has(p)
        );

        const supplemental: string[] = [];
        if (group.role === "planner") {
          for (const p of plannerSupplementalPaths ?? []) {
            if (!thisStepSet.has(p)) supplemental.push(p);
          }
        }
        if (group.role === "sprint-controller") {
          // Supplement sprint-controller steps with staged plan artifacts so the sprint plan
          // is visible even when the step failed before registering any artifact_paths.
          for (const p of plannerSupplementalPaths ?? []) {
            if (!thisStepSet.has(p)) supplemental.push(p);
          }
        }
        if (group.role === "implementer") {
          // Include the brief.md from the nearest preceding sprint-controller step.
          for (let j = i - 1; j >= 0; j--) {
            if (groups[j].role === "sprint-controller") {
              const briefPath = groups[j].record.artifact_paths.find((p) => p.endsWith("brief.md"));
              if (briefPath && !thisStepSet.has(briefPath)) supplemental.push(briefPath);
              break;
            }
          }
        }

        const extraArtifacts = [...new Set([...roleAccumulated, ...supplemental])];

        return (
          <li
            key={`${group.role}-${group.iteration}`}
            ref={isActive ? activeRef : null}
          >
            <StepGroup
              group={group}
              isFirst={i === 0}
              isActive={isActive}
              pipelineId={pipelineId}
              onArtifactSelect={onArtifactSelect}
              extraArtifacts={extraArtifacts.length > 0 ? extraArtifacts : undefined}
            />
          </li>
        );
      })}
    </ol>
  );
}
