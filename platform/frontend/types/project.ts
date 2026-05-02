// Mirrored from platform/backend-api/src/services/project.service.ts

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
