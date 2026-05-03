import { NextFunction, Request, Response } from "express";
import path from "path";
import { projectService } from "../services/project.service";
import { pipelineService } from "../services/pipeline.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";

interface CreateProjectRequest {
  name?: string;
  repo_url?: string;
  default_branch?: string;
  channel_id?: string;
  prompt_role?: string;
  prompt_context?: string;
}

interface UpdatePromptFieldsRequest {
  prompt_role?: string;
  prompt_context?: string;
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

export async function listProjectsByChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channelId = String(req.query.channel_id ?? "").trim();
    if (!channelId) {
      throw new HttpError(400, "CHANNEL_ID_REQUIRED", "channel_id query parameter is required");
    }

    const projects = await projectService.listByChannelId(channelId);
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
    const promptRole = (body.prompt_role ?? "").trim();
    const promptContext = (body.prompt_context ?? "").trim();

    if (!name) {
      throw new HttpError(400, "PROJECT_NAME_REQUIRED", "name is required");
    }
    if (!repoUrl) {
      throw new HttpError(400, "PROJECT_REPO_URL_REQUIRED", "repo_url is required");
    }
    if (!promptRole) {
      throw new HttpError(400, "PROJECT_PROMPT_ROLE_REQUIRED", "prompt_role is required");
    }

    const existing = await projectService.getByName(name);
    if (existing) {
      throw new HttpError(409, "PROJECT_ALREADY_EXISTS", `Project already exists: ${name}`);
    }

    const project = await projectService.create({
      name,
      repoUrl,
      defaultBranch: defaultBranch || undefined,
      promptRole,
      promptContext: promptContext || undefined,
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

export async function getProjectDesignArtifacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = String(req.params.projectId ?? "");
    if (!projectId) {
      throw new HttpError(400, "PROJECT_ID_REQUIRED", "projectId path parameter is required");
    }

    const result = await designInputGateService.listProjectDesignArtifacts(projectId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getProjectDesignArtifactContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = String(req.params.projectId ?? "");
    const filePath = String(req.query.path ?? "").trim();

    if (!projectId) {
      throw new HttpError(400, "PROJECT_ID_REQUIRED", "projectId path parameter is required");
    }
    if (!filePath) {
      throw new HttpError(400, "PATH_REQUIRED", "Query param 'path' is required");
    }

    const { content, ext } = await designInputGateService.readDesignArtifactContent(projectId, filePath);

    if (ext === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new HttpError(422, "ARTIFACT_PARSE_ERROR", `Artifact '${path.basename(filePath)}' is not valid JSON`);
      }
      res.status(200).json(parsed);
    } else {
      res.status(200).type("text/plain").send(content);
    }
  } catch (error) {
    next(error);
  }
}

export async function getProjectBranches(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = String(req.params.projectId ?? "");
    if (!projectId) {
      throw new HttpError(400, "PROJECT_ID_REQUIRED", "projectId path parameter is required");
    }

    const branches = await pipelineService.listBranchesByProject(projectId);
    res.status(200).json(branches);
  } catch (error) {
    next(error);
  }
}

export async function updateProjectPromptFields(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const projectId = String(req.params.projectId ?? "");
    const body = req.body as UpdatePromptFieldsRequest;
    const promptRole = (body.prompt_role ?? "").trim();
    const promptContext = (body.prompt_context ?? "").trim();

    if (!projectId) {
      throw new HttpError(400, "PROJECT_ID_REQUIRED", "projectId path parameter is required");
    }
    if (!promptRole) {
      throw new HttpError(400, "PROMPT_ROLE_REQUIRED", "prompt_role is required");
    }

    const project = await projectService.updatePromptFields(projectId, promptRole, promptContext || undefined);
    if (!project) {
      throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
    }

    res.status(200).json(project);
  } catch (error) {
    next(error);
  }
}
