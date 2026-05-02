interface ArtifactBadgeProps {
  path: string;
  pipelineId: string;
  onSelect: (path: string) => void;
}

export function ArtifactBadge({ path, onSelect }: ArtifactBadgeProps) {
  const filename = path.split("/").pop() ?? path;

  return (
    <button
      type="button"
      onClick={() => onSelect(filename)}
      className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700 hover:bg-blue-100 hover:text-blue-700 transition-colors text-xs"
      title={path}
    >
      {filename}
    </button>
  );
}
