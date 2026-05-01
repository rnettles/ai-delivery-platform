import type { UIStepGroup } from "@/types";
import { StepGroup } from "./StepGroup";

interface PipelineTimelineProps {
  groups: UIStepGroup[];
}

export function PipelineTimeline({ groups }: PipelineTimelineProps) {
  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">No steps recorded yet.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-3 py-4">
      {groups.map((group, i) => (
        <li key={`${group.role}-${group.iteration}`}>
          <StepGroup group={group} isFirst={i === 0} />
        </li>
      ))}
    </ol>
  );
}
