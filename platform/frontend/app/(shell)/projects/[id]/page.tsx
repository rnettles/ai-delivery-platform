"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useProject } from "@/hooks/useProject";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import { OpenPipelineCard } from "@/components/pipeline/OpenPipelineCard";
import { LiveBadge } from "@/components/LiveBadge";
import type { PipelineStatus } from "@/types";

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
