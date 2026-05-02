"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useProjects";
import { createProject } from "@/lib/api-client";

function CreateProjectForm({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [promptRole, setPromptRole] = useState("");
  const [promptContext, setPromptContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !repoUrl.trim() || !promptRole.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProject({
        name: name.trim(),
        repo_url: repoUrl.trim(),
        default_branch: defaultBranch.trim() || "main",
        prompt_role: promptRole.trim(),
        prompt_context: promptContext.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Project Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-project"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Repository URL <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Default Branch</label>
        <input
          type="text"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          placeholder="main"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Agent Prompt Configuration</p>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Prompt Role <span className="text-red-500">*</span>
          </label>
          <p className="text-[11px] text-gray-500 mb-1">
            Defines the role and persona the LLM will adopt when processing all requests for this project.
          </p>
          <textarea
            required
            value={promptRole}
            onChange={(e) => setPromptRole(e.target.value)}
            rows={4}
            placeholder="You are an expert software engineer specializing in TypeScript and distributed systems. You understand the architectural patterns and constraints of this codebase…"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Prompt Context <span className="text-gray-400 text-[11px] font-normal">(optional)</span>
          </label>
          <p className="text-[11px] text-gray-500 mb-1">
            Provides broader project domain knowledge and system boundaries for the LLM.
          </p>
          <textarea
            value={promptContext}
            onChange={(e) => setPromptContext(e.target.value)}
            rows={5}
            placeholder="This project implements a knowledge extraction pipeline for Confluence documentation. The system classifies pages into tiers and generates structured inventory outputs…"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={submitting || !name.trim() || !repoUrl.trim() || !promptRole.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Creating…" : "Create Project"}
        </button>
      </div>
    </form>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading, isError } = useProjects();
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-6">Projects</h1>
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-6">Projects</h1>
        <p className="text-red-600">Failed to load projects.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          {showForm ? "Cancel" : "+ New Project"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Create New Project</h2>
          <CreateProjectForm onCreated={() => setShowForm(false)} />
        </div>
      )}

      {!projects || projects.length === 0 ? (
        <p className="text-gray-500">No projects found.</p>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <Link
              key={project.project_id}
              href={`/projects/${project.project_id}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{project.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5 truncate">{project.repo_url}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Branch: {project.default_branch}</p>
                  {project.prompt_role && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-1 italic">{project.prompt_role}</p>
                  )}
                </div>
                {project.channel_ids && project.channel_ids.length > 0 && (
                  <span className="ml-4 flex-shrink-0 text-xs bg-gray-100 text-gray-600 rounded px-2 py-1">
                    {project.channel_ids.length} channel{project.channel_ids.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
