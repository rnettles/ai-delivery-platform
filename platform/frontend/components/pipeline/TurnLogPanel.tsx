"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

interface TurnEntry {
  turn: number;
  tool: string;
  args_summary: string;
  result_summary: string;
  timestamp: string;
}

interface TurnLogData {
  stop_reason: "in_progress" | "completed" | "MAX_ITERATIONS" | "FINISH_NOT_CALLED";
  turn_count: number;
  turns: TurnEntry[];
}

interface TurnLogPanelProps {
  pipelineId: string;
  /** True when the implementer step is currently running — enables 2s polling. */
  isLive: boolean;
}

async function fetchTurnLog(pipelineId: string): Promise<TurnLogData> {
  const url = `/api/pipelines/${encodeURIComponent(pipelineId)}/artifact?path=turn_log.json`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<TurnLogData>;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function formatTurnLogText(data: TurnLogData): string {
  const lines = [`Turn Log — ${data.stop_reason} (${data.turn_count} turns)`, ""];
  for (const t of data.turns) {
    lines.push(`T${t.turn} | ${t.tool} | ${t.timestamp}`);
    lines.push(`  args:   ${t.args_summary}`);
    lines.push(`  result: ${t.result_summary}`);
    lines.push("");
  }
  return lines.join("\n");
}

function CopyButton({ data }: { data: TurnLogData }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(formatTurnLogText(data)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors border border-transparent hover:border-gray-200"
      title="Copy turn log to clipboard"
    >
      {copied ? (
        <>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 7.5L5.5 11L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="4.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M9.5 4.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

const STOP_REASON_STYLE: Record<string, string> = {
  completed: "text-green-600",
  MAX_ITERATIONS: "text-amber-600",
  FINISH_NOT_CALLED: "text-red-600",
  in_progress: "text-blue-600",
};

// ── Shared turn row ───────────────────────────────────────────────────────────
// The clickable header stays a <button>; the expanded detail is a plain <div>
// so text can be selected normally.

function TurnRow({
  entry,
  forceOpen,
  onClick,
}: {
  entry: TurnEntry;
  forceOpen: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-gray-500">T{entry.turn}</span>
          <span className={`flex-1 font-mono text-xs text-gray-800 ${forceOpen ? "" : "truncate"}`}>
            {entry.tool}
          </span>
          <span className="flex-shrink-0 text-[10px] text-gray-400">{relativeTime(entry.timestamp)}</span>
        </div>
      </button>
      {forceOpen && (
        <div className="select-text px-3 pb-2 space-y-1 cursor-text">
          <p className="font-mono text-[10px] text-gray-500 break-all">
            <span className="font-semibold">args: </span>{entry.args_summary}
          </p>
          <p className="font-mono text-[10px] text-gray-500 break-all">
            <span className="font-semibold">result: </span>{entry.result_summary}
          </p>
        </div>
      )}
    </li>
  );
}

// ── Modal (full-screen expand) ────────────────────────────────────────────────

function TurnLogModal({
  data,
  headerLabel,
  stopReasonClass,
  onClose,
}: {
  data: TurnLogData;
  headerLabel: string;
  stopReasonClass: string;
  onClose: () => void;
}) {
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);

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
      aria-label="Turn log"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
        {/* Modal header */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-100 px-5 py-3">
          <span className={`flex-1 text-sm font-semibold ${stopReasonClass}`}>{headerLabel}</span>
          <CopyButton data={data} />
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Collapse turn log"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M12.5 1.5L8 6M1.5 12.5L6 8M8 1.5H12.5V6M6 8H1.5V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Collapse
          </button>
        </div>
        {/* Scrollable turn feed — all turns open by default */}
        <ol className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {data.turns.map((entry) => (
            <TurnRow
              key={entry.turn}
              entry={entry}
              forceOpen={expandedTurn === null || expandedTurn === entry.turn}
              onClick={() => setExpandedTurn(expandedTurn === entry.turn ? null : entry.turn)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── TurnLogPanel ──────────────────────────────────────────────────────────────

export function TurnLogPanel({ pipelineId, isLive }: TurnLogPanelProps) {
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setModalOpen(false), []);

  const { data, isError } = useQuery<TurnLogData, Error>({
    queryKey: ["turn-log", pipelineId],
    queryFn: () => fetchTurnLog(pipelineId),
    staleTime: 0,
    refetchInterval: isLive ? 2000 : false,
    retry: false,
  });

  // Auto-scroll to bottom when live and new turns arrive
  useEffect(() => {
    if (isLive && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [isLive, data?.turn_count]);

  if (isError || !data) {
    // Silently absent — turn_log.json may not exist yet (first few turns)
    return null;
  }

  const stopReasonClass = STOP_REASON_STYLE[data.stop_reason] ?? "text-gray-500";
  const headerLabel = isLive
    ? `Live — turn ${data.turn_count}`
    : `Turns — ${data.stop_reason.replace(/_/g, " ").toLowerCase()} (${data.turn_count})`;

  return (
    <>
      <div className="mt-3 rounded border border-gray-100 bg-gray-50">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          {isLive && (
            <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-blue-500 animate-pulse" />
          )}
          <span className={`flex-1 text-xs font-semibold ${stopReasonClass}`}>{headerLabel}</span>
          <CopyButton data={data} />
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-200 hover:text-blue-600 transition-colors border border-transparent hover:border-gray-200"
            title="Expand turn log to full screen"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M8.5 1.5H12.5V5.5M5.5 12.5H1.5V8.5M12.5 1.5L8 7M1.5 12.5L6 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Expand
          </button>
        </div>

        {/* Compact turn feed */}
        <ol className="max-h-48 overflow-y-auto divide-y divide-gray-100">
          {data.turns.map((entry) => (
            <TurnRow
              key={entry.turn}
              entry={entry}
              forceOpen={expandedTurn === entry.turn}
              onClick={() => setExpandedTurn(expandedTurn === entry.turn ? null : entry.turn)}
            />
          ))}
        </ol>

        <div ref={bottomRef} />
      </div>

      {modalOpen && (
        <TurnLogModal
          data={data}
          headerLabel={headerLabel}
          stopReasonClass={stopReasonClass}
          onClose={handleClose}
        />
      )}
    </>
  );
}
