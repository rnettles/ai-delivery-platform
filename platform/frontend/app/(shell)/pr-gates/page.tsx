"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PrGateEntry {
  timestamp: string;
  level: string;
  message: string;
  context: {
    pipeline_id?: string;
    pr_number?: number;
    pr_url?: string;
    pr_state?: string;
    sprint_branch?: string;
    next_action?: string;
  };
}

export default function PrGatesPage() {
  const [gates, setGates] = useState<PrGateEntry[]>([]);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/pr-gates");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PrGateEntry[];
        setGates(data);
        setLastFetch(new Date());
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    }
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-900">PR Merge Gates</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Pipelines paused waiting for a sprint PR to be merged.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {lastFetch && <span>Updated {lastFetch.toLocaleTimeString()}</span>}
          <span className="flex items-center gap-1 text-green-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {gates.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-gray-200 py-16 text-center text-sm text-gray-400">
          {lastFetch ? "No pipelines are currently waiting for a PR merge." : "Loading…"}
        </div>
      )}

      <ul className="space-y-3">
        {gates.map((gate) => {
          const ctx = gate.context;
          const pipelineId = ctx.pipeline_id ?? "";
          const shortId = pipelineId.replace(/^pipe-\d{4}-\d{2}-\d{2}-/, "").substring(0, 8);
          const ts = new Date(gate.timestamp).toLocaleString();

          return (
            <li
              key={pipelineId}
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Pipeline link */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 border border-amber-300">
                      Waiting for merge
                    </span>
                    <Link
                      href={`/pipelines/${encodeURIComponent(pipelineId)}`}
                      className="font-mono text-xs font-medium text-gray-700 hover:text-blue-600 truncate"
                      title={pipelineId}
                    >
                      {pipelineId || "unknown"}
                    </Link>
                  </div>

                  {/* Sprint branch */}
                  {ctx.sprint_branch && (
                    <p className="mb-1 text-xs text-gray-600">
                      <span className="text-gray-400">Branch: </span>
                      <span className="font-mono">{ctx.sprint_branch}</span>
                    </p>
                  )}

                  {/* Next action */}
                  {ctx.next_action && (
                    <p className="text-xs text-gray-600 mt-1">{ctx.next_action}</p>
                  )}

                  {/* Timestamp */}
                  <p className="mt-2 text-[10px] text-gray-400">Last seen: {ts}</p>
                </div>

                {/* PR link CTA */}
                {ctx.pr_url && (
                  <a
                    href={ctx.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 transition-colors"
                  >
                    PR #{ctx.pr_number}
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
