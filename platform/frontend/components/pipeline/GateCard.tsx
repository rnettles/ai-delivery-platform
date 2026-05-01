import type { PipelineStepRecord, GateOutcome } from "@/types";

interface GateCardProps {
  record: PipelineStepRecord;
}

const OUTCOME_STYLE: Record<NonNullable<GateOutcome>, { label: string; classes: string }> = {
  approved: {
    label: "Approved",
    classes: "border-green-200 bg-green-50 text-green-700",
  },
  human_complete: {
    label: "Human Complete",
    classes: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  skipped: {
    label: "Skipped",
    classes: "border-gray-200 bg-gray-50 text-gray-500",
  },
  auto: {
    label: "Auto",
    classes: "border-blue-200 bg-blue-50 text-blue-600",
  },
};

export function GateCard({ record }: GateCardProps) {
  if (!record.gate_outcome) return null;

  const style = OUTCOME_STYLE[record.gate_outcome];
  if (!style) return null;

  return (
    <div className={`mt-3 rounded border px-3 py-2 text-xs ${style.classes}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">Gate:</span>
        <span>{style.label}</span>
        {record.actor && record.actor !== "system" && (
          <span className="text-gray-400">— {record.actor}</span>
        )}
      </div>
      {record.justification && (
        <p className="mt-1 text-gray-600 italic">{record.justification}</p>
      )}
    </div>
  );
}
