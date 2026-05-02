import type { PipelineStepRecord } from "@/types";
import { ArtifactBadge } from "./ArtifactBadge";

interface StepCardProps {
  record: PipelineStepRecord;
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
  /** Accumulated artifacts for this role across the pipeline, plus role-specific supplementals. */
  extraArtifacts?: string[];
}

export function StepCard({ record, pipelineId, onArtifactSelect, extraArtifacts }: StepCardProps) {
  const uniqueExtra = (extraArtifacts ?? []).filter(
    (p) => !record.artifact_paths.includes(p)
  );

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
            {[...new Set(record.artifact_paths)].map((p) => (
              <ArtifactBadge
                key={p}
                path={p}
                pipelineId={pipelineId}
                onSelect={onArtifactSelect}
              />
            ))}
          </dd>
        </>
      )}

      {uniqueExtra.length > 0 && (
        <>
          <dt className="font-medium text-gray-500">Role Artifacts</dt>
          <dd className="flex flex-wrap gap-1">
            {uniqueExtra.map((p) => (
              <ArtifactBadge
                key={p}
                path={p}
                pipelineId={pipelineId}
                onSelect={onArtifactSelect}
              />
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}
