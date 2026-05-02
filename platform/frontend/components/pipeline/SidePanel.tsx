"use client";

import { useState, useEffect } from "react";
import { ArtifactViewer } from "./ArtifactViewer";

interface SidePanelProps {
  pipelineId: string;
  selectedPath: string | null;
  onClose: () => void;
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M8.5 1.5H12.5V5.5M5.5 12.5H1.5V8.5M12.5 1.5L8 7M1.5 12.5L6 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M12.5 1.5L8 6M1.5 12.5L6 8M8 1.5H12.5V6M6 8H1.5V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

interface ArtifactModalProps {
  pipelineId: string;
  path: string;
  filename: string;
  onClose: () => void;
}

function ArtifactModal({ pipelineId, path, filename, onClose }: ArtifactModalProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={filename}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
        {/* Modal header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
          <span className="font-mono text-sm font-medium text-gray-700">{filename}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Collapse artifact viewer"
          >
            <CollapseIcon />
            Collapse
          </button>
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-auto p-6">
          <ArtifactViewer pipelineId={pipelineId} path={path} />
        </div>
      </div>
    </div>
  );
}

export function SidePanel({ pipelineId, selectedPath, onClose }: SidePanelProps) {
  const [expanded, setExpanded] = useState(false);

  // Reset expanded state when the selected artifact changes
  useEffect(() => { setExpanded(false); }, [selectedPath]);

  if (!selectedPath) {
    return (
      <aside className="w-80 flex-shrink-0 rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
        Click an artifact badge to view its content here.
      </aside>
    );
  }

  const filename = selectedPath.split("/").pop() ?? selectedPath;

  return (
    <>
      <aside className="flex w-80 flex-shrink-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
          <span className="truncate font-mono text-xs font-medium text-gray-700" title={selectedPath}>
            {filename}
          </span>
          <div className="ml-2 flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              aria-label="Expand artifact viewer"
              title="Expand"
            >
              <ExpandIcon />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-1.5 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <ArtifactViewer pipelineId={pipelineId} path={selectedPath} />
        </div>
      </aside>

      {expanded && (
        <ArtifactModal
          pipelineId={pipelineId}
          path={selectedPath}
          filename={filename}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
