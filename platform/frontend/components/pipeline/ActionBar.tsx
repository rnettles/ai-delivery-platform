"use client";

import { useState } from "react";
import type { PipelineRun, PipelineAction } from "@/types";
import { deriveAllowedActions, ACTION_LABELS } from "@/lib/action-map";
import { useActions } from "@/hooks/useActions";

interface ActionBarProps {
  pipeline: PipelineRun;
}

const ACTION_VARIANT: Record<PipelineAction, string> = {
  approve: "bg-green-600 text-white hover:bg-green-700",
  cancel: "bg-red-600 text-white hover:bg-red-700",
  retry: "bg-blue-600 text-white hover:bg-blue-700",
  handoff: "bg-indigo-600 text-white hover:bg-indigo-700",
  takeover: "bg-yellow-600 text-white hover:bg-yellow-700",
  skip: "bg-gray-600 text-white hover:bg-gray-700",
};

export function ActionBar({ pipeline }: ActionBarProps) {
  const actions = deriveAllowedActions(pipeline.status);
  const { submit, isPending, error } = useActions(pipeline.pipeline_id);
  const [skipJustification, setSkipJustification] = useState("");
  const [showSkipInput, setShowSkipInput] = useState(false);

  if (actions.length === 0) return null;

  function handleClick(action: PipelineAction) {
    if (action === "skip") {
      setShowSkipInput(true);
      return;
    }
    submit(action);
  }

  function handleSkipSubmit() {
    if (!skipJustification.trim()) return;
    submit("skip", { justification: skipJustification.trim() });
    setShowSkipInput(false);
    setSkipJustification("");
  }

  // When awaiting approval, surface which step's gate is pending so the user
  // knows exactly what Approve will trigger.
  const approvalContext =
    pipeline.status === "awaiting_approval" && pipeline.current_step !== "complete"
      ? pipeline.current_step
      : null;

  const ROLE_LABEL: Record<string, string> = {
    planner: "Planner",
    "sprint-controller": "Sprint Controller",
    implementer: "Implementer",
    verifier: "Verifier",
  };

  return (
    <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
      {approvalContext && (
        <div className="mb-2 flex items-center gap-2 text-xs text-yellow-700">
          <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
          <span>
            <span className="font-semibold">{ROLE_LABEL[approvalContext] ?? approvalContext}</span>
            {" "} gate is complete and awaiting approval before the pipeline continues.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={isPending}
            onClick={() => handleClick(action)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${ACTION_VARIANT[action]}`}
          >
            {isPending ? "…" : ACTION_LABELS[action]}
          </button>
        ))}

        {showSkipInput && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={skipJustification}
              onChange={(e) => setSkipJustification(e.target.value)}
              placeholder="Justification required…"
              className="rounded border border-gray-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
              type="button"
              disabled={!skipJustification.trim() || isPending}
              onClick={handleSkipSubmit}
              className="rounded bg-gray-600 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              Confirm Skip
            </button>
            <button
              type="button"
              onClick={() => { setShowSkipInput(false); setSkipJustification(""); }}
              className="text-sm text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600">{error.message}</p>
      )}
    </div>
  );
}
