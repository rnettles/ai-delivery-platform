"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context: Record<string, unknown>;
}

type LevelFilter = "all" | "info" | "warn" | "error";

const LEVEL_STYLES: Record<string, string> = {
  info:  "bg-blue-50 text-blue-700 border-blue-200",
  warn:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  error: "bg-red-50 text-red-700 border-red-200",
  debug: "bg-gray-50 text-gray-500 border-gray-200",
};

const ROW_ACCENT: Record<string, string> = {
  error: "bg-red-50/40",
  warn:  "bg-yellow-50/30",
  info:  "",
  debug: "",
};

function ContextCell({ ctx }: { ctx: Record<string, unknown> }) {
  const pairs = Object.entries(ctx);
  if (pairs.length === 0) return null;
  return (
    <span className="font-mono text-xs text-gray-400 break-all">
      {pairs.map(([k, v]) => (
        <span key={k} className="mr-3">
          <span className="text-gray-500">{k}=</span>
          <span>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
        </span>
      ))}
    </span>
  );
}

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/logs?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LogEntry[];
      setEntries(data);
      setLastFetch(new Date());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Initial fetch + 3-second poll
  useEffect(() => {
    void fetchLogs();
    const id = setInterval(() => { void fetchLogs(); }, 3000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, autoScroll]);

  const visible = filter === "all"
    ? entries.filter((e) => !e.message.includes("PR merge gate waiting"))
    : entries.filter((e) => e.level === filter && !e.message.includes("PR merge gate waiting"));

  const filteredEntries = entries.filter((e) => !e.message.includes("PR merge gate waiting"));

  const counts = {
    error: filteredEntries.filter((e) => e.level === "error").length,
    warn:  filteredEntries.filter((e) => e.level === "warn").length,
    info:  filteredEntries.filter((e) => e.level === "info").length,
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ── */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-sm font-semibold text-gray-800">Server Logs</h1>

        {/* Level filter buttons */}
        <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
          {(["all", "error", "warn", "info"] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setFilter(lvl)}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
                filter === lvl
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {lvl === "all" ? "All" : lvl.toUpperCase()}
              {lvl !== "all" && counts[lvl] > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0 text-[10px] font-semibold ${
                  lvl === "error" ? "bg-red-500 text-white" :
                  lvl === "warn"  ? "bg-yellow-500 text-white" :
                  "bg-gray-200 text-gray-700"
                }`}>
                  {counts[lvl]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Auto-scroll toggle */}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3 rounded"
            />
            Auto-scroll
          </label>

          {/* Clear button */}
          <button
            type="button"
            onClick={() => setEntries([])}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>

          {/* Status */}
          <span className="text-xs text-gray-400">
            {lastFetch
              ? `Updated ${lastFetch.toLocaleTimeString()}`
              : "Connecting…"}
          </span>

          {/* Live indicator */}
          <span className="flex items-center gap-1 text-xs text-green-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex-shrink-0 bg-red-50 px-6 py-2 text-xs text-red-700 border-b border-red-200">
          Failed to fetch logs: {error}
        </div>
      )}

      {/* ── Log table ── */}
      <div className="flex-1 overflow-auto font-mono text-xs bg-gray-50">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm font-sans">
            {filteredEntries.length === 0 ? "Waiting for log entries…" : "No entries match the selected filter."}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {visible.map((entry, i) => (
                <tr
                  key={i}
                  className={`border-b border-gray-100 align-top hover:bg-white ${ROW_ACCENT[entry.level] ?? ""}`}
                >
                  {/* Time */}
                  <td className="w-20 whitespace-nowrap px-3 py-1.5 text-gray-400 select-none">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </td>

                  {/* Level badge */}
                  <td className="w-16 px-2 py-1.5">
                    <span className={`inline-block rounded border px-1.5 py-px text-[10px] font-bold uppercase ${LEVEL_STYLES[entry.level] ?? "bg-gray-50 text-gray-400 border-gray-200"}`}>
                      {entry.level}
                    </span>
                  </td>

                  {/* Message + context */}
                  <td className="px-3 py-1.5 text-gray-800 break-all">
                    <span className="mr-4">{entry.message}</span>
                    <ContextCell ctx={entry.context} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
