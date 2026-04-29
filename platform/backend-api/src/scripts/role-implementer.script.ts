import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { githubApiService } from "../services/github-api.service";
import { pipelineService } from "../services/pipeline.service";
import { prRemediationService } from "../services/pr-remediation.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { ToolDefinition, ToolCall } from "../services/llm/llm-provider.interface";
import { HttpError } from "../utils/http-error";
import fs from "fs/promises";
import path from "path";

export interface ImplementerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface FileChange {
  path: string;
  action: "Create" | "Modify";
  description: string;
}

export interface ImplementerOutput {
  task_id: string;
  sprint_id: string;
  summary: string;
  files_changed: FileChange[];
  commit_sha?: string;
  pr_number?: number;
  pr_url?: string;
  artifact_path: string;
  current_task_path?: string;
  artifact_paths?: string[];
}

interface ArtifactContextFile {
  path: string;
  content: string;
}

// ─── Filesystem tools exposed to the LLM ─────────────────────────────────────

const FILESYSTEM_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a file in the repository. Path must be relative to the repo root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root, e.g. src/server.ts" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write (create or overwrite) a file in the repository. Path must be relative to the repo root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root, e.g. src/models/user.ts" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and subdirectories at a path within the repository.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root. Use '.' for the root." },
      },
      required: ["path"],
    },
  },
  {
    name: "finish",
    description: "Signal that implementation is complete. Provide a summary and list of files changed.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task_id from current_task.json" },
        sprint_id: { type: "string", description: "The sprint_id from the sprint plan" },
        summary: { type: "string", description: "A concise description of what was implemented" },
        files_changed: {
          type: "string",
          description: "JSON array of {path, action, description} objects (action: Create|Modify)",
        },
      },
      required: ["task_id", "sprint_id", "summary", "files_changed"],
    },
  },
];

