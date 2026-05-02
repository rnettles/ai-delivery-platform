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

// Visual indentation depth per role — mirrors the agent hierarchy
const ROLE_DEPTH: Record<string, number> = {
  "planner":           0,
  "sprint-controller": 1,
  "implementer":       2,
  "verifier":          3,
};

const DEPTH_PADDING = ["pl-0", "pl-5", "pl-10", "pl-16"] as const;

interface StepGroupProps {
  group: UIStepGroup;
  isFirst: boolean;
  isActive: boolean;
  pipelineId: string;
  onArtifactSelect: (path: string) => void;
  /** Accumulated + supplemental artifacts for this role, excluding this step's own artifact_paths. */
  extraArtifacts?: string[];
}

export function StepGroup({ group, isFirst: _isFirst, isActive, pipelineId, onArtifactSelect, extraArtifacts }: StepGroupProps) {
  const defaultOpen = group.status === "running" || group.status === "failed" || isActive;
  const [open, setOpen] = useState(defaultOpen);

  const label = ROLE_LABEL[group.role] ?? group.role;
  let iterSuffix = "";
  switch (group.kind) {
    case "verifier-fix":   iterSuffix = group.fixCycle > 1 ? ` (fix ${group.fixCycle})` : " (fix)"; break;
    case "recheck":        iterSuffix = group.fixCycle > 1 ? ` (re-check ${group.fixCycle})` : " (re-check)"; break;
    case "impl-closeout":  iterSuffix = " (close-out)"; break;
    case "task-closeout":  iterSuffix = " (task close-out)"; break;
    case "sprint-closeout": iterSuffix = " (sprint close-out)"; break;
    case "phase-closeout":  iterSuffix = " (phase close-out)"; break;
    case "retry":          iterSuffix = group.iteration > 2 ? ` (retry ${group.iteration - 1})` : " (retry)"; break;
    default:               iterSuffix = ""; break;
  }
  const depth = ROLE_DEPTH[group.role] ?? 0;
  const paddingClass = DEPTH_PADDING[Math.min(depth, DEPTH_PADDING.length - 1)];

  const borderClass = isActive
    ? "border-blue-400 shadow-md"
    : "border-gray-200 shadow-sm";

  return (
    <div className={`${paddingClass}`}>
      <div className={`rounded-lg border-2 bg-white ${borderClass}`}>
        <button
          type="button"
          onClick={() => !isActive && setOpen((v) => !v)}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
            isActive ? "cursor-default" : "cursor-pointer"
          }`}
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${STATUS_DOT[group.status]}`} />
          <span className={`flex-1 text-sm font-semibold ${
            isActive ? "text-blue-900" : "text-gray-800"
          }`}>
            {label}{iterSuffix}
          </span>
          {isActive && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 rounded px-2 py-0.5">
              ● Active
            </span>
          )}
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {group.status}
          </span>
          {!isActive && (
            <span className="ml-2 text-gray-400">{open ? "▲" : "▼"}</span>
          )}
        </button>

        {open && (
          <div className="border-t border-gray-100 px-4 pb-4 pt-3">
            <StepCard
              record={group.record}
              pipelineId={pipelineId}
              onArtifactSelect={onArtifactSelect}
              extraArtifacts={extraArtifacts}
            />
            <GateCard record={group.record} />
          </div>
        )}
      </div>
    </div>
  );
}
