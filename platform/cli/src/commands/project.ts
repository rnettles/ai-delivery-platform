import { Command } from "commander";
import { request } from "../client";
import { sendNotification } from "../notify";
import { formatProject, formatProjectList } from "../formatters";
import type { ProjectWithChannels, CreateProjectRequest } from "../types";

export function registerProjectCommands(program: Command): void {
  // ── projects ───────────────────────────────────────────────────────────────
  program
    .command("projects")
    .description("List all projects")
    .option("--exclude-channels", "Omit channel mappings from response")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const query = opts.excludeChannels ? {} : { include_channels: "true" };
      const res = await request<ProjectWithChannels[]>({ path: "/projects", query });

      // Backend returns array directly
      const list: ProjectWithChannels[] = Array.isArray(res)
        ? res
        : ((res as unknown as { projects?: ProjectWithChannels[] }).projects ?? []);

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatProjectList(list));
      }

      await sendNotification({
        status: "INFO",
        command: "projects",
        method: "GET",
        path: "/projects",
        formatterSummary: `${list.length} project(s) found.`,
      });
    });

  // ── project ────────────────────────────────────────────────────────────────
  program
    .command("project <projectId>")
    .description("Get a project by ID")
    .option("--json", "Output raw JSON")
    .action(async (projectId: string, opts) => {
      const res = await request<ProjectWithChannels>({ path: `/projects/${projectId}` });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatProject(res));
      }

      await sendNotification({
        status: "INFO",
        command: "project",
        method: "GET",
        path: `/projects/${projectId}`,
        formatterSummary: formatProject(res),
      });
    });

  // ── project-create ─────────────────────────────────────────────────────────
  program
    .command("project-create")
    .description("Create a new project")
    .requiredOption("--project-name <name>", "Project name")
    .requiredOption("--repo-url <url>", "Repository URL")
    .option("--default-branch <branch>", "Default branch", "main")
    .option("--channel-id <id>", "Slack channel ID to assign immediately")
    .requiredOption("--prompt-role <text>", "LLM role/persona definition (injected as preamble into agent conversations)")
    .option("--prompt-context <text>", "LLM project context (injected as preamble into agent conversations)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const body: CreateProjectRequest = {
        name: opts.projectName,
        repo_url: opts.repoUrl,
        default_branch: opts.defaultBranch,
        prompt_role: opts.promptRole,
        prompt_context: opts.promptContext,
      };
      if (opts.channelId) body.channel_id = opts.channelId;

      const res = await request<ProjectWithChannels>({
        method: "POST",
        path: "/projects",
        body,
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatProject(res));
      }

      await sendNotification({
        status: "INFO",
        command: "project-create",
        method: "POST",
        path: "/projects",
        formatterSummary: formatProject(res),
        channelId: opts.channelId,
      });
    });

  // ── project-assign-channel ─────────────────────────────────────────────────
  program
    .command("project-assign-channel")
    .description("Assign a Slack channel to a project")
    .requiredOption("--project-id <id>", "Project ID")
    .requiredOption("--channel-id <id>", "Slack channel ID")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const res = await request<ProjectWithChannels>({
        method: "POST",
        path: `/projects/${opts.projectId}/channels`,
        body: { channel_id: opts.channelId },
      });

      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(formatProject(res));
      }

      await sendNotification({
        status: "INFO",
        command: "project-assign-channel",
        method: "POST",
        path: `/projects/${opts.projectId}/channels`,
        formatterSummary: formatProject(res),
        channelId: opts.channelId,
      });
    });
}


