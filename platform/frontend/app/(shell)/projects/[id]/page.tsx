"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useProject } from "@/hooks/useProject";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import { useProjectBranches } from "@/hooks/useProjectBranches";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import { useProjectWork, type WorkPhase } from "@/hooks/useProjectWork";
import { deriveAllowedActions, ACTION_LABELS } from "@/lib/action-map";
import { LiveBadge } from "@/components/LiveBadge";
import { updateProjectPromptFields } from "@/lib/api-client";
import type { PipelineStatus, PipelineStatusChoice, PipelineAction, ProjectBranchSummary } from "@/types";

const STATUS_STYLES: Record<PipelineStatus, { badge: string; border: string; dot: string }> = {
  running:            { badge: "bg-blue-100 text-blue-800",    border: "border-blue-400",   dot: "bg-blue-500 animate-pulse" },
  awaiting_approval:  { badge: "bg-yellow-100 text-yellow-800", border: "border-yellow-400", dot: "bg-yellow-500" },
  awaiting_pr_review: { badge: "bg-purple-100 text-purple-800", border: "border-purple-400", dot: "bg-purple-500" },
  paused_takeover:    { badge: "bg-orange-100 text-orange-800", border: "border-orange-400", dot: "bg-orange-500" },
  failed:             { badge: "bg-red-100 text-red-800",      border: "border-red-300",     dot: "bg-red-500" },
  complete:           { badge: "bg-green-100 text-green-800",  border: "border-green-300",   dot: "bg-green-500" },
  cancelled:          { badge: "bg-gray-100 text-gray-600",    border: "border-gray-200",    dot: "bg-gray-400" },
};

const STEP_LABELS: Record<string, string> = {
  planner: "Planner",
  "sprint-controller": "Sprint Controller",
  implementer: "Implementer",
  verifier: "Verifier",
  complete: "Complete",
};

const ACTION_VARIANT: Record<PipelineAction, string> = {
  approve:  "bg-green-600 text-white hover:bg-green-700",
  cancel:   "bg-red-600 text-white hover:bg-red-700",
  retry:    "bg-blue-600 text-white hover:bg-blue-700",
  handoff:  "bg-indigo-600 text-white hover:bg-indigo-700",
  takeover: "bg-yellow-600 text-white hover:bg-yellow-700",
  skip:     "bg-gray-600 text-white hover:bg-gray-700",
};

type EntryPoint = "planner" | "sprint-controller" | "implementer" | "verifier";
type ExecutionMode = "next" | "next-flow" | "full-sprint";

function isActiveWorkPath(path: string): boolean {
  return path.includes("/active/") || path.includes("\\active\\");
}

function isStagedSprintPath(path: string): boolean {
  return path.includes("/staged_sprints/") || path.includes("\\staged_sprints\\");
}

function recommendEntryPoint(phases: WorkPhase[] | undefined): EntryPoint {
  if (!phases || phases.length === 0) {
    return "planner";
  }

  let hasActivePendingTask = false;
  let hasActiveDoneTask = false;
  let hasStagedSprint = false;

  for (const phase of phases) {
    for (const sprint of phase.sprints) {
      if (isStagedSprintPath(sprint.sprint_plan_path)) {
        hasStagedSprint = true;
      }

      for (const task of sprint.tasks) {
        if (!isActiveWorkPath(task.sprint_plan_path)) {
          continue;
        }

        if (task.status === "pending") {
          hasActivePendingTask = true;
        }
        if (task.status === "done") {
          hasActiveDoneTask = true;
        }
      }
    }
  }

  if (hasActivePendingTask) {
    return "implementer";
  }
  if (hasActiveDoneTask) {
    return "verifier";
  }
  if (hasStagedSprint) {
    return "sprint-controller";
  }

  return "planner";
}

// ─── Active Pipeline Panel ────────────────────────────────────────────────────

