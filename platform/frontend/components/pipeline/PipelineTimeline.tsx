import { useEffect, useRef } from "react";
import type { UIStepGroup } from "@/types";
import { StepGroup } from "./StepGroup";

interface PipelineTimelineProps {
  groups: UIStepGroup[];
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
}

export function PipelineTimeline({ groups, pipelineId, onArtifactSelect }: PipelineTimelineProps) {
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

  return (
    <ol className="flex flex-col gap-3 py-4">
      {groups.map((group, i) => {
        const isActive = group.status === "running";
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
            />
          </li>
        );
      })}
    </ol>
  );
}
