import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { join } from "path";
import { db } from "../db/client";
import { projectChannels, projects } from "../db/schema";
import { config } from "../config";
import { logger } from "./logger.service";

export interface Project {
  project_id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  clone_path: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithChannels extends Project {
  channel_ids?: string[];
}

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    project_id: row.project_id,
    name: row.name,
    repo_url: row.repo_url,
    default_branch: row.default_branch,
    clone_path: row.clone_path,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Derives the Azure Files clone path for a project.
 * Base is /mnt/repo (GIT_CLONE_PATH) — each project gets its own subdirectory.
 * The default project (single-repo legacy mode) uses the base path directly.
 */
function clonePathFor(name: string): string {
  const base = config.gitClonePath; // /mnt/repo in production
  return name === "default" ? base : join(base, name);
}

class ProjectService {
  async list(opts?: { includeChannels?: boolean }): Promise<ProjectWithChannels[]> {
    const rows = await db
      .select()
      .from(projects);

    const base = rows.map((row) => rowToProject(row));

    if (!opts?.includeChannels || base.length === 0) {
      return base;
    }

    const channelRows = await db
      .select({ channel_id: projectChannels.channel_id, project_id: projectChannels.project_id })
      .from(projectChannels);

    const channelsByProjectId = new Map<string, string[]>();
    for (const row of channelRows) {
      const existing = channelsByProjectId.get(row.project_id) ?? [];
      existing.push(row.channel_id);
      channelsByProjectId.set(row.project_id, existing);
    }

    return base.map((project) => ({
      ...project,
      channel_ids: channelsByProjectId.get(project.project_id) ?? [],
    }));
  }

  async getById(projectId: string): Promise<Project | null> {
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.project_id, projectId));
    return row ? rowToProject(row) : null;
  }

  async getByIdWithChannels(projectId: string): Promise<ProjectWithChannels | null> {
    const project = await this.getById(projectId);
    if (!project) return null;

    const channelRows = await db
      .select({ channel_id: projectChannels.channel_id })
      .from(projectChannels)
      .where(eq(projectChannels.project_id, projectId));

    return {
      ...project,
      channel_ids: channelRows.map((row) => row.channel_id),
    };
  }

  async getByChannel(channelId: string): Promise<Project | null> {
    const [mapping] = await db
      .select({ project_id: projectChannels.project_id })
      .from(projectChannels)
      .where(eq(projectChannels.channel_id, channelId));

    if (!mapping) return null;

    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.project_id, mapping.project_id));

    return row ? rowToProject(row) : null;
  }

  async getByName(name: string): Promise<Project | null> {
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.name, name));
    return row ? rowToProject(row) : null;
  }

  async create(opts: {
    name: string;
    repoUrl: string;
    defaultBranch?: string;
  }): Promise<Project> {
    const projectId = randomUUID();
    const clonePath = clonePathFor(opts.name);
    const now = new Date();

    const [row] = await db
      .insert(projects)
      .values({
        project_id: projectId,
        name: opts.name,
        repo_url: opts.repoUrl,
        default_branch: opts.defaultBranch ?? "main",
        clone_path: clonePath,
        created_at: now,
        updated_at: now,
      })
      .returning();

    logger.info("Project created", { project_id: projectId, name: opts.name, clone_path: clonePath });
    return rowToProject(row);
  }

  async registerChannel(channelId: string, projectId: string): Promise<void> {
    await db
      .insert(projectChannels)
      .values({ channel_id: channelId, project_id: projectId, created_at: new Date() })
      .onConflictDoUpdate({ target: projectChannels.channel_id, set: { project_id: projectId } });

    logger.info("Channel registered to project", { channel_id: channelId, project_id: projectId });
  }

  /**
   * Bootstraps the "default" project from GIT_REPO_URL on startup.
   * This maintains backward compatibility for single-repo deployments.
   * No-ops if GIT_REPO_URL is not set or the default project already exists.
   */
  async bootstrapDefault(): Promise<Project | null> {
    const repoUrl = config.gitRepoUrl;
    if (!repoUrl) return null;

    const existing = await this.getByName("default");
    if (existing) return existing;

    logger.info("Bootstrapping default project from GIT_REPO_URL");
    return this.create({ name: "default", repoUrl, defaultBranch: "master" });
  }
}

export const projectService = new ProjectService();
