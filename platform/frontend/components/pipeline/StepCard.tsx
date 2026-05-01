import type { PipelineStepRecord } from "@/types";

interface StepCardProps {
  record: PipelineStepRecord;
}

export function StepCard({ record }: StepCardProps) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      <dt className="font-medium text-gray-500">Actor</dt>
      <dd className="text-gray-800">{record.actor}</dd>

      <dt className="font-medium text-gray-500">Started</dt>
      <dd className="text-gray-800">
        {new Date(record.started_at).toLocaleString()}
      </dd>

      {record.completed_at && (
        <>
          <dt className="font-medium text-gray-500">Completed</dt>
          <dd className="text-gray-800">
            {new Date(record.completed_at).toLocaleString()}
          </dd>
        </>
      )}

      {record.gate_outcome && (
        <>
          <dt className="font-medium text-gray-500">Gate</dt>
          <dd className="text-gray-800">{record.gate_outcome}</dd>
        </>
      )}

      {record.error_message && (
        <>
          <dt className="font-medium text-gray-500">Error</dt>
          <dd className="rounded bg-red-50 px-2 py-1 font-mono text-red-700">
            {record.error_message}
          </dd>
        </>
      )}

      {record.justification && (
        <>
          <dt className="font-medium text-gray-500">Justification</dt>
          <dd className="text-gray-700 italic">{record.justification}</dd>
        </>
      )}

      {record.artifact_paths.length > 0 && (
        <>
          <dt className="font-medium text-gray-500">Artifacts</dt>
          <dd className="flex flex-wrap gap-1">
            {record.artifact_paths.map((p) => (
              <span
                key={p}
                className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700"
              >
                {p}
              </span>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}
