import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { githubApiService } from "../services/github-api.service";
import { pipelineService } from "../services/pipeline.service";
import { prRemediationService } from "../services/pr-remediation.service";
import { projectService } from "../services/project.service";
import type { Project } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { ToolDefinition, ToolCall } from "../services/llm/llm-provider.interface";
import { HttpError } from "../utils/http-error";
import { config } from "../config";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
  test_results_path?: string;
  artifact_paths?: string[];
}

interface ArtifactContextFile {
  path: string;
  content: string;
}

/** Parsed representation of the Task Flags block in AI_IMPLEMENTATION_BRIEF.md */
interface TaskFlags {
  fr_ids_in_scope: string[];
  architecture_contract_change: boolean;
  ui_evidence_required: boolean;
  incident_tier: string | null;
}

/** Result of a single gate command run via the run_command tool */
interface GateResult {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  timestamp: string;
}

/** Artifacts owned exclusively by verifier/fixer — Implementer must not write to these */
const VERIFIER_OWNED_ARTIFACTS = ["verification_result.json", "fix_state.json"];

const GATE_COMMAND_TIMEOUT_MS = 120_000;
const GATE_OUTPUT_MAX_CHARS = 4_000;

/**
 * Canonical search paths for the UX gate artifact (user_flow.md).
 * Checked relative to the repo root.
 */
const UX_ARTIFACT_REPO_PATHS = [
  path.join("project_work", "ai_project_tasks", "active", "ux", "user_flow.md"),
  path.join("docs", "design", "user_flow.md"),
  path.join("docs", "user_flow.md"),
];

/**
 * Returns the latest GateResult per unique command.
 * When an agent retries a failing gate (fixes and re-runs), only the most recent
 * result for each command counts — prior failures are superseded by the latest outcome.
 */