function ActivePipelinePanel({
  pipeline,
  projectId,
}: {
  pipeline: PipelineStatusChoice;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSkipInput, setShowSkipInput] = useState(false);
  const [skipJustification, setSkipJustification] = useState("");

  const style = STATUS_STYLES[pipeline.status];
  const actions = deriveAllowedActions(pipeline.status);
  const stepLabel = STEP_LABELS[pipeline.current_step] ?? pipeline.current_step;

  async function submit(action: PipelineAction, payload: Record<string, unknown> = {}) {
    setIsPending(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/pipelines/${encodeURIComponent(pipeline.pipeline_id)}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Action failed: ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsPending(false);
    }
  }

  function handleActionClick(action: PipelineAction) {
    if (action === "skip") { setShowSkipInput(true); return; }
    void submit(action);
  }

  function handleSkipSubmit() {
    if (!skipJustification.trim()) return;
    void submit("skip", { justification: skipJustification.trim() });
    setShowSkipInput(false);
    setSkipJustification("");
  }

  return (
    <section className={`mb-6 rounded-xl border-2 bg-white p-5 ${style.border}`}>
      {/* Status row */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${style.badge}`}>
            {pipeline.status.replace(/_/g, " ")}
          </span>
        </div>
        <Link
          href={`/pipelines/${pipeline.pipeline_id}`}
          className="text-xs text-blue-600 hover:underline"
        >
          View full pipeline →
        </Link>
      </div>

      {/* Primary info */}
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Current Step
        </p>
        <p className="mt-0.5 text-2xl font-bold text-gray-900">{stepLabel}</p>
      </div>

      {/* Meta */}
      <dl className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
        {pipeline.sprint_branch && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Branch:</dt>
            <dd className="font-mono">{pipeline.sprint_branch}</dd>
          </div>
        )}
        {pipeline.current_actor && (
          <div className="flex gap-1">
            <dt className="font-medium text-gray-600">Actor:</dt>
            <dd>{pipeline.current_actor}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="font-medium text-gray-600">ID:</dt>
          <dd className="font-mono text-gray-400">{pipeline.pipeline_id}</dd>
        </div>
      </dl>

      {/* Wait state */}
      {pipeline.wait_state && (
        <div className="mb-4 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          {pipeline.wait_state}
        </div>
      )}

      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={isPending}
              onClick={() => handleActionClick(action)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${ACTION_VARIANT[action]}`}
            >
              {isPending ? "…" : ACTION_LABELS[action]}
            </button>
          ))}

          {showSkipInput && (
            <div className="flex items-center gap-2 w-full mt-2">
              <input
                type="text"
                value={skipJustification}
                onChange={(e) => setSkipJustification(e.target.value)}
                placeholder="Justification required…"
                className="flex-1 rounded border border-gray-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
      )}

      {actionError && (
        <p className="mt-2 text-xs text-red-600">{actionError}</p>
      )}
    </section>
  );
}

// ─── Start Run Panel ──────────────────────────────────────────────────────────

