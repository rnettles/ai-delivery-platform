"use client";

import { use, useState } from "react";
import { useDesignArtifacts, type DesignArtifactEntry } from "@/hooks/useDesignArtifacts";
import { DesignArtifactViewer } from "@/components/design/DesignArtifactViewer";

interface PageProps {
  params: Promise<{ id: string }>;
}

const CATEGORY_LABELS: Record<DesignArtifactEntry["category"], string> = {
  prd: "Product Requirements",
  fr: "Functional Requirements",
  adr: "Architecture Decision Records",
  tdn: "Technical Design Notes",
};

const CATEGORY_COLORS: Record<DesignArtifactEntry["category"], string> = {
  prd: "bg-orange-100 text-orange-800",
  fr: "bg-green-100 text-green-800",
  adr: "bg-blue-100 text-blue-800",
  tdn: "bg-purple-100 text-purple-800",
};

const CATEGORY_BADGE: Record<DesignArtifactEntry["category"], string> = {
  prd: "PRD",
  fr: "FR",
  adr: "ADR",
  tdn: "TDN",
};

function ArtifactListItem({
  entry,
  selected,
  onSelect,
}: {
  entry: DesignArtifactEntry;
  selected: boolean;
  onSelect: (entry: DesignArtifactEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={`w-full flex items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? "bg-blue-50 border border-blue-300 text-blue-900"
          : "border border-transparent hover:bg-gray-50 text-gray-800"
      }`}
    >
      <span
        className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORY_COLORS[entry.category]}`}
      >
        {CATEGORY_BADGE[entry.category]}
      </span>
      <span className="truncate text-xs">{entry.filename}</span>
    </button>
  );
}

function CategorySection({
  category,
  entries,
  selectedPath,
  onSelect,
}: {
  category: DesignArtifactEntry["category"];
  entries: DesignArtifactEntry[];
  selectedPath: string | null;
  onSelect: (entry: DesignArtifactEntry) => void;
}) {
  const [open, setOpen] = useState(true);

  if (entries.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-1 py-1.5 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          {CATEGORY_LABELS[category]}
          <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 normal-case tracking-normal">
            {entries.length}
          </span>
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {entries.map((entry) => (
            <ArtifactListItem
              key={entry.path}
              entry={entry}
              selected={selectedPath === entry.path}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse p-4">
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="h-8 rounded bg-gray-100" />
      ))}
    </div>
  );
}

export default function DesignArtifactsPage({ params }: PageProps) {
  const { id } = use(params);
  const { data, isLoading, isError } = useDesignArtifacts(id);
  const [selected, setSelected] = useState<DesignArtifactEntry | null>(null);

  const hasArtifacts = data && data.total > 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left: file catalogue */}
      <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-900">Design Artifacts</h1>
          {data && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {data.total}
            </span>
          )}
        </div>

        {isLoading && <Skeleton />}

        {isError && (
          <p className="text-xs text-red-600">Failed to load design artifacts.</p>
        )}

        {data && !hasArtifacts && (
          <p className="text-xs text-gray-400">
            No design artifacts found. Add files under{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">docs/prd</code>,{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">docs/functional_requirements</code>,{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">docs/adr</code>,{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">docs/architecture/adr</code>, or{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">docs/design/tdn</code> in your project repo.
          </p>
        )}

        {hasArtifacts && (
          <>
            {(["prd", "fr", "adr", "tdn"] as DesignArtifactEntry["category"][]).map((cat) => (
              <CategorySection
                key={cat}
                category={cat}
                entries={data[cat]}
                selectedPath={selected?.path ?? null}
                onSelect={setSelected}
              />
            ))}
          </>
        )}
      </aside>

      {/* Right: artifact content viewer */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-gray-50 p-6">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-24">
            <p className="text-sm text-gray-400">Select an artifact on the left to view its content.</p>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${CATEGORY_COLORS[selected.category]}`}
              >
                {CATEGORY_LABELS[selected.category]}
              </span>
              <span className="text-sm font-medium text-gray-800">{selected.filename}</span>
              <span className="text-xs text-gray-400 font-mono truncate">{selected.path}</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <DesignArtifactViewer projectId={id} path={selected.path} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