function latestResultPerCommand(results: GateResult[]): GateResult[] {
  const map = new Map<string, GateResult>();
  for (const r of results) {
    map.set(r.command, r);
  }
  return Array.from(map.values());
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
    name: "run_command",
    description:
      "Execute a shell command in the repository root for quality gates (lint, typecheck, tests). " +
      "Returns the exit code and captured stdout/stderr. Use this for every mandatory gate before calling finish.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run in the repository root, e.g. npm run lint or npx tsc --noEmit",
        },
      },
      required: ["command"],
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
          // IMP-003: branch must be feature/<task_id>. Pipeline-scoped fallback branches are
          // a policy violation — fail closed and require the operator to stage the task.
          throw new HttpError(
            409,
            "BRANCH_POLICY_VIOLATION",
            "Cannot resolve feature/<task_id> branch: sprint_branch is absent on the pipeline run " +
              "and current_task.json has no task_id. Stage the task via sprint-controller before running Implementer.",
            { pipeline_id: pipelineId }
          );
        }
      }
      context.log("Implementer: repo ready", { clone_path: clonePath, sprint_branch: sprintBranch });
      if (!sprintBranch) throw new Error("Implementer: sprint branch could not be resolved");
    } catch (err) {
      // Re-throw governed HttpErrors (e.g. BRANCH_POLICY_VIOLATION) without wrapping.
      if (err instanceof HttpError) throw err;
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

    // ─── Phase 2: Task Flags enforcement ──────────────────────────────────────────
    // Parse task flags from the brief at the script layer BEFORE the agent loop so that
    // hard-stop guards are deterministic and not reliant on prompt-level behaviour.
    const taskFlags = this.parseTaskFlags(briefArtifact.content);
    context.log("Implementer: task flags parsed", { task_flags: taskFlags });

    // IMP-002 / GTR-005: UX hard-stop — if ui_evidence_required=true, at least one UX
    // artifact (user_flow.md) must be present in the repo before any code is written.
    if (taskFlags.ui_evidence_required && clonePath) {
      const uxFound = await UX_ARTIFACT_REPO_PATHS.reduce<Promise<boolean>>(
        async (acc, relPath) => {
          if (await acc) return true;
          try {
            await fs.access(path.join(clonePath, relPath));
            return true;
          } catch {
            return false;
          }
        },
        Promise.resolve(false)
      );
      if (!uxFound) {
        throw new HttpError(
          422,
          "UX_HARD_STOP",
          "Task flag ui_evidence_required=true but no approved UX artifact (user_flow.md) was found " +
            "in the repository. Run the UX architect agent to produce the interaction contract before " +
            "running Implementer.",
          { searched_paths: UX_ARTIFACT_REPO_PATHS, task_flags: taskFlags }
        );
      }
    }

    // Pre-extract task_id and sprint_id from task artifact for use in failure-path test_results.json
    // (finishPayload is not available when the agent fails to call finish).
    let resolvedTaskId = "unknown";
    let resolvedSprintId = "unknown";
    if (taskArtifact?.content) {
      try {
        const parsedTask = JSON.parse(taskArtifact.content) as { task_id?: string; sprint_id?: string };
        if (parsedTask.task_id) resolvedTaskId = parsedTask.task_id;
        if (parsedTask.sprint_id) resolvedSprintId = parsedTask.sprint_id;
      } catch { /* keep defaults */ }
    }

    // Build the user prompt with all available context
    const contextParts: string[] = [];
    if (briefArtifact) contextParts.push(`# AI_IMPLEMENTATION_BRIEF.md\n\n${briefArtifact.content}`);
    if (taskArtifact) contextParts.push(`# current_task.json\n\n${taskArtifact.content}`);
    if (sprintArtifact) contextParts.push(`# Sprint Plan (context)\n\n${sprintArtifact.content}`);

    // Inject prior-run state so subsequent runs skip already-passing gates and continue from where
    // the prior run stopped rather than re-reading the brief and starting from scratch.
    if (clonePath) {
      const priorCtx = await this.loadPriorRunContext(clonePath, project.project_id, sprintBranch ?? undefined);
      if (priorCtx) contextParts.push(`# Prior Run Context\n\n${priorCtx}`);
    }

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

    const writtenFiles: { path: string; action: "Create" | "Modify" }[] = [];    /** Gate results captured from run_command tool calls during the agent loop */
    const gateResults: GateResult[] = [];    let finishPayload: {
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
        // POL-004 / IMP-001: guard against Implementer writing verifier-owned artifacts.
        if (VERIFIER_OWNED_ARTIFACTS.some((f) => relPath.endsWith(f))) {
          return (
            `Error: '${relPath}' is a verifier-owned artifact. ` +
            "Implementer must not write to verification_result.json or fix_state.json."
          );
        }
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

      if (name === "run_command") {
        const command = String(args["command"] ?? "").trim();
        if (!command) return "Error: command is required";
        if (!clonePath) return "Error: no repository available";
        const timestamp = new Date().toISOString();
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: clonePath,
            timeout: GATE_COMMAND_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
          });
          const result: GateResult = {
            command,
            exit_code: 0,
            stdout: stdout.slice(0, GATE_OUTPUT_MAX_CHARS),
            stderr: stderr.slice(0, GATE_OUTPUT_MAX_CHARS),
            timestamp,
          };
          gateResults.push(result);
          context.notify(`✅ Gate passed: \`${command.slice(0, 60)}\``);
          return `exit_code=0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; code?: number };
          const result: GateResult = {
            command,
            exit_code: typeof e.code === "number" ? e.code : 1,
            stdout: (e.stdout ?? "").slice(0, GATE_OUTPUT_MAX_CHARS),
            stderr: (e.stderr ?? "").slice(0, GATE_OUTPUT_MAX_CHARS),
            timestamp,
          };
          gateResults.push(result);
          context.notify(`❌ Gate failed: \`${command.slice(0, 60)}\` (exit ${result.exit_code})`);
          return `exit_code=${result.exit_code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
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

        // Block finish while any gate is still failing (using latest result per command so retried
        // gates that now pass do not count as failures). Returning an error string keeps the agent
        // in the loop to fix remaining failures rather than handing off broken work.
        const openFailures = latestResultPerCommand(gateResults).filter((r) => r.exit_code !== 0);
        if (openFailures.length > 0) {
          return (
            `Error: ${openFailures.length} gate(s) still failing. Fix all gate failures before calling finish.\n` +
            openFailures.map((g) => `  - \`${g.command}\` (exit ${g.exit_code})`).join("\n") +
            "\nFix the failing gates, then call finish."
          );
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
    let maxIterationsExceeded = false;
    try {
      await provider.chatWithTools(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        FILESYSTEM_TOOLS,
        toolExecutor,
        { maxIterations: 30, max_tokens: 8192 }
      );
    } catch (err) {
      if (String(err).includes("max iterations")) {
        maxIterationsExceeded = true;
        context.log("Implementer: max iterations reached; checkpointing work in progress", {
          written_files: writtenFiles.length,
          gate_results: gateResults.length,
        });
        context.notify("⚠️ Max iterations reached — checkpointing work-in-progress to branch");
      } else {
        throw err;
      }
    }

    // Always write test_results.json to repo before any throw so the next run loads prior context
    // and the operator can review gate state locally by checking out the branch.
    const stopReason = maxIterationsExceeded
      ? "MAX_ITERATIONS"
      : !finishPayload
        ? "FINISH_NOT_CALLED"
        : "completed";
    if (clonePath) {
      await this.writeTestResultsToRepo(
        clonePath,
        resolvedTaskId,
        resolvedSprintId,
        gateResults,
        stopReason
      );
      context.log("Implementer: test_results.json written to repo", { stop_reason: stopReason });
    }

    // Phase 5.3 / MAX_ITERATIONS: fail closed — checkpoint commit first so operator can review
    // failure state locally and subsequent runs continue from where this run stopped.
    if (maxIterationsExceeded || !finishPayload) {
      const failureReason = maxIterationsExceeded ? "MAX_ITERATIONS" : "FINISH_NOT_CALLED";
      if (project && sprintBranch) {
        await this.checkpointCommitOnFailure(project, sprintBranch, gateResults, writtenFiles, failureReason, context, resolvedTaskId, resolvedSprintId);
      }
      if (maxIterationsExceeded) {
        throw new HttpError(
          422,
          "MAX_ITERATIONS",
          "Implementer agent loop exceeded maximum iterations (30). Work has been checkpointed to the branch. " +
            "Rerun Implementer — the next run will load prior gate results and continue from where it left off.",
          { gate_results: gateResults, written_files: writtenFiles }
        );
      }
      throw new HttpError(
        422,
        "FINISH_NOT_CALLED",
        "Implementer agent loop terminated without calling the finish tool. " +
          "Work has been checkpointed to the branch. " +
          "Inspect the agent trace, resolve any gate failures, and rerun.",
        { gate_results: gateResults, written_files: writtenFiles }
      );
    }

    // Capture in a const. TypeScript cannot narrow closure-captured let variables through
    // async callback boundaries; the throw above guarantees non-null at runtime.
    // The double-cast (unknown → FinishPayload) is the TypeScript-safe escape for this pattern.
    const payload = finishPayload as unknown as {
      task_id: string;
      sprint_id: string;
      summary: string;
      files_changed: FileChange[];
    };

    // Post-condition: implementation limit ≤5 files (process_invariants §Implementation Limits, ADR-031).
    // Platform override: tightens governance standard of ≤7 (RUL-007) to ≤5 for platform-driven execution.
    // This is an intentional platform override documented in ADR-031; governance inventory reflects ≤7.
    if (payload.files_changed.length > 5) {
      if (project && sprintBranch) {
        await this.checkpointCommitOnFailure(project, sprintBranch, gateResults, writtenFiles, "INVARIANT_VIOLATION", context, resolvedTaskId, resolvedSprintId);
      }
      throw new HttpError(
        422,
        "INVARIANT_VIOLATION",
        `Implementation limit exceeded: ${payload.files_changed.length} file(s) changed ` +
          "(platform limit: \u22645 files per task; governance standard: \u22647). Reduce scope and retry " +
          "(process_invariants \u00a7Implementation Limits, ADR-031).",
        { files_changed: payload.files_changed.length, limit: 5 }
      );
    }

    // Phase 4.3: Safety-net gate check (defense-in-depth; the in-loop finish guard is the primary
    // enforcement). Uses latest result per command so retried gates that now pass do not block handoff.
    const failedGates = latestResultPerCommand(gateResults).filter((r) => r.exit_code !== 0);
    if (failedGates.length > 0) {
      if (project && sprintBranch) {
        await this.checkpointCommitOnFailure(project, sprintBranch, gateResults, writtenFiles, "GATE_FAILURE", context, resolvedTaskId, resolvedSprintId);
      }
      throw new HttpError(
        422,
        "GATE_FAILURE",
        `${failedGates.length} gate(s) failed. Handoff blocked until all mandatory gates pass.`,
        { failed_gates: failedGates.map((g) => ({ command: g.command, exit_code: g.exit_code })) }
      );
    }

    // Commit + push are mandatory for durable implementer work.
    let commitSha: string | undefined;
    let prNumber: number | undefined;
    let prUrl: string | undefined;
    try {
      const subjectLine = payload.summary.split(/\n/)[0].trim().slice(0, 60);
      const fileLines = payload.files_changed.map((f) => `- ${f.action}: ${f.path}`).join("\n");
      const message = `feat(${payload.task_id}): ${subjectLine}\n\n${fileLines}`;
      commitSha = await projectGitService.commitAll(project, sprintBranch, message);
      await projectGitService.push(project, sprintBranch);
      context.log("Implementer: committed", { commit_sha: commitSha, sprint_branch: sprintBranch });
      context.log("Implementer: pushed", { commit_sha: commitSha, sprint_branch: sprintBranch });
      context.notify(`💾 Committed ${payload.files_changed.length} file(s) to \`${sprintBranch}\` (${commitSha?.slice(0, 7)})`);

      const prTitle = `[${payload.task_id}] ${payload.summary}`;
      const prBody = [
        "## Implementation Summary",
        payload.summary,
        "",
        "## Task",
        `- Task ID: ${payload.task_id}`,
        `- Sprint ID: ${payload.sprint_id}`,
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
    const artifactContent = this.formatMarkdown(payload, commitSha);
    const artifactPath = await artifactService.write(
      pipelineId,
      "implementation_summary.md",
      artifactContent
    );

    const updatedTask = this.buildUpdatedTaskArtifact(taskArtifact?.content, payload, artifactPath);
    const currentTaskPath = await artifactService.write(
      pipelineId,
      "current_task.json",
      JSON.stringify(updatedTask, null, 2)
    );

    // Write test_results.json to the artifact service for downstream pipeline consumption.
    const testResultsArtifactContent = JSON.stringify(
      {
        task_id: payload.task_id,
        sprint_id: payload.sprint_id,
        executed_at: new Date().toISOString(),
        gate_results: gateResults,
        summary:
          gateResults.length > 0
            ? gateResults.every((r) => r.exit_code === 0)
              ? "all_passed"
              : "failed"
            : "no_gates_recorded",
      },
      null,
      2
    );
    const testResultsPath = await artifactService.write(
      pipelineId,
      "test_results.json",
      testResultsArtifactContent
    );

    context.log("Implementer complete", {
      task_id: payload.task_id,
      files_changed: payload.files_changed.length,
      commit_sha: commitSha,
      artifact_path: artifactPath,
      current_task_path: currentTaskPath,
      test_results_path: testResultsPath,
    });

    return {
      ...payload,
      commit_sha: commitSha,
      pr_number: prNumber,
      pr_url: prUrl,
      artifact_path: artifactPath,
      current_task_path: currentTaskPath,
      test_results_path: testResultsPath,
      artifact_paths: [artifactPath, currentTaskPath, testResultsPath],
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
      status: "ready_for_verification",
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
      // IMP-001: terminal status is always ready_for_verification regardless of prior state.
      status: "ready_for_verification",
      artifacts: nextArtifacts,
    };
  }

  /**
   * Parse task flags from the Task Flags block in AI_IMPLEMENTATION_BRIEF.md.
   * Returns safe defaults when a flag is absent or unreadable (TFC-001 compliance).
   * Flag values may not be inferred or modified — only explicitly stated values are accepted.
   */
  private parseTaskFlags(briefContent: string): TaskFlags {
    const defaults: TaskFlags = {
      fr_ids_in_scope: [],
      architecture_contract_change: false,
      ui_evidence_required: false,
      incident_tier: null,
    };

    // Locate the "## Task Flags" section (case-insensitive).
    const sectionMatch = briefContent.match(/##\s*Task Flags\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
    if (!sectionMatch) return defaults;
    const section = sectionMatch[1];

    // fr_ids_in_scope — expected forms: [], [FR-001], [FR-001, FR-002], none
    const frMatch = section.match(/fr_ids_in_scope\s*[:\s]+\[([^\]]*)\]/i);
    if (frMatch) {
      const raw = frMatch[1].trim();
      defaults.fr_ids_in_scope =
        raw === "" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
    }

    // Boolean flags
    const archMatch = section.match(/architecture_contract_change\s*[:\s]+(true|false)/i);
    if (archMatch) defaults.architecture_contract_change = archMatch[1].toLowerCase() === "true";

    const uiMatch = section.match(/ui_evidence_required\s*[:\s]+(true|false)/i);
    if (uiMatch) defaults.ui_evidence_required = uiMatch[1].toLowerCase() === "true";

    // incident_tier — only p0/p1/p2/p3 are active tiers; none/- resolves to null.
    const tierMatch = section.match(/incident_tier\s*[:\s]+(p0|p1|p2|p3|none|-)/i);
    if (tierMatch) {
      const t = tierMatch[1].toLowerCase();
      defaults.incident_tier = t === "none" || t === "-" ? null : t;
    }

    return defaults;
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

  /**
   * Load prior-run context from test_results.json committed to the repo by a previous run.
   * Injects a "Prior Run Context" section into the user prompt so subsequent runs skip
   * already-passing gates and continue from where the prior run left off rather than
   * re-reading the brief and starting from scratch.
   *
   * Falls back to the stable checkpoint file (written outside the git repo by
   * checkpointCommitOnFailure) when the repo file is absent — this recovers prior
   * context even when the checkpoint git commit failed (stash conflicts, push rejection).
   */
  private async loadPriorRunContext(
    clonePath: string,
    projectId?: string,
    sprintBranch?: string
  ): Promise<string | null> {
    const repoPaths = [
      path.join(clonePath, "project_work", "ai_project_tasks", "active", "test_results.json"),
      ...(projectId && sprintBranch ? [this.stableCheckpointPath(projectId, sprintBranch)] : []),
    ];

    let raw: string | null = null;
    for (const candidate of repoPaths) {
      try {
        raw = await fs.readFile(candidate, "utf-8");
        break;
      } catch {
        // try next candidate
      }
    }
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as {
        gate_results?: GateResult[];
        summary?: string;
        executed_at?: string;
        stop_reason?: string;
      };
      const priorGates = parsed.gate_results ?? [];
      if (!parsed.executed_at && priorGates.length === 0) return null;

      const lines: string[] = [
        `> **Prior run** — stopped at ${parsed.executed_at ?? "unknown"} | reason: \`${parsed.stop_reason ?? "unknown"}\` | gate summary: ${parsed.summary ?? "unknown"}`,
        `> Do NOT re-implement work already completed. Continue from where the prior run left off.`,
        "",
      ];

      if (priorGates.length > 0) {
        lines.push("**Gate results from prior run (latest per command):**");
        for (const g of latestResultPerCommand(priorGates)) {
          const icon = g.exit_code === 0 ? "✅" : "❌";
          lines.push(`- ${icon} \`${g.command}\` (exit ${g.exit_code})`);
          if (g.exit_code !== 0) {
            const detail = (g.stderr || g.stdout).slice(0, 600).trim();
            if (detail) lines.push(`  \`\`\`\n  ${detail}\n  \`\`\``);
          }
        }
      }

      const failedCount = latestResultPerCommand(priorGates).filter((r) => r.exit_code !== 0).length;
      if (failedCount > 0) {
        lines.push("", `**${failedCount} gate(s) still need fixing before you can call finish.**`);
      }

      return lines.join("\n");
    } catch {
      return null;
    }
  }

  /**
   * Write test_results.json to the canonical repo path unconditionally — before any throw — so:
   * 1. The next run can inject prior gate context into its prompt via loadPriorRunContext.
   * 2. The operator can check out the branch and inspect gate state locally.
   */
  private async writeTestResultsToRepo(
    clonePath: string,
    taskId: string,
    sprintId: string,
    gateResults: GateResult[],
    stopReason: string
  ): Promise<void> {
    const repoTestResultsPath = path.join(
      clonePath,
      "project_work",
      "ai_project_tasks",
      "active",
      "test_results.json"
    );
    const latest = latestResultPerCommand(gateResults);
    const summary =
      latest.length > 0
        ? latest.every((r) => r.exit_code === 0)
          ? "all_passed"
          : "failed"
        : "no_gates_recorded";
    const payload = {
      task_id: taskId,
      sprint_id: sprintId,
      executed_at: new Date().toISOString(),
      stop_reason: stopReason,
      gate_results: gateResults,
      summary,
    };
    await fs.mkdir(path.dirname(repoTestResultsPath), { recursive: true });
    await fs.writeFile(repoTestResultsPath, JSON.stringify(payload, null, 2), "utf-8");
  }

  /**
   * Best-effort commit and push of all current working-tree changes on a failure path.
   * Allows the operator to review failure state locally (git checkout branch) and gives
   * the next run a clean starting point via the committed test_results.json.
   * Never throws — checkpoint failure must not mask the original error.
   *
   * Also writes a stable checkpoint JSON outside the git repo so loadPriorRunContext
   * can recover prior gate state even when the git commit fails (e.g. stash conflicts).
   */
  private async checkpointCommitOnFailure(
    project: Project,
    sprintBranch: string,
    gateResults: GateResult[],
    writtenFiles: { path: string; action: string }[],
    stopReason: string,
    context: ScriptExecutionContext,
    taskId: string = "unknown",
    sprintId: string = "unknown"
  ): Promise<void> {
    // ── Stable artifact (primary) ────────────────────────────────────────────
    // Write test_results outside the git repo so loadPriorRunContext finds it
    // even when the git commit fails (stash conflicts, push rejection, etc.).
    try {
      const stablePath = this.stableCheckpointPath(project.project_id, sprintBranch);
      const latest = latestResultPerCommand(gateResults);
      const summary =
        latest.length > 0
          ? latest.every((r) => r.exit_code === 0) ? "all_passed" : "failed"
          : "no_gates_recorded";
      const stablePayload = {
        task_id: taskId,
        sprint_id: sprintId,
        executed_at: new Date().toISOString(),
        stop_reason: stopReason,
        gate_results: gateResults,
        summary,
      };
      await fs.mkdir(path.dirname(stablePath), { recursive: true });
      await fs.writeFile(stablePath, JSON.stringify(stablePayload, null, 2), "utf-8");
      context.log("Implementer: stable checkpoint written", { path: stablePath, stop_reason: stopReason });
    } catch (stableErr) {
      context.log("Implementer: stable checkpoint write failed (best-effort)", { error: String(stableErr) });
    }

    // ── Git commit (secondary / operator visibility) ─────────────────────────
    try {
      const latest = latestResultPerCommand(gateResults);
      const passedCount = latest.filter((r) => r.exit_code === 0).length;
      const failedCount = latest.filter((r) => r.exit_code !== 0).length;
      const fileList =
        writtenFiles.length > 0
          ? writtenFiles.map((f) => `- ${f.action}: ${f.path}`).join("\n")
          : "none";
      const gateList =
        failedCount > 0
          ? latest
              .filter((r) => r.exit_code !== 0)
              .map((g) => `- ${g.command} (exit ${g.exit_code})`)
              .join("\n")
          : "none";

      const message = [
        `chore(implementer): checkpoint [${stopReason}]`,
        "",
        `Stop reason: ${stopReason}`,
        `Gates: ${passedCount} passed, ${failedCount} failed`,
        "",
        `Files written:\n${fileList}`,
        "",
        `Failed gates:\n${gateList}`,
      ].join("\n");

      await projectGitService.commitAll(project, sprintBranch, message);
      await projectGitService.push(project, sprintBranch);
      context.log("Implementer: checkpoint commit pushed", {
        stop_reason: stopReason,
        sprint_branch: sprintBranch,
      });
      context.notify(
        `💾 Checkpoint commit pushed to \`${sprintBranch}\` [${stopReason}]. ` +
          "Review locally before retrying."
      );
    } catch (err) {
      // Best-effort: do not let checkpoint failure mask the original error.
      context.log("Implementer: checkpoint commit failed (best-effort, ignoring)", {
        error: String(err),
      });
    }
  }

  /**
   * Returns the absolute path to the stable checkpoint file for a project+branch.
   * This file lives outside the git repo (in the artifact base dir) so it survives
   * cleanWorkingTree and git-clean operations that would otherwise wipe an uncommitted
   * test_results.json from the clone working tree.
   */
  private stableCheckpointPath(projectId: string, sprintBranch: string): string {
    const key = `${projectId}-${sprintBranch.replace(/[^a-zA-Z0-9-]/g, "_")}`;
    return path.join(config.artifactBasePath, "_checkpoints", `${key}.json`);
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

