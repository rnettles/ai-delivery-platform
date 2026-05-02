"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useProject } from "@/hooks/useProject";

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
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/projects" className="text-sm text-gray-500 hover:text-gray-700">
          ← Projects
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{project.name}</h1>
      </div>

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

      {/* Navigation */}
      <div className="mb-8">
        <Link
          href={`/projects/${id}/pipelines`}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          View Pipelines →
        </Link>
      </div>

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
