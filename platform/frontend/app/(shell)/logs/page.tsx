"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context: Record<string, unknown>;
}

type Level = "info" | "warn" | "error" | "debug";
const ALL_LEVELS: Level[] = ["error", "warn", "info", "debug"];

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

const LEVEL_ACTIVE_STYLE: Record<string, string> = {
  error: "bg-red-600 text-white border-red-600",
  warn:  "bg-yellow-500 text-white border-yellow-500",
  info:  "bg-blue-600 text-white border-blue-600",
  debug: "bg-gray-500 text-white border-gray-500",
};

const LEVEL_INACTIVE_STYLE = "bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-800";

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
  // Empty set = all levels shown (same as "All")
  const [activeLevels, setActiveLevels] = useState<Set<Level>>(new Set());
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

  useEffect(() => {
    void fetchLogs();
    const id = setInterval(() => { void fetchLogs(); }, 3000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, autoScroll]);

  function toggleLevel(lvl: Level) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) {
        next.delete(lvl);
      } else {
        next.add(lvl);
      }
      return next;
    });
  }

  function clearFilters() {
    setActiveLevels(new Set());
  }

  const isAllShown = activeLevels.size === 0;

  const filteredEntries = entries.filter((e) => !e.message.includes("PR merge gate waiting"));

  const visible = isAllShown
    ? filteredEntries
    : filteredEntries.filter((e) => activeLevels.has(e.level as Level));

  const counts: Record<Level, number> = {
    error: filteredEntries.filter((e) => e.level === "error").length,
    warn:  filteredEntries.filter((e) => e.level === "warn").length,
    info:  filteredEntries.filter((e) => e.level === "info").length,
    debug: filteredEntries.filter((e) => e.level === "debug").length,
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ── */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-sm font-semibold text-gray-800">Server Logs</h1>

        {/* Level filter toggle buttons */}
        <div className="flex items-center gap-1.5">
          {/* All pill */}
          <button
            type="button"
            onClick={clearFilters}
            className={`rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
              isAllShown
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-400 border-gray-200 hover:text-gray-700 hover:border-gray-400"
            }`}
          >
            All
          </button>

          {ALL_LEVELS.map((lvl) => {
            const active = activeLevels.has(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  active ? LEVEL_ACTIVE_STYLE[lvl] : LEVEL_INACTIVE_STYLE
                }`}
              >
                {lvl.toUpperCase()}
                {counts[lvl] > 0 && (
                  <span className={`ml-1.5 text-[10px] font-bold ${active ? "opacity-80" : "text-gray-400"}`}>
                    {counts[lvl]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active filter summary */}
        {!isAllShown && (
          <span className="text-xs text-gray-400">
            showing {[...activeLevels].join(" + ")} · <button type="button" className="underline hover:text-gray-600" onClick={clearFilters}>clear</button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3 rounded"
            />
            Auto-scroll
          </label>

          <button
            type="button"
            onClick={() => setEntries([])}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>

          <span className="text-xs text-gray-400">
            {lastFetch ? `Updated ${lastFetch.toLocaleTimeString()}` : "Connecting…"}
          </span>

          <span className="flex items-center gap-1 text-xs text-green-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

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
