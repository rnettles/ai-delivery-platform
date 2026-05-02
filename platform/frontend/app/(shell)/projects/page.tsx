"use client";

import Link from "next/link";
import { useProjects } from "@/hooks/useProjects";

export default function ProjectsPage() {
  const { data: projects, isLoading, isError } = useProjects();

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

  if (!projects || projects.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-6">Projects</h1>
        <p className="text-gray-500">No projects found.</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-6">Projects</h1>
      <div className="space-y-3">
        {projects.map((project) => (
          <Link
            key={project.project_id}
            href={`/projects/${project.project_id}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{project.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{project.repo_url}</p>
                <p className="text-xs text-gray-400 mt-0.5">Branch: {project.default_branch}</p>
              </div>
              {project.channel_ids && project.channel_ids.length > 0 && (
                <span className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-1">
                  {project.channel_ids.length} channel{project.channel_ids.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
