import { NextFunction, Request, Response } from "express";
import { projectService } from "../services/project.service";
import { HttpError } from "../utils/http-error";

interface CreateProjectRequest {
  name?: string;
  repo_url?: string;
  default_branch?: string;
  channel_id?: string;
}

interface AssignChannelRequest {
  channel_id?: string;
}

function parseBooleanQueryValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function listProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeChannels = parseBooleanQueryValue(req.query.include_channels);
    const projects = await projectService.list({ includeChannels });
    res.status(200).json(projects);
  } catch (error) {
    next(error);
  }
}

export async function getProject(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = String(req.params.projectId ?? "");
    if (!projectId) {
      throw new HttpError(400, "PROJECT_ID_REQUIRED", "projectId path parameter is required");
    }

    const project = await projectService.getByIdWithChannels(projectId);
    if (!project) {
      throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
    }

    res.status(200).json(project);
  } catch (error) {
    next(error);
  }
}

export async function createProject(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateProjectRequest;
    const name = (body.name ?? "").trim();
    const repoUrl = (body.repo_url ?? "").trim();
    const defaultBranch = (body.default_branch ?? "").trim();
    const channelId = (body.channel_id ?? "").trim();

    if (!name) {
      throw new HttpError(400, "PROJECT_NAME_REQUIRED", "name is required");
    }
    if (!repoUrl) {
      throw new HttpError(400, "PROJECT_REPO_URL_REQUIRED", "repo_url is required");
    }

    const existing = await projectService.getByName(name);
    if (existing) {
      throw new HttpError(409, "PROJECT_ALREADY_EXISTS", `Project already exists: ${name}`);
    }

    const project = await projectService.create({
      name,
      repoUrl,
      defaultBranch: defaultBranch || undefined,
    });

    if (channelId) {
      await projectService.registerChannel(channelId, project.project_id);
    }

    res.status(201).json({
      ...project,
      channel_id: channelId || undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function assignProjectChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = String(req.params.projectId ?? "");
    const body = req.body as AssignChannelRequest;
    const channelId = (body.channel_id ?? "").trim();

    if (!projectId) {
      throw new HttpError(400, "PROJECT_ID_REQUIRED", "projectId path parameter is required");
    }
    if (!channelId) {
      throw new HttpError(400, "CHANNEL_ID_REQUIRED", "channel_id is required");
    }

    const project = await projectService.getById(projectId);
    if (!project) {
      throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
    }

    await projectService.registerChannel(channelId, projectId);

    res.status(200).json({
      project_id: projectId,
      channel_id: channelId,
    });
  } catch (error) {
    next(error);
  }
}
