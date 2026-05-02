// Mirrored from platform/backend-api/src/services/project.service.ts
// Keep in sync when backend types change.

export interface Project {
  project_id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  clone_path: string;
  prompt_role: string | null;
  prompt_context: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithChannels extends Project {
  channel_ids?: string[];
}

export interface ProjectListResponse {
  projects?: ProjectWithChannels[];
  // Backend may return array directly
}

export interface CreateProjectRequest {
  name: string;
  repo_url: string;
  default_branch?: string;
  channel_id?: string;
  prompt_role: string;
  prompt_context?: string;
}

export interface AssignChannelRequest {
  channel_id: string;
}
