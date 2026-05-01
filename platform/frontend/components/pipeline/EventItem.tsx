import type { PipelineStepRecord, StepStatus } from "@/types";

const STATUS_COLOR: Record<StepStatus, string> = {
  running:        "text-blue-600",
  complete:       "text-green-600",
  failed:         "text-red-600",
  not_applicable: "text-gray-400",
};

interface EventItemProps {
  step: PipelineStepRecord;
}

export function EventItem({ step }: EventItemProps) {
  const ts = new Date(step.started_at).toLocaleTimeString();

  return (
    <div className="flex items-baseline gap-3 py-1 text-xs">
      <span className="w-20 flex-shrink-0 font-mono text-gray-400">{ts}</span>
      <span className="flex-shrink-0 font-medium text-gray-600">{step.actor}</span>
      <span className={`flex-shrink-0 font-semibold ${STATUS_COLOR[step.status]}`}>
        {step.status}
      </span>
      {step.error_message && (
        <span className="truncate text-red-500">{step.error_message}</span>
      )}
    </div>
  );
}
