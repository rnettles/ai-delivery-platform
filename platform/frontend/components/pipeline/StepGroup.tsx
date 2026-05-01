"use client";

import { useState } from "react";
import type { UIStepGroup, UIStepStatus } from "@/types";
import { StepCard } from "./StepCard";
import { GateCard } from "./GateCard";

const STATUS_DOT: Record<UIStepStatus, string> = {
  running:  "bg-blue-500 animate-pulse",
  complete: "bg-green-500",
  failed:   "bg-red-500",
  skipped:  "bg-gray-300",
  pending:  "bg-gray-200",
};

const ROLE_LABEL: Record<string, string> = {
  "planner":          "Planner",
  "sprint-controller": "Sprint Controller",
  "implementer":      "Implementer",
  "verifier":         "Verifier",
};

interface StepGroupProps {
  group: UIStepGroup;
  isFirst: boolean;
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
}

export function StepGroup({ group, isFirst: _isFirst, pipelineId, onArtifactSelect }: StepGroupProps) {
  const defaultOpen = group.status === "running" || group.status === "failed";
  const [open, setOpen] = useState(defaultOpen);

  const label = ROLE_LABEL[group.role] ?? group.role;
  const iterSuffix = group.iteration > 1 ? ` (attempt ${group.iteration})` : "";

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${STATUS_DOT[group.status]}`} />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          {label}{iterSuffix}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {group.status}
        </span>
        <span className="ml-2 text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <StepCard
            record={group.record}
            pipelineId={pipelineId}
            onArtifactSelect={onArtifactSelect}
          />
          <GateCard record={group.record} />
        </div>
      )}
    </div>
  );
}
