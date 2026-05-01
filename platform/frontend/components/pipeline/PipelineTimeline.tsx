import type { UIStepGroup } from "@/types";
import { StepGroup } from "./StepGroup";

interface PipelineTimelineProps {
  groups: UIStepGroup[];
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
}

export function PipelineTimeline({ groups, pipelineId, onArtifactSelect }: PipelineTimelineProps) {
  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">No steps recorded yet.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-3 py-4">
      {groups.map((group, i) => (
        <li key={`${group.role}-${group.iteration}`}>
          <StepGroup
            group={group}
            isFirst={i === 0}
            pipelineId={pipelineId}
            onArtifactSelect={onArtifactSelect}
          />
        </li>
      ))}
    </ol>
  );
}