function StartRunPanel({
  projectId,
  activeBranches,
  onCreated,
  resumeBranch,
  onClearResume,
}: {
  projectId: string;
  activeBranches: ProjectBranchSummary[];
  onCreated: (pipelineId: string) => void;
  resumeBranch?: ProjectBranchSummary | null;
  onClearResume?: () => void;
}) {
  const { phases } = useProjectWork(projectId);
  const recommendedEntryPoint = recommendEntryPoint(phases);
  const [entryPoint, setEntryPoint] = useState<EntryPoint>("planner");
  const [entryPointOverridden, setEntryPointOverridden] = useState(false);
  const [sprintBranch, setSprintBranch] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Sync resume state into form fields when caller selects a failed branch
  useEffect(() => {
    if (resumeBranch) {
      setSprintBranch(resumeBranch.sprint_branch);
      setEntryPoint(resumeBranch.current_step === "complete" ? "planner" : resumeBranch.current_step as EntryPoint);
      setEntryPointOverridden(true);
      setShowAdvanced(true);
    }
  }, [resumeBranch]);

  useEffect(() => {
    if (!entryPointOverridden) {
      setEntryPoint(recommendedEntryPoint);
    }
  }, [entryPointOverridden, recommendedEntryPoint]);

  // Detect if the typed branch matches an already-active pipeline
  const branchConflict = sprintBranch.trim()
    ? activeBranches.find((b) => b.sprint_branch === sprintBranch.trim())
    : undefined;

  async function handleCreate(mode: ExecutionMode) {
    setDropdownOpen(false);
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pipelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_point: entryPoint,
          execution_mode: mode,
          description: description.trim() || undefined,
          sprint_branch: sprintBranch.trim() || undefined,
          prior_pipeline_id: resumeBranch?.latest_pipeline_id || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to create pipeline (${res.status})`);
      }
      const run = (await res.json()) as { pipeline_id: string };
      onCreated(run.pipeline_id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
      setCreating(false);
    }
  }

  const isResuming = Boolean(resumeBranch);

  return (
    <section className="mb-6 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-5">
      {isResuming ? (
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-blue-700 mb-0.5">Resume pipeline</p>
            <p className="font-mono text-xs text-gray-500">{resumeBranch!.sprint_branch}</p>
          </div>
          {onClearResume && (
            <button
              type="button"
              onClick={onClearResume}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear ✕
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold text-gray-700 mb-1">Start new run</p>
          <p className="text-xs text-gray-400 mb-5">Start a new pipeline for this project.</p>
        </>
      )}

      {/* Split button */}
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={creating}
          onClick={() => void handleCreate("next")}
          className="flex-1 rounded-l-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {creating ? "Starting…" : "▶  Next"}
        </button>
        <div className="relative">
          <button
            type="button"
            disabled={creating}
            onClick={() => setDropdownOpen((v) => !v)}
            className="h-full rounded-r-md border-l border-blue-700 bg-blue-600 px-3 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            aria-label="More execution modes"
          >
            ▾
          </button>
          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1 w-44 rounded-md border border-gray-200 bg-white shadow-lg z-10">
              <button
                type="button"
                onClick={() => void handleCreate("next-flow")}
                className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="font-medium">Next Flow</span>
                <span className="block text-[10px] text-gray-400">Chain into downstream</span>
              </button>
              <button
                type="button"
                onClick={() => void handleCreate("full-sprint")}
                className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-100"
              >
                <span className="font-medium">Full Sprint</span>
                <span className="block text-[10px] text-gray-400">Fully autonomous</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Advanced options toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-3 text-xs text-gray-400 hover:text-gray-600"
      >
        {showAdvanced ? "▲ Hide options" : "▾ Options"}
      </button>

      {showAdvanced && (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Entry Point</label>
            <select
              value={entryPoint}
              onChange={(e) => {
                setEntryPointOverridden(true);
                setEntryPoint(e.target.value as EntryPoint);
              }}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="sprint-controller">sprint-controller</option>
              <option value="planner">planner</option>
              <option value="implementer">implementer</option>
              <option value="verifier">verifier</option>
            </select>
            <p className="mt-1 text-[11px] text-gray-500">
              Default: {recommendedEntryPoint}
              <span
                className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-500"
                title="Auto-selected to the deepest ready role based on repository work artifacts. Priority: implementer (active pending task) -> verifier (active completed task) -> sprint-controller (staged sprint plan) -> planner."
                aria-label="How entry point default is chosen"
              >
                i
              </span>
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Sprint Branch <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={sprintBranch}
              onChange={(e) => setSprintBranch(e.target.value)}
              placeholder="feature/S01-001"
              className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${branchConflict ? "border-amber-400 bg-amber-50" : "border-gray-300"}`}
            />
            {branchConflict && (
              <p className="mt-1 text-[11px] text-amber-700">
                Branch <span className="font-mono">{branchConflict.sprint_branch}</span> already has an active pipeline — choose a different branch or use the active card above.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Stage next sprint…"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
      )}

      {createError && <p className="mt-3 text-xs text-red-600">{createError}</p>}
    </section>
  );
}

// ─── Failed Branch Card ───────────────────────────────────────────────────────

function FailedBranchCard({
  branch,
  onResume,
}: {
  branch: ProjectBranchSummary;
  onResume: (branch: ProjectBranchSummary) => void;
}) {
  const stepLabel = STEP_LABELS[branch.current_step] ?? branch.current_step;
  const failedAt = new Date(branch.updated_at).toLocaleString();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <div className="min-w-0">
        <p className="font-mono text-xs font-medium text-gray-700 truncate">{branch.sprint_branch}</p>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Failed at <span className="font-medium">{stepLabel}</span> · {failedAt}
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Link
          href={`/pipelines/${branch.latest_pipeline_id}`}
          className="text-xs text-blue-600 hover:underline"
        >
          View
        </Link>
        <button
          type="button"
          onClick={() => onResume(branch)}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Resume
        </button>
      </div>
    </div>
  );
}

// ─── Prompt Fields Section ───────────────────────────────────────────────────

