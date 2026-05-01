"use client";

import { ArtifactViewer } from "./ArtifactViewer";

interface SidePanelProps {
  pipelineId: string;
  selectedPath: string | null;
  onClose: () => void;
}

export function SidePanel({ pipelineId, selectedPath, onClose }: SidePanelProps) {
  if (!selectedPath) {
    return (
      <aside className="w-80 flex-shrink-0 rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
        Click an artifact badge to view its content here.
      </aside>
    );
  }

  const filename = selectedPath.split("/").pop() ?? selectedPath;

  return (
    <aside className="flex w-80 flex-shrink-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <span className="truncate font-mono text-xs font-medium text-gray-700" title={selectedPath}>
          {filename}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <ArtifactViewer pipelineId={pipelineId} path={selectedPath} />
      </div>
    </aside>
  );
}
