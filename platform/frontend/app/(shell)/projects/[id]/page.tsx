"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useProject } from "@/hooks/useProject";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import { deriveAllowedActions, ACTION_LABELS } from "@/lib/action-map";
import { LiveBadge } from "@/components/LiveBadge";
import type { PipelineStatus, PipelineStatusChoice, PipelineAction } from "@/types";

const OPEN_STATUSES: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "awaiting_pr_review",
  "paused_takeover",
];

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
  onCreated,
}: {
  projectId: string;
  onCreated: (pipelineId: string) => void;
}) {
  const [entryPoint, setEntryPoint] = useState<EntryPoint>("sprint-controller");
  const [sprintBranch, setSprintBranch] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  return (
    <section className="mb-6 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-1">No active pipeline</p>
      <p className="text-xs text-gray-400 mb-5">Start a new run for this project.</p>

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
              onChange={(e) => setEntryPoint(e.target.value as EntryPoint)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="sprint-controller">sprint-controller</option>
              <option value="planner">planner</option>
              <option value="implementer">implementer</option>
              <option value="verifier">verifier</option>
            </select>
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
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
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

// ─── Multiple active pipelines warning ───────────────────────────────────────

function MultiPipelineWarning({
  pipelines,
  projectId,
}: {
  pipelines: PipelineStatusChoice[];
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancelPipeline(pipelineId: string) {
    setCancelling(pipelineId);
    try {
      await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      await queryClient.invalidateQueries({ queryKey: ["project-pipelines", projectId] });
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-800 mb-1">
        ⚠ Multiple active pipelines — data issue
      </p>
      <p className="text-xs text-amber-700 mb-3">
        Only one pipeline should be active at a time. Cancel the extras below.
      </p>
      <div className="flex flex-col gap-2">
        {pipelines.map((p) => (
          <div
            key={p.pipeline_id}
            className="flex items-center justify-between gap-3 rounded bg-white border border-amber-200 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs text-gray-600 truncate">{p.pipeline_id}</p>
              <p className="text-[10px] text-gray-400">
                {p.status.replace(/_/g, " ")} · {p.current_step}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Link
                href={`/pipelines/${p.pipeline_id}`}
                className="text-xs text-blue-600 hover:underline"
              >
                View
              </Link>
              <button
                type="button"
                disabled={cancelling === p.pipeline_id}
                onClick={() => void cancelPipeline(p.pipeline_id)}
                className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling === p.pipeline_id ? "…" : "Cancel"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Collapsible project metadata ─────────────────────────────────────────────

function ProjectDetails({ project }: { project: { project_id: string; repo_url: string; default_branch: string; clone_path: string; channel_ids?: string[]; created_at: string; updated_at: string } }) {
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
          <dl className="space-y-2">
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

  // Persist as current project whenever this page is visited
  useEffect(() => {
    setCurrentProject(id);
  }, [id, setCurrentProject]);

  const openPipelines = (pipelines ?? []).filter((p) => OPEN_STATUSES.includes(p.status));
  const activePipeline = openPipelines.length === 1 ? openPipelines[0] : null;
  const hasDataIssue = openPipelines.length > 1;

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

      {/* Data issue warning */}
      {hasDataIssue && (
        <MultiPipelineWarning pipelines={openPipelines} projectId={id} />
      )}

      {/* Active pipeline OR start new run */}
      {!hasDataIssue && (
        activePipeline ? (
          <ActivePipelinePanel pipeline={activePipeline} projectId={id} />
        ) : (
          <StartRunPanel
            projectId={id}
            onCreated={(pid) => router.push(`/pipelines/${pid}`)}
          />
        )
      )}

      {/* Collapsed project metadata */}
      <ProjectDetails project={project} />

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

const OPEN_STATUSES: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "awaiting_pr_review",
  "paused_takeover",
];

type EntryPoint = "planner" | "sprint-controller" | "implementer" | "verifier";
type ExecutionMode = "next" | "next-flow" | "full-sprint";

interface CreatePipelineForm {
  entry_point: EntryPoint;
  execution_mode: ExecutionMode;
  description: string;
  sprint_branch: string;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: project, isLoading, isError } = useProject(id);
  const { data: pipelines, isLive } = useProjectPipelines(id);
  const openPipelines = (pipelines ?? []).filter((p) => OPEN_STATUSES.includes(p.status));

  const [form, setForm] = useState<CreatePipelineForm>({
    entry_point: "planner",
    execution_mode: "next",
    description: "",
    sprint_branch: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/pipelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to create pipeline (${res.status})`);
      }

      const run = (await res.json()) as { pipeline_id: string };
      router.push(`/pipelines/${run.pipeline_id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 rounded bg-gray-100 animate-pulse mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-5 w-full rounded bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="p-8">
        <p className="text-red-600">Project not found.</p>
        <Link href="/projects" className="text-blue-600 text-sm mt-2 inline-block">
          ← Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{project.repo_url}</p>
      </div>

      {/* Open Pipelines */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Open Pipelines
            </h2>
            {openPipelines.length > 0 && <LiveBadge active={isLive} />}
          </div>
          <Link
            href={`/projects/${id}/pipelines`}
            className="text-xs text-gray-400 hover:text-gray-700 underline-offset-2 hover:underline"
          >
            Inactive Pipelines →
          </Link>
        </div>

        {openPipelines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
            <p className="text-sm text-gray-400">No active pipelines right now.</p>
            <p className="text-xs text-gray-400 mt-1">Create one below or view inactive history →</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {openPipelines.map((pipeline) => (
              <OpenPipelineCard key={pipeline.pipeline_id} pipeline={pipeline} />
            ))}
          </div>
        )}
      </section>

      {/* Metadata */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Project Details
        </h2>
        <dl className="space-y-2">
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
      </section>

      {/* Create Pipeline Form */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
          New Pipeline
        </h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entry Point</label>
            <select
              value={form.entry_point}
              onChange={(e) => setForm({ ...form, entry_point: e.target.value as EntryPoint })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="planner">planner</option>
              <option value="sprint-controller">sprint-controller</option>
              <option value="implementer">implementer</option>
              <option value="verifier">verifier</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Execution Mode</label>
            <select
              value={form.execution_mode}
              onChange={(e) =>
                setForm({ ...form, execution_mode: e.target.value as ExecutionMode })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="next">next — run entry role, then stop</option>
              <option value="next-flow">next-flow — chain into downstream</option>
              <option value="full-sprint">full-sprint — fully autonomous</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Stage next sprint as Fast Track"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sprint Branch{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={form.sprint_branch}
              onChange={(e) => setForm({ ...form, sprint_branch: e.target.value })}
              placeholder="feature/S01-001"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {createError && <p className="text-sm text-red-600">{createError}</p>}

          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating…" : "Create Pipeline"}
          </button>
        </form>
      </section>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <dt className="w-36 flex-shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className={`text-sm text-gray-900 break-all ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