function PromptFieldsSection({ projectId, promptRole, promptContext }: { projectId: string; promptRole: string | null; promptContext: string | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [roleValue, setRoleValue] = useState(promptRole ?? "");
  const [contextValue, setContextValue] = useState(promptContext ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleEdit() {
    setRoleValue(promptRole ?? "");
    setContextValue(promptContext ?? "");
    setEditing(true);
    setError(null);
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    if (!roleValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateProjectPromptFields(projectId, roleValue.trim(), contextValue.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Agent Prompt Configuration
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={handleEdit}
            className="text-xs text-blue-600 hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Prompt Role <span className="text-red-500">*</span>
            </label>
            <p className="text-[11px] text-gray-500 mb-1">Defines the LLM role/persona for all agent conversations in this project.</p>
            <textarea
              value={roleValue}
              onChange={(e) => setRoleValue(e.target.value)}
              rows={4}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              placeholder="You are an expert software engineer specializing in…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Prompt Context <span className="text-gray-400 text-[11px] font-normal">(optional)</span>
            </label>
            <p className="text-[11px] text-gray-500 mb-1">Provides broader project domain knowledge and system boundaries.</p>
            <textarea
              value={contextValue}
              onChange={(e) => setContextValue(e.target.value)}
              rows={5}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              placeholder="This project implements…"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !roleValue.trim()}
              onClick={() => void handleSave()}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleCancel}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">Role</p>
            {promptRole
              ? <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{promptRole}</p>
              : <p className="text-sm text-gray-400 italic">No prompt role set. Click Edit to add one.</p>
            }
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">Context</p>
            {promptContext
              ? <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{promptContext}</p>
              : <p className="text-sm text-gray-400 italic">No prompt context set.</p>
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Collapsible project metadata ─────────────────────────────────────────────

function ProjectDetails({ project, projectId }: { project: { project_id: string; repo_url: string; default_branch: string; clone_path: string; prompt_role?: string | null; prompt_context?: string | null; channel_ids?: string[]; created_at: string; updated_at: string }; projectId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-4 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700"
      >
        Project Details
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <dl className="space-y-2 mb-5">
            <MetaRow label="Project ID" value={project.project_id} mono />
            <MetaRow label="Repo URL" value={project.repo_url} />
            <MetaRow label="Default Branch" value={project.default_branch} mono />
            <MetaRow label="Clone Path" value={project.clone_path} mono />
            <MetaRow
              label="Channels"
              value={
                project.channel_ids && project.channel_ids.length > 0
                  ? project.channel_ids.join(", ")
                  : "—"
              }
              mono
            />
            <MetaRow label="Created" value={new Date(project.created_at).toLocaleString()} />
            <MetaRow label="Updated" value={new Date(project.updated_at).toLocaleString()} />
          </dl>
          <PromptFieldsSection projectId={projectId} promptRole={project.prompt_role ?? null} promptContext={project.prompt_context ?? null} />
        </div>
      )}
    </section>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4">
      <dt className="w-32 flex-shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className={`text-xs text-gray-900 break-all ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setCurrentProject } = useCurrentProject();
  const { data: project, isLoading, isError } = useProject(id);
  const { data: pipelines, isLive } = useProjectPipelines(id);
  const { data: branches } = useProjectBranches(id);
  const [resumeBranch, setResumeBranch] = useState<ProjectBranchSummary | null>(null);

  // Persist as current project whenever this page is visited
  useEffect(() => {
    setCurrentProject(id);
  }, [id, setCurrentProject]);

  const ACTIVE_STATUSES: PipelineStatus[] = [
    "running",
    "awaiting_approval",
    "awaiting_pr_review",
    "paused_takeover",
  ];

  // Active pipelines — used for the existing ActivePipelinePanel cards
  const activePipelines = (pipelines ?? []).filter((p) => ACTIVE_STATUSES.includes(p.status));

  // Failed branches — for resumption (UC2)
  const failedBranches = (branches ?? []).filter((b) => b.status === "failed");

  // Active branch summaries — for conflict detection in the start form
  const activeBranchSummaries = (branches ?? []).filter((b) => ACTIVE_STATUSES.includes(b.status));

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-8 w-48 rounded bg-gray-100 animate-pulse mb-4" />
        <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-xs text-gray-400 mt-0.5 font-mono">{project.repo_url}</p>
        </div>
        <LiveBadge active={isLive} />
      </div>

      {/* Active pipeline cards — one per active pipeline (UC1: multiple allowed) */}
      {activePipelines.length > 0 && (
        <div className="mb-2 flex flex-col gap-4">
          {activePipelines.map((pipeline) => (
            <ActivePipelinePanel key={pipeline.pipeline_id} pipeline={pipeline} projectId={id} />
          ))}
        </div>
      )}

      {/* Failed branch cards — resumable (UC2) */}
      {failedBranches.length > 0 && (
        <div className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Failed Branches
          </p>
          <div className="flex flex-col gap-2">
            {failedBranches.map((branch) => (
              <FailedBranchCard
                key={branch.sprint_branch}
                branch={branch}
                onResume={(b) => setResumeBranch(b)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Start new run — always visible */}
      <StartRunPanel
        projectId={id}
        activeBranches={activeBranchSummaries}
        resumeBranch={resumeBranch}
        onClearResume={() => setResumeBranch(null)}
        onCreated={(pid) => router.push(`/pipelines/${pid}`)}
      />

      {/* Collapsed project metadata + agent prompt configuration */}
      <ProjectDetails project={project} projectId={id} />

      {/* Footer */}
      <div className="mt-2">
        <Link
          href={`/projects/${id}/pipelines`}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Inactive Pipelines →
        </Link>
      </div>
    </div>
  );
}