export class ImplementerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.implementer",
    version: "2026.04.19",
    description: "Autonomously implements a task from AI_IMPLEMENTATION_BRIEF.md using a tool-calling loop. Reads/writes files in the repo, then commits the result.",
    input_schema: {
      type: "object",
      properties: {
        previous_artifacts: { type: "array" },
        pipeline_id: { type: "string" },
      },
      additionalProperties: true,
    },
    output_schema: {
      type: "object",
      required: ["task_id", "sprint_id", "summary", "files_changed", "artifact_path"],
    },
    tags: ["role", "implementer"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<ImplementerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Implementer running", { pipeline_id: pipelineId });
    context.notify("⚙️ Starting implementation — reading task brief and exploring codebase...");

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Load context artifacts from the current pipeline first.
    let briefArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))
    );
    let taskArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task"))
    );
    let sprintArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_plan"))
    );

    // Resolve project + sprint branch for git operations
    let clonePath: string | null = null;
    let sprintBranch: string | null = null;
    let project = null;

    try {
      const run = await pipelineService.get(pipelineId);
      sprintBranch = run.sprint_branch ?? null;
      project = run.project_id
        ? await projectService.getById(run.project_id)
        : await projectService.getByName("default");

      if (!project) {
        throw new Error("Implementer requires a project mapping so work can be committed and pushed");
      }

      clonePath = project.clone_path;
      await projectGitService.ensureReady(project);

      if (run.sprint_branch) {
        // Sprint controller already created and staged this branch — just check it out.
        await projectGitService.checkoutBranch(project, run.sprint_branch);
      } else {
        // Reuse the active sprint task branch when available to keep work on a single PR.
        const activeTaskBranch = await this.resolveActiveTaskBranch(project.clone_path);
        if (activeTaskBranch) {
          sprintBranch = activeTaskBranch;
          context.log("Implementer: no sprint branch on run, adopting active task branch", {
            pipeline_id: pipelineId,
            sprint_branch: sprintBranch,
          });
          await projectGitService.createBranch(project, sprintBranch);
          await pipelineService.setSprintBranch(pipelineId, sprintBranch);
        } else {
          // Last-resort fallback: create a pipeline-scoped branch.
          const safePipelineId = String(pipelineId).replace(/[^a-zA-Z0-9._/-]/g, "-");
          sprintBranch = `feature/${safePipelineId}`;
          context.log("Implementer: no sprint branch on run, creating fallback branch", {
            pipeline_id: pipelineId,
            sprint_branch: sprintBranch,
          });
          await projectGitService.createBranch(project, sprintBranch);
          await pipelineService.setSprintBranch(pipelineId, sprintBranch);
        }
      }
      context.log("Implementer: repo ready", { clone_path: clonePath, sprint_branch: sprintBranch });
      if (!sprintBranch) throw new Error("Implementer: sprint branch could not be resolved");
    } catch (err) {
      context.log("Implementer: project/git resolution failed", {
        error: String(err),
      });
      throw new Error(`Implementer cannot proceed without git persistence: ${String(err)}`);
    }

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "implementer");
    context.notify(
      `📚 Design inputs validated (${designInputs.sample_files.length} found). ` +
      `Using project: \`${designInputs.project_name}\``
    );

    // Backstop the governance rules in script logic: if this pipeline invocation lacks
    // staged task artifacts, reuse the canonical active task package from the repo.
    if (!briefArtifact || !taskArtifact || !sprintArtifact) {
      const activeArtifacts = await this.loadActiveTaskArtifacts(clonePath ?? project.clone_path);
      briefArtifact = briefArtifact ?? activeArtifacts.briefArtifact;
      taskArtifact = taskArtifact ?? activeArtifacts.taskArtifact;
      sprintArtifact = sprintArtifact ?? activeArtifacts.sprintArtifact;
    }

    if (!briefArtifact || !taskArtifact || !sprintArtifact) {
      throw new HttpError(
        409,
        "MISSING_ACTIVE_TASK_PACKAGE",
        "Implementer requires an active task package (sprint_plan, AI_IMPLEMENTATION_BRIEF.md, current_task.json). Stage or reuse the open task package before running Implementer.",
      );
    }

    // Build the user prompt with all available context
    const contextParts: string[] = [];
    if (briefArtifact) contextParts.push(`# AI_IMPLEMENTATION_BRIEF.md\n\n${briefArtifact.content}`);
    if (taskArtifact) contextParts.push(`# current_task.json\n\n${taskArtifact.content}`);
    if (sprintArtifact) contextParts.push(`# Sprint Plan (context)\n\n${sprintArtifact.content}`);

    const repoNote = clonePath
      ? `\n\nThe repository is available for you to read and write. Use the provided tools to explore the codebase and implement the task. When you are done, call the \`finish\` tool.`
      : `\n\nNo repository is available. Describe what you would implement in the finish tool's summary.`;

    const userContent =
      contextParts.length > 0
        ? `${contextParts.join("\n\n---\n\n")}${repoNote}`
        : `No implementation brief found.${repoNote}`;

    const systemPrompt = await governanceService.getComposedPrompt("implementer");
    const provider = await llmFactory.forRole("implementer");

    // ─── Tool execution state ────────────────────────────────────────────────

    const writtenFiles: { path: string; action: "Create" | "Modify" }[] = [];
    let finishPayload: {
      task_id: string;
      sprint_id: string;
      summary: string;
      files_changed: FileChange[];
    } | null = null;

    const toolExecutor = async (toolCall: ToolCall): Promise<string> => {
      const { name, arguments: args } = toolCall;

      if (name === "read_file") {
        const relPath = String(args["path"] ?? "");
        if (!clonePath) return "Error: no repository available";
        const safeAbs = this.safeResolve(clonePath, relPath);
        if (!safeAbs) return `Error: path '${relPath}' is outside the repository root`;
        try {
          const content = await fs.readFile(safeAbs, "utf-8");
          return content;
        } catch {
          return `Error: file not found at ${relPath}`;
        }
      }

      if (name === "write_file") {
        const relPath = String(args["path"] ?? "");
        const content = String(args["content"] ?? "");
        if (!clonePath) return "Error: no repository available";
        const safeAbs = this.safeResolve(clonePath, relPath);
        if (!safeAbs) return `Error: path '${relPath}' is outside the repository root`;
        let exists = false;
        try {
          await fs.access(safeAbs);
          exists = true;
        } catch { /* does not exist */ }
        await fs.mkdir(path.dirname(safeAbs), { recursive: true });
        await fs.writeFile(safeAbs, content, "utf-8");
        writtenFiles.push({ path: relPath, action: exists ? "Modify" : "Create" });
        context.notify(`${exists ? "✏️ Modifying" : "📄 Creating"} \`${relPath}\``);
        return `OK: wrote ${relPath}`;
      }

      if (name === "list_directory") {
        const relPath = String(args["path"] ?? ".");
        if (!clonePath) return "Error: no repository available";
        const safeAbs = this.safeResolve(clonePath, relPath);
        if (!safeAbs) return `Error: path '${relPath}' is outside the repository root`;
        try {
          const entries = await fs.readdir(safeAbs, { withFileTypes: true });
          return entries
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .join("\n");
        } catch {
          return `Error: directory not found at ${relPath}`;
        }
      }

      if (name === "finish") {
        const rawFiles = String(args["files_changed"] ?? "[]");
        let parsedFiles: FileChange[] = [];
        try {
          parsedFiles = JSON.parse(rawFiles) as FileChange[];
        } catch {
          // fall back to written files tracked during the loop
        }

        if (parsedFiles.length === 0 && writtenFiles.length > 0) {
          parsedFiles = writtenFiles.map((f) => ({ ...f, description: `${f.action}d by implementer` }));
        }

        finishPayload = {
          task_id: String(args["task_id"] ?? "unknown"),
          sprint_id: String(args["sprint_id"] ?? "unknown"),
          summary: String(args["summary"] ?? ""),
          files_changed: parsedFiles,
        };
        return "Implementation recorded. Loop will terminate.";
      }

      return `Unknown tool: ${name}`;
    };

    // Run the agentic loop (max 30 iterations for a real implementation)
    await provider.chatWithTools(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      FILESYSTEM_TOOLS,
      toolExecutor,
      { maxIterations: 30, max_tokens: 8192 }
    );

    // If finish was not called, build a fallback from tracked writes
    if (!finishPayload) {
      const taskId = taskArtifact
        ? (() => {
            try { return (JSON.parse(taskArtifact.content) as { task_id?: string }).task_id ?? "unknown"; }
            catch { return "unknown"; }
          })()
        : "unknown";

      finishPayload = {
        task_id: taskId,
        sprint_id: "unknown",
        summary: "Implementation completed (finish tool not called)",
        files_changed: writtenFiles.map((f) => ({ ...f, description: `${f.action}d` })),
      };
    }

    // Post-condition: implementation limit ≤5 files (process_invariants §Implementation Limits, ADR-031)
    // Layer 3 tightens the Layer 1 standard of ≤7 to ≤5 for platform-driven execution.
    if (finishPayload.files_changed.length > 5) {
      throw new HttpError(
        422,
        "INVARIANT_VIOLATION",
        `Implementation limit exceeded: ${finishPayload.files_changed.length} file(s) changed ` +
          "(platform limit: ≤5 files per task). Reduce scope and retry " +
          "(process_invariants §Implementation Limits).",
        { files_changed: finishPayload.files_changed.length, limit: 5 }
      );
    }

    // Commit + push are mandatory for durable implementer work.
    let commitSha: string | undefined;
    let prNumber: number | undefined;
    let prUrl: string | undefined;
    try {
      const subjectLine = finishPayload.summary.split(/\n/)[0].trim().slice(0, 60);
      const fileLines = finishPayload.files_changed.map((f) => `- ${f.action}: ${f.path}`).join("\n");
      const message = `feat(${finishPayload.task_id}): ${subjectLine}\n\n${fileLines}`;
      commitSha = await projectGitService.commitAll(project, sprintBranch, message);
      await projectGitService.push(project, sprintBranch);
      context.log("Implementer: committed", { commit_sha: commitSha, sprint_branch: sprintBranch });
      context.log("Implementer: pushed", { commit_sha: commitSha, sprint_branch: sprintBranch });
      context.notify(`💾 Committed ${finishPayload!.files_changed.length} file(s) to \`${sprintBranch}\` (${commitSha?.slice(0, 7)})`);

      const prTitle = `[${finishPayload.task_id}] ${finishPayload.summary}`;
      const prBody = [
        "## Implementation Summary",
        finishPayload.summary,
        "",
        "## Task",
        `- Task ID: ${finishPayload.task_id}`,
        `- Sprint ID: ${finishPayload.sprint_id}`,
        `- Commit: ${commitSha}`,
        `- Branch: ${sprintBranch}`,
      ].join("\n");

      const existingPr = await githubApiService.findOpenPullRequestByHead({
        repoUrl: project.repo_url,
        head: sprintBranch,
        base: project.default_branch,
      });

      const pr = existingPr ?? (await prRemediationService.createPullRequestWithRecovery(project, {
        title: prTitle,
        body: prBody,
        head: sprintBranch,
        base: project.default_branch,
      })).pr;

      prNumber = pr.number;
      prUrl = pr.html_url;
      await pipelineService.setPrDetails(pipelineId, pr.number, pr.html_url, sprintBranch);
      context.notify(`🔗 Implementer opened PR #${pr.number}: <${pr.html_url}|View Pull Request>`);
      context.notify("⏳ PR remains open for sprint-end merge gate.");
    } catch (err) {
      context.log("Implementer: git commit/push failed", {
        error: String(err),
        sprint_branch: sprintBranch,
      });
      throw new Error(`Implementer failed to persist work and update PR state: ${String(err)}`);
    }

    // Write evidence artifact
    const artifactContent = this.formatMarkdown(finishPayload, commitSha);
    const artifactPath = await artifactService.write(
      pipelineId,
      "implementation_summary.md",
      artifactContent
    );

    const updatedTask = this.buildUpdatedTaskArtifact(taskArtifact?.content, finishPayload, artifactPath);
    const currentTaskPath = await artifactService.write(
      pipelineId,
      "current_task.json",
      JSON.stringify(updatedTask, null, 2)
    );

    context.log("Implementer complete", {
      task_id: finishPayload.task_id,
      files_changed: finishPayload.files_changed.length,
      commit_sha: commitSha,
      artifact_path: artifactPath,
      current_task_path: currentTaskPath,
    });

    return {
      ...finishPayload,
      commit_sha: commitSha,
      pr_number: prNumber,
      pr_url: prUrl,
      artifact_path: artifactPath,
      current_task_path: currentTaskPath,
      artifact_paths: [artifactPath, currentTaskPath],
    } satisfies ImplementerOutput;
  }

  private buildUpdatedTaskArtifact(
    existingTaskJson: string | undefined,
    finishPayload: { task_id: string; summary: string; files_changed: FileChange[] },
    implementationSummaryPath: string
  ): Record<string, unknown> {
    let base: Record<string, unknown> = {
      task_id: finishPayload.task_id,
      title: finishPayload.summary.split(/\n/)[0].trim() || "Implementation complete",
      description: finishPayload.summary,
      assigned_to: "implementer",
      status: "implemented",
      artifacts: [],
    };

    if (existingTaskJson) {
      try {
        const parsed = JSON.parse(existingTaskJson) as Record<string, unknown>;
        base = { ...parsed };
      } catch {
        // ignore malformed task context and use synthesized fallback
      }
    }

    const existingArtifacts = Array.isArray(base.artifacts)
      ? (base.artifacts as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const nextArtifacts = Array.from(new Set([...existingArtifacts, implementationSummaryPath]));

    return {
      ...base,
      task_id: finishPayload.task_id,
      status: "implemented",
      artifacts: nextArtifacts,
    };
  }

  /**
   * Resolve a user-supplied relative path within clonePath.
   * Returns the absolute path if it is safely within clonePath, or null if it escapes.
   */
  private safeResolve(clonePath: string, relPath: string): string | null {
    // Normalise to reject absolute paths and traversal attempts
    const normalised = path.normalize(relPath);
    if (path.isAbsolute(normalised)) return null;
    const abs = path.join(clonePath, normalised);
    // Verify the resolved path is still within clonePath
    const relative = path.relative(clonePath, abs);
    if (relative.startsWith("..")) return null;
    return abs;
  }

  private async resolveActiveTaskBranch(clonePath: string): Promise<string | null> {
    const activeTaskPath = path.join(
      clonePath,
      "project_work",
      "ai_project_tasks",
      "active",
      "current_task.json"
    );
    try {
      const raw = await fs.readFile(activeTaskPath, "utf-8");
      const parsed = JSON.parse(raw) as { task_id?: string };
      const taskId = parsed.task_id?.trim();
      if (!taskId) return null;
      return `feature/${taskId}`;
    } catch {
      return null;
    }
  }

  private async loadActiveTaskArtifacts(clonePath: string): Promise<{
    briefArtifact: ArtifactContextFile | null;
    taskArtifact: ArtifactContextFile | null;
    sprintArtifact: ArtifactContextFile | null;
  }> {
    const activeDir = path.join(clonePath, "project_work", "ai_project_tasks", "active");
    const readOptional = async (filePath: string): Promise<ArtifactContextFile | null> => {
      try {
        return {
          path: filePath,
          content: await fs.readFile(filePath, "utf-8"),
        };
      } catch {
        return null;
      }
    };

    let sprintArtifact: ArtifactContextFile | null = null;
    try {
      const entries = await fs.readdir(activeDir, { withFileTypes: true });
      const sprintPlanEntry = entries.find((entry) => entry.isFile() && /^sprint_plan_.*\.md$/i.test(entry.name));
      if (sprintPlanEntry) {
        sprintArtifact = await readOptional(path.join(activeDir, sprintPlanEntry.name));
      }
    } catch {
      // no active dir
    }

    return {
      briefArtifact: await readOptional(path.join(activeDir, "AI_IMPLEMENTATION_BRIEF.md")),
      taskArtifact: await readOptional(path.join(activeDir, "current_task.json")),
      sprintArtifact,
    };
  }

  private formatMarkdown(
    impl: { task_id: string; sprint_id: string; summary: string; files_changed: FileChange[] },
    commitSha?: string
  ): string {
    const fileLines = impl.files_changed
      .map((f) => `### ${f.action}: \`${f.path}\`\n${f.description}`)
      .join("\n\n");

    return `# Implementation Summary

**Task:** ${impl.task_id}
**Sprint:** ${impl.sprint_id}${commitSha ? `\n**Commit:** ${commitSha}` : ""}

## Summary
${impl.summary}

## Files Changed

${fileLines || "_No files changed._"}
`;
  }
}

