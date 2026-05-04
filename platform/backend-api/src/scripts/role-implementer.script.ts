import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import type { Project } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { ToolDefinition, ToolCall } from "../services/llm/llm-provider.interface";
import { HttpError } from "../utils/http-error";
import { parseBrief, parseExecutionContract } from "../utils/brief-parser";
import { buildProjectPreamble } from "../utils/prompt-preamble";
import { executionContractEnforcer } from "../services/execution-contract-enforcer.service";
import type { ExecutionContract } from "../domain/execution-contract.types";
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
  turn_log_path?: string;
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
  {
    // Phase 4 (ADR-033): cross-session continuity. The implementer should call
    // this once before finishing — and again whenever it pauses on a blocker —
    // so the next run can resume cleanly even if iterations are exhausted.
    name: "set_progress",
    description:
      "Persist current work state for cross-session continuity. Call before finishing, and " +
      "any time you pause on a blocker, so the next run can resume cleanly. Writes to " +
      "the pipeline artifact store as progress.json.",
    parameters: {
      type: "object",
      properties: {
        current_focus: {
          type: "string",
          description: "One-sentence description of what you are currently working on.",
        },
        open_todos: {
          type: "array",
          description: "Outstanding work items still to be done.",
          items: { type: "string" },
        },
        blockers: {
          type: "array",
          description: "External blockers or unanswered questions, if any.",
          items: { type: "string" },
        },
        planned_next_action: {
          type: "string",
          description: "The single next concrete action to take when work resumes.",
        },
      },
      required: ["current_focus", "planned_next_action"],
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

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "implementer", "plan", "implementer");
    context.notify(
      `📚 Design inputs validated (${designInputs.sample_files.length} found). ` +
      `Using project: \`${designInputs.project_name}\``
    );

    // ADR-035: sprint artifact (from staged_sprints/) is not in previous_artifacts — load it from repo.
    if (!sprintArtifact) {
      const repoSprintArtifact = await this.loadStagedSprintArtifact(clonePath ?? project.clone_path);
      sprintArtifact = sprintArtifact ?? repoSprintArtifact;
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

    // ─── Phase 2 (ADR-033): auto-inject referenced design docs ─────────────
    // Reads `## Design References` from the brief, loads each referenced file from
    // the repo, and injects it directly into context. ADRs are prioritised over
    // FRs so contract-of-record wins when the budget is tight.
    if (briefArtifact && clonePath) {
      const parsed = parseBrief(briefArtifact.content);
      if (parsed.designRefs.length > 0) {
        const ranked = [...parsed.designRefs].sort((a, b) => {
          const score = (p: string) => (/(^|\/)docs\/adr\//i.test(p) ? 0 : 1);
          return score(a) - score(b);
        });
        const MAX_TOTAL_CHARS = 6000;
        let used = 0;
        const blocks: string[] = [];
        for (const relpath of ranked) {
          if (used >= MAX_TOTAL_CHARS) break;
          const safeAbs = this.safeResolve(clonePath, relpath);
          if (!safeAbs) continue;
          try {
            const raw = await fs.readFile(safeAbs, "utf-8");
            const remaining = MAX_TOTAL_CHARS - used;
            const slice = raw.length > remaining ? `${raw.slice(0, remaining)}\n[...truncated]` : raw;
            blocks.push(`# Design Reference: ${relpath}\n\n${slice}`);
            used += slice.length;
          } catch {
            // Reference missing — skip silently; LLM still has the brief.
          }
        }
        if (blocks.length > 0) {
          contextParts.push(blocks.join("\n\n---\n\n"));
          context.log("Implementer: injected design references", {
            count: blocks.length,
            chars: used,
          });
        }
      }
    }

    // Inject prior-run state so subsequent runs skip already-passing gates and continue from where
    // the prior run stopped rather than re-reading the brief and starting from scratch.
    const priorCtx = await this.loadPriorRunContext(previousArtifacts, project.project_id, sprintBranch ?? undefined);
    if (priorCtx) contextParts.push(`# Prior Run Context\n\n${priorCtx}`);

    // ─── Phase 3 (ADR-033): structured prior-run extras ────────────────────
    const progressBlock = await this.loadProgressArtifact(previousArtifacts);
    if (progressBlock) contextParts.push(`# Prior Run State\n\n${progressBlock}`);

    const corrections = await this.extractCorrections(previousArtifacts);
    if (corrections) contextParts.push(`# Required Corrections (from prior verification)\n\n${corrections}`);

    if (clonePath && sprintBranch) {
      const changedFiles = await this.computeChangedFiles(clonePath, sprintBranch);
      if (changedFiles && changedFiles.length > 0) {
        const lines = changedFiles.map((c) => `- ${c.status} \`${c.path}\``);
        contextParts.push(`# Files Changed Since Branch Diverged\n\n${lines.join("\n")}`);
      }
    }

    // ─── Phase 4 (ADR-033): Execution Contract extraction ──────────────────
    // The Sprint Controller emits Section 0 of the brief as a fenced JSON block
    // when the sprint plan is rich (Phase 3). When present, it binds the
    // Implementer's tool layer below: write_file enforces allowed_paths,
    // run_command enforces the canonical command set, package.json edits enforce
    // dependencies.allowed, and finish requires all three contract gates green.
    // Legacy thin briefs return null here, in which case Phase 1–3 behaviour is
    // preserved (only VERIFIER_OWNED_ARTIFACTS guard remains).
    const executionContract: ExecutionContract | null = briefArtifact
      ? parseExecutionContract(briefArtifact.content)
      : null;
    if (executionContract) {
      context.log("Implementer: execution contract loaded", {
        task_id: executionContract.task_id,
        allowed_paths: executionContract.scope.allowed_paths.length,
        forbidden: executionContract.scope.forbidden_actions.length,
      });

      // Runtime fallback: if working_directory is absent and there is no package.json at
      // the repo root, auto-detect from one level of subdirectories. Handles contracts
      // staged before the sprint-controller auto-detect was added (2026-05-03).
      if (clonePath && !executionContract.commands.working_directory) {
        let rootPkgExists = false;
        try {
          await fs.access(path.join(clonePath, "package.json"));
          rootPkgExists = true;
        } catch { /* no root package.json */ }

        if (!rootPkgExists) {
          const entries = await fs.readdir(clonePath, { withFileTypes: true });
          const candidates: string[] = [];
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
            try {
              await fs.access(path.join(clonePath, entry.name, "package.json"));
              candidates.push(entry.name);
            } catch { /* no package.json */ }
          }
          if (candidates.length === 1) {
            executionContract.commands.working_directory = candidates[0];
            context.notify(
              `⚠️ Contract missing working_directory — auto-detected \`${candidates[0]}\` (no root package.json). ` +
              `Re-stage the task to make this permanent.`
            );
          }
        }
      }
    }

    // Auto-install: if the contract declares a working_directory + install_command and node_modules
    // is absent, run the install command before the agent loop so gate commands (lint, tsc) can
    // execute. This is deterministic — no LLM involvement. node_modules is gitignored and will
    // always be absent on a fresh clone or a machine that hasn't installed deps yet.
    if (clonePath && executionContract?.commands?.working_directory && executionContract?.dependencies?.install_command) {
      const workDir = path.join(clonePath, executionContract.commands.working_directory);
      const nodeModulesPath = path.join(workDir, "node_modules");
      let nodeModulesMissing = false;
      try {
        await fs.access(nodeModulesPath);
      } catch {
        nodeModulesMissing = true;
      }
      if (nodeModulesMissing) {
        context.notify(`📦 Installing dependencies in \`${executionContract.commands.working_directory}\`...`);
        try {
          await execAsync(executionContract.dependencies.install_command, {
            cwd: workDir,
            timeout: 180_000,
          });
          context.notify(`✅ Dependencies installed`);
          context.log("Implementer: auto-installed dependencies", {
            working_directory: executionContract.commands.working_directory,
            install_command: executionContract.dependencies.install_command,
          });
        } catch (installErr) {
          // Non-fatal: log and continue — gate commands will surface the error naturally.
          context.log("Implementer: auto-install failed (non-fatal)", { error: String(installErr) });
          context.notify(`⚠️ Dependency install failed — gate commands may fail. Check \`${executionContract.commands.working_directory}/package.json\`.`);
        }
      }
    }

    const repoNote = clonePath
      ? `\n\nThe repository is available for you to read and write. Use the provided tools to explore the codebase and implement the task. When you are done, call the \`finish\` tool.`
      : `\n\nNo repository is available. Describe what you would implement in the finish tool's summary.`;

    const userContent =
      contextParts.length > 0
        ? `${contextParts.join("\n\n---\n\n")}${repoNote}`
        : `No implementation brief found.${repoNote}`;

    const systemPrompt = buildProjectPreamble(project) + await governanceService.getComposedPrompt("implementer");
    const provider = await llmFactory.forRole("implementer");

    // ─── Tool execution state ────────────────────────────────────────────────

    const writtenFiles: { path: string; action: "Create" | "Modify" }[] = [];    /** Gate results captured from run_command tool calls during the agent loop */
    const gateResults: GateResult[] = [];    let finishPayload: {
      task_id: string;
      sprint_id: string;
      summary: string;
      files_changed: FileChange[];
    } | null = null;

    /** Phase 4 (ADR-033): last `set_progress` snapshot written by the agent. */
    let lastProgress: {
      current_focus: string;
      open_todos: string[];
      blockers: string[];
      planned_next_action: string;
      recorded_at: string;
    } | null = null;

    /** Per-turn log for diagnostics — one entry per toolExecutor call. */
    let turnCounter = 0;
    const turnLog: {
      turn: number;
      tool: string;
      args_summary: string;
      result_summary: string;
      timestamp: string;
    }[] = [];
    /** Path to the persisted turn_log.json artifact (hoisted so all paths — success, failure — can populate it). */
    let turnLogArtifactPath: string | undefined;

    /** Phase 4 helper: persist progress snapshot to pipeline artifact service (ADR-035). */
    const persistProgress = async (snapshot: {
      current_focus: string;
      open_todos: string[];
      blockers: string[];
      planned_next_action: string;
      recorded_at: string;
    }): Promise<void> => {
      const json = JSON.stringify(snapshot, null, 2);
      await artifactService.write(pipelineId, "progress.json", json);
    };

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

        // Phase 4 (ADR-033): Execution Contract enforcement (write side).
        // Three deterministic checks before any bytes hit disk: allowed_paths
        // glob match, randomness/external-call content scan, and (for
        // package.json) dependency-diff against contract.dependencies.allowed.
        if (executionContract) {
          const allowed = executionContractEnforcer.checkWriteAllowed(executionContract, relPath);
          if (!allowed.ok) {
            context.notify(`🚫 CONTRACT_VIOLATION: ${allowed.reason}`);
            return `CONTRACT_VIOLATION: ${allowed.reason}\n${allowed.detail ?? ""}`;
          }
          const determinism = executionContractEnforcer.checkContentDeterminism(executionContract, relPath, content);
          if (!determinism.ok) {
            context.notify(`🚫 CONTRACT_VIOLATION: ${determinism.reason}`);
            return `CONTRACT_VIOLATION: ${determinism.reason}\n${determinism.detail ?? ""}`;
          }
          if (/(^|\/)package\.json$/.test(relPath.replace(/\\/g, "/"))) {
            let beforeContent: string | null = null;
            try {
              beforeContent = await fs.readFile(safeAbs, "utf-8");
            } catch {
              beforeContent = null;
            }
            const depDiff = executionContractEnforcer.checkManifestDependencyDiff(
              executionContract,
              beforeContent,
              content
            );
            if (!depDiff.ok) {
              context.notify(`🚫 CONTRACT_VIOLATION: ${depDiff.reason}`);
              return `CONTRACT_VIOLATION: ${depDiff.reason}\n${depDiff.detail ?? ""}`;
            }
          }
        }

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

        // Phase 4 (ADR-033): Execution Contract enforcement (command side).
        // The agent may only invoke the canonical lint/typecheck/test commands
        // declared in the contract. Arbitrary shell strings are rejected as a
        // CONTRACT_VIOLATION so the gate set stays deterministic across runs.
        if (executionContract) {
          const allowed = executionContractEnforcer.checkCommandAllowed(executionContract, command);
          if (!allowed.ok) {
            context.notify(`🚫 CONTRACT_VIOLATION: ${allowed.reason}`);
            return `CONTRACT_VIOLATION: ${allowed.reason}\n${allowed.detail ?? ""}`;
          }
        }

        const timestamp = new Date().toISOString();

        // Resolve command working directory: use contract.commands.working_directory when
        // present (e.g. project has package.json in a subdirectory like "health-prototype").
        const commandCwd = executionContract?.commands?.working_directory
          ? path.join(clonePath, executionContract.commands.working_directory)
          : clonePath;

        // ─── Phase 9 (ADR-033): cross-run gate evidence reuse ──────────────
        // If the prior run recorded an exit_code=0 for this exact command and
        // none of the relevant files changed since, reuse the prior pass.
        const cached = await this.tryReuseGateResult(
          previousArtifacts,
          clonePath,
          command,
          sprintBranch ?? undefined
        );
        if (cached) {
          gateResults.push(cached);
          context.notify(`✅ Gate reused (cached from prior run): \`${command.slice(0, 60)}\``);
          return `exit_code=0\nstdout:\n${cached.stdout}\nstderr:\n${cached.stderr}`;
        }

        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: commandCwd,
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

      if (name === "set_progress") {
        const snapshot = {
          current_focus: String(args["current_focus"] ?? ""),
          open_todos: Array.isArray(args["open_todos"])
            ? (args["open_todos"] as unknown[]).map(String)
            : [],
          blockers: Array.isArray(args["blockers"])
            ? (args["blockers"] as unknown[]).map(String)
            : [],
          planned_next_action: String(args["planned_next_action"] ?? ""),
          recorded_at: new Date().toISOString(),
        };
        if (!snapshot.current_focus || !snapshot.planned_next_action) {
          return "Error: current_focus and planned_next_action are required";
        }
        lastProgress = snapshot;
        try {
          await persistProgress(snapshot);
          context.log("Implementer: set_progress recorded", {
            current_focus: snapshot.current_focus,
            todos: snapshot.open_todos.length,
            blockers: snapshot.blockers.length,
          });
          return "OK: progress recorded";
        } catch (err) {
          return `Error persisting progress: ${String(err)}`;
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
        // Respect execution contract success_criteria: if a criterion is false, a failing gate for
        // that command is not a blocker (e.g. typecheck_pass=false means pre-existing TS errors
        // outside scope do not prevent the task from completing).
        const isRequired = (command: string): boolean => {
          if (!executionContract?.success_criteria) return true;
          const sc = executionContract.success_criteria;
          const c = command.trim();
          if (c === executionContract.commands.lint.trim()) return sc.lint_pass;
          if (c === executionContract.commands.typecheck.trim()) return sc.typecheck_pass;
          if (c === executionContract.commands.test.trim()) return sc.all_tests_pass;
          return true;
        };
        const openFailures = latestResultPerCommand(gateResults).filter(
          (r) => r.exit_code !== 0 && isRequired(r.command)
        );
        if (openFailures.length > 0) {
          return (
            `Error: ${openFailures.length} gate(s) still failing. Fix all gate failures before calling finish.\n` +
            openFailures.map((g) => `  - \`${g.command}\` (exit ${g.exit_code})`).join("\n") +
            "\nFix the failing gates, then call finish."
          );
        }

        // Phase 4 (ADR-033): Execution Contract pre-finish gate.
        // When a contract is present, gates required by success_criteria must have passed.
        // Gates with success_criteria=false (e.g. typecheck_pass=false) are skipped — the
        // contract author declared they are not required for this task.
        if (executionContract) {
          const preFinish = executionContractEnforcer.checkPreFinishGates(
            executionContract,
            latestResultPerCommand(gateResults).map((r) => ({ command: r.command, exit_code: r.exit_code }))
          );
          if (!preFinish.ok) {
            context.notify(`🚫 CONTRACT_VIOLATION: ${preFinish.reason}`);
            return `CONTRACT_VIOLATION: ${preFinish.reason}\n${preFinish.detail ?? ""}`;
          }
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

    /**
     * Wraps toolExecutor to record a per-turn log entry after every tool call.
     * The log is persisted as turn_log.json when the loop ends abnormally.
     */
    const instrumentedToolExecutor = async (toolCall: ToolCall): Promise<string> => {
      const turn = ++turnCounter;
      const result = await toolExecutor(toolCall);
      turnLog.push({
        turn,
        tool: toolCall.name,
        args_summary: JSON.stringify(toolCall.arguments).slice(0, 200),
        result_summary: result.slice(0, 300),
        timestamp: new Date().toISOString(),
      });
      // Best-effort incremental write so the frontend can poll turn_log.json while the loop is live.
      try {
        const snapshot = JSON.stringify(
          { stop_reason: "in_progress", turn_count: turnLog.length, turns: turnLog },
          null,
          2
        );
        turnLogArtifactPath = await artifactService.write(pipelineId, "turn_log.json", snapshot);
      } catch { /* best effort — never mask primary result */ }
      return result;
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
        instrumentedToolExecutor,
        {
          maxIterations: 30,
          max_tokens: 8192,
          meta: { role: "implementer", pipeline_id: pipelineId, call_type: "agent-loop" },
        }
      );
    } catch (err) {
      if (String(err).includes("max iterations")) {
        maxIterationsExceeded = true;
        context.log("Implementer: max iterations reached; checkpointing work in progress", {
          written_files: writtenFiles.length,
          gate_results: gateResults.length,
        });
        context.notify("⚠️ Max iterations reached — checkpointing work-in-progress to branch");

        // Phase 4 (ADR-033): if the agent never called set_progress, synthesize a
        // minimal record so the next run still has structured continuity context.
        if (!lastProgress) {
          const failingGates = latestResultPerCommand(gateResults).filter((r) => r.exit_code !== 0);
          const synthetic = {
            current_focus: writtenFiles.length > 0
              ? `In-flight implementation; last edited ${writtenFiles[writtenFiles.length - 1].path}`
              : "Implementation in progress (no files written yet).",
            open_todos: failingGates.map((g) => `Fix failing gate: \`${g.command}\``),
            blockers: failingGates.length === 0 ? ["MAX_ITERATIONS reached without finish."] : [],
            planned_next_action: failingGates.length > 0
              ? `Resolve ${failingGates.length} failing gate(s) and re-run.`
              : "Continue implementation from current branch state and call finish.",
            recorded_at: new Date().toISOString(),
          };
          lastProgress = synthetic;
          try { await persistProgress(synthetic); } catch { /* best effort */ }
        }
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
    await this.writeTestResultsToRepo(
        pipelineId,
        resolvedTaskId,
        resolvedSprintId,
        gateResults,
        stopReason
      );
      context.log("Implementer: test_results.json written to artifact service", { stop_reason: stopReason });

    // Phase 5.3 / MAX_ITERATIONS: fail closed — checkpoint commit first so operator can review
    // failure state locally and subsequent runs continue from where this run stopped.
    if (maxIterationsExceeded || !finishPayload) {
      const failureReason = maxIterationsExceeded ? "MAX_ITERATIONS" : "FINISH_NOT_CALLED";
      if (project && sprintBranch) {
        await this.checkpointCommitOnFailure(project, sprintBranch, gateResults, writtenFiles, failureReason, context, resolvedTaskId, resolvedSprintId);
      }
      // Persist per-turn log so operator can inspect what each iteration attempted.
      // (turnLogArtifactPath already has the incremental path from instrumentedToolExecutor;
      // overwrite it now with the final stop_reason so the artifact reflects terminal state.)
      try {
        const turnLogJson = JSON.stringify(
          { stop_reason: failureReason, turn_count: turnLog.length, turns: turnLog },
          null,
          2
        );
        turnLogArtifactPath = await artifactService.write(pipelineId, "turn_log.json", turnLogJson);
        context.log("Implementer: turn_log.json written", {
          stop_reason: failureReason,
          turn_count: turnLog.length,
          last_tool: turnLog.at(-1)?.tool,
        });
      } catch { /* best effort — do not mask the primary error */ }
      if (maxIterationsExceeded) {
        throw new HttpError(
          422,
          "MAX_ITERATIONS",
          `Implementer agent loop exceeded maximum iterations (30) after ${turnLog.length} turn(s). ` +
            "Work has been checkpointed to the branch. " +
            "Rerun Implementer — the next run will load prior gate results and continue from where it left off.",
          { gate_results: gateResults, written_files: writtenFiles, turn_count: turnLog.length, turn_log_path: turnLogArtifactPath }
        );
      }
      throw new HttpError(
        422,
        "FINISH_NOT_CALLED",
        `Implementer agent loop terminated after ${turnLog.length} turn(s) without calling the finish tool. ` +
          "Work has been checkpointed to the branch. " +
          "Inspect the agent trace, resolve any gate failures, and rerun.",
        { gate_results: gateResults, written_files: writtenFiles, turn_count: turnLog.length, turn_log_path: turnLogArtifactPath }
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

    // Commit + push to sprint branch. PR creation is owned by Sprint Controller at sprint close-out.
    let commitSha: string | undefined;
    try {
      // Phase 5 (ADR-033): script-templated commit message. The script controls
      // the prefix, scope and file list deterministically; the LLM only supplies
      // a one-sentence summary. Subject capped at 72 chars per Conventional Commits.
      const prefix = `feat(${payload.task_id}): `;
      const summarySentence = payload.summary
        .split(/[\n\r]/)[0]
        .replace(/\s+/g, " ")
        .trim();
      const subject = (prefix + summarySentence).slice(0, 72);
      const fileLines = payload.files_changed
        .map((f) => `- ${f.action}: ${f.path}`)
        .join("\n");
      const filesSummary = `${payload.files_changed.length} file(s) changed`;
      const message = `${subject}\n\n${filesSummary}\n\n${fileLines}`;
      commitSha = await projectGitService.commitAll(project, sprintBranch, message);
      await projectGitService.push(project, sprintBranch);
      context.log("Implementer: committed", { commit_sha: commitSha, sprint_branch: sprintBranch });
      context.log("Implementer: pushed", { commit_sha: commitSha, sprint_branch: sprintBranch });
      context.notify(`💾 Committed ${payload.files_changed.length} file(s) to \`${sprintBranch}\` (${commitSha?.slice(0, 7)})`);
    } catch (err) {
      context.log("Implementer: git commit/push failed", {
        error: String(err),
        sprint_branch: sprintBranch,
      });
      throw new Error(`Implementer failed to commit and push: ${String(err)}`);
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

    // Finalize turn_log.json with stop_reason: "completed" so it's durable and retrievable from history.
    try {
      const finalTurnLog = JSON.stringify(
        { stop_reason: "completed", turn_count: turnLog.length, turns: turnLog },
        null,
        2
      );
      turnLogArtifactPath = await artifactService.write(pipelineId, "turn_log.json", finalTurnLog);
      context.log("Implementer: turn_log.json finalized", { turn_count: turnLog.length });
    } catch { /* best effort */ }

    context.log("Implementer complete", {
      task_id: payload.task_id,
      files_changed: payload.files_changed.length,
      commit_sha: commitSha,
      artifact_path: artifactPath,
      current_task_path: currentTaskPath,
      test_results_path: testResultsPath,
    });

    const successArtifactPaths: string[] = [artifactPath, currentTaskPath, testResultsPath];
    if (turnLogArtifactPath) successArtifactPaths.push(turnLogArtifactPath);

    return {
      ...payload,
      commit_sha: commitSha,
      artifact_path: artifactPath,
      current_task_path: currentTaskPath,
      test_results_path: testResultsPath,
      turn_log_path: turnLogArtifactPath,
      artifact_paths: successArtifactPaths,
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

    // Phase 6 (ADR-033): lifecycle state-machine guard. Only permit transitions
    // along the canonical happy-path; preserve prior status on any other input.
    //   active           → ready_for_verification
    //   in_progress      → ready_for_verification   (IMP-001 contract)
    //   ready_for_verification → verified | needs_fixes
    const ALLOWED_TRANSITIONS: Record<string, string[]> = {
      active: ["ready_for_verification"],
      in_progress: ["ready_for_verification"],
      ready_for_verification: ["verified", "needs_fixes"],
    };
    const proposedStatus = "ready_for_verification";
    const priorStatus = typeof base.status === "string" ? base.status : "active";
    const allowed = ALLOWED_TRANSITIONS[priorStatus] ?? [];
    const finalStatus = allowed.includes(proposedStatus) || priorStatus === proposedStatus
      ? proposedStatus
      : priorStatus;
    if (finalStatus !== proposedStatus) {
      // Log via console.warn so this surfaces in operator logs without requiring a
      // logger handle here (this method is intentionally synchronous/pure-ish).
      // eslint-disable-next-line no-console
      console.warn(
        `Implementer: invalid status transition '${priorStatus}' -> '${proposedStatus}'; preserving prior status.`
      );
    }

    return {
      ...base,
      task_id: finishPayload.task_id,
      // IMP-001 + Phase 6: terminal status is ready_for_verification when transition is valid;
      // otherwise prior status is preserved per the state-machine guard above.
      status: finalStatus,
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

  /**
   * ADR-035: Load the sprint plan artifact from staged_sprints/ in the repo.
   * The sprint plan is NOT stored in the artifact service — it lives in the project
   * repo under staged_sprints/ (Planner owns it). This is the only repo-based fallback
   * that is still valid after the artifact isolation change.
   */
  private async loadStagedSprintArtifact(clonePath: string): Promise<ArtifactContextFile | null> {
    try {
      // Sprint plans live in staged_sprints/ (not active/) — Planner owns sprint plan creation.
      const stagedSprintsDir = path.join(clonePath, "project_work", "ai_project_tasks", "staged_sprints");
      const entries = await fs.readdir(stagedSprintsDir, { withFileTypes: true });
      const sprintPlanEntry = entries.find((entry) => entry.isFile() && /^sprint_plan_.*\.md$/i.test(entry.name));
      if (sprintPlanEntry) {
        const filePath = path.join(stagedSprintsDir, sprintPlanEntry.name);
        const content = await fs.readFile(filePath, "utf-8");
        return { path: filePath, content };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Load prior-run context from test_results.json in the pipeline artifact service.
   * Injects a "Prior Run Context" section into the user prompt so subsequent runs skip
   * already-passing gates and continue from where the prior run left off rather than
   * re-reading the brief and starting from scratch.
   *
   * Falls back to the stable checkpoint file (written outside the git repo by
   * checkpointCommitOnFailure) when the artifact is absent — this recovers prior
   * context even when the artifact write failed. No active/ fallback — after ADR-035,
   * test_results.json is never written to active/.
   */
  private async loadPriorRunContext(
    previousArtifacts: string[],
    projectId?: string,
    sprintBranch?: string
  ): Promise<string | null> {
    // ADR-035: Read test_results.json from pipeline artifact service (primary).
    const artifactResult = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("test_results"))
    );

    let raw: string | null = artifactResult?.content ?? null;

    // Fall back to stable checkpoint file (outside git repo) as secondary.
    if (!raw && projectId && sprintBranch) {
      try {
        raw = await fs.readFile(this.stableCheckpointPath(projectId, sprintBranch), "utf-8");
      } catch {
        // not found — no prior context
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
   * Phase 9 (ADR-033): cross-run gate evidence reuse. Checks whether the prior
   * run's `test_results.json` recorded a successful run of the same command and
   * whether any files matching the command's pattern have changed since. If
   * both conditions hold, returns a cached GateResult; otherwise null.
   * ADR-035: reads test_results from pipeline artifact service, not active/ directory.
   */
  private async tryReuseGateResult(
    previousArtifacts: string[],
    clonePath: string,
    command: string,
    sprintBranch?: string
  ): Promise<GateResult | null> {
    const testResult = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("test_results"))
    );
    if (!testResult) return null;
    let priorGates: GateResult[] = [];
    try {
      const parsed = JSON.parse(testResult.content) as { gate_results?: GateResult[] };
      priorGates = parsed.gate_results ?? [];
    } catch {
      return null;
    }
    if (priorGates.length === 0) return null;

    // Find the most recent successful prior run of this exact command.
    const priorPass = [...priorGates]
      .reverse()
      .find((g) => g.command === command && g.exit_code === 0);
    if (!priorPass) return null;

    // Default file pattern map per ADR-033 plan.
    const COMMAND_PATTERNS: { match: RegExp; relevant: RegExp[] }[] = [
      { match: /^npm\s+test\b/, relevant: [/__tests__\//, /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/] },
      { match: /^npx\s+tsc\b/, relevant: [/\.ts$/, /\.tsx$/, /tsconfig.*\.json$/] },
      { match: /^npm\s+run\s+lint\b/, relevant: [/\.[jt]sx?$/, /\.eslintrc/] },
    ];
    const patterns = COMMAND_PATTERNS.find((p) => p.match.test(command))?.relevant;

    if (!sprintBranch) return null;
    const changed = await this.computeChangedFiles(clonePath, sprintBranch);
    if (!changed) return null;

    // If we don't know what files matter for this command, be conservative and re-run.
    if (!patterns) return null;
    const anyRelevantChange = changed.some((c) =>
      patterns.some((re) => re.test(c.path))
    );
    if (anyRelevantChange) return null;

    return {
      command,
      exit_code: 0,
      stdout: "(cached from prior run)",
      stderr: "",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Phase 3 (ADR-033): load `progress.json` artifact written by the `set_progress`
   * tool on the previous run. Returns a markdown block describing current focus,
   * open todos, blockers and the planned next action — or null if the file is
   * absent / unparseable.
   * ADR-035: reads from pipeline artifact service, not active/ directory.
   */
  private async loadProgressArtifact(previousArtifacts: string[]): Promise<string | null> {
    const result = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("progress"))
    );
    if (!result) return null;
    try {
      const p = JSON.parse(result.content) as {
        current_focus?: string;
        open_todos?: string[];
        blockers?: string[];
        planned_next_action?: string;
        recorded_at?: string;
      };
      const lines: string[] = [];
      if (p.recorded_at) lines.push(`> Recorded at: ${p.recorded_at}`);
      if (p.current_focus) lines.push("", `**Current focus:** ${p.current_focus}`);
      if (p.planned_next_action) lines.push(`**Planned next action:** ${p.planned_next_action}`);
      if (p.open_todos && p.open_todos.length > 0) {
        lines.push("", "**Open todos:**");
        for (const t of p.open_todos) lines.push(`- ${t}`);
      }
      if (p.blockers && p.blockers.length > 0) {
        lines.push("", "**Blockers:**");
        for (const b of p.blockers) lines.push(`- ${b}`);
      }
      return lines.length > 0 ? lines.join("\n") : null;
    } catch {
      return null;
    }
  }

  /**
   * Phase 3 (ADR-033): if the prior verifier run produced a FAIL with
   * `required_corrections[]`, surface those as a numbered directive list so the
   * implementer addresses them in priority order. Returns null on PASS or absent.
   * ADR-035: reads from pipeline artifact service, not active/ directory.
   */
  private async extractCorrections(previousArtifacts: string[]): Promise<string | null> {
    const result = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("verification_result"))
    );
    if (!result) return null;
    try {
      const v = JSON.parse(result.content) as {
        result?: string;
        required_corrections?: string[];
      };
      if (v.result !== "FAIL") return null;
      const items = v.required_corrections ?? [];
      if (items.length === 0) return null;
      return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
    } catch {
      return null;
    }
  }

  /**
   * Phase 3 (ADR-033): list files changed on the sprint branch since it diverged
   * from the default branch. Used as a fact-list (not a raw diff) so the LLM
   * knows what's already been touched without spending tokens on the patch.
   */
  private async computeChangedFiles(
    clonePath: string,
    sprintBranch: string
  ): Promise<{ path: string; status: "A" | "M" | "D" }[] | null> {
    try {
      // Determine the default branch the sprint branch was cut from.
      let defaultBranch = "master";
      try {
        const { stdout } = await execAsync(
          "git symbolic-ref --short refs/remotes/origin/HEAD",
          { cwd: clonePath, timeout: 5000 }
        );
        const head = stdout.trim().replace(/^origin\//, "");
        if (head) defaultBranch = head;
      } catch {
        // fall back to master/main
        try {
          await execAsync("git rev-parse --verify origin/main", { cwd: clonePath, timeout: 5000 });
          defaultBranch = "main";
        } catch { /* keep master */ }
      }

      const mergeBaseRef = `origin/${defaultBranch}`;
      const { stdout } = await execAsync(
        `git diff --name-status ${mergeBaseRef}...${sprintBranch}`,
        { cwd: clonePath, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }
      );
      const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      const out: { path: string; status: "A" | "M" | "D" }[] = [];
      for (const line of lines) {
        const m = /^([AMD])\s+(.+)$/.exec(line);
        if (!m) continue;
        out.push({ path: m[2], status: m[1] as "A" | "M" | "D" });
      }
      return out;
    } catch {
      return null;
    }
  }

  /**
   * Persist accumulated gate results to the pipeline artifact service (ADR-035).
   * Returns the artifact path for inclusion in artifact_paths.
   */
  private async writeTestResultsToRepo(
    pipelineId: string,
    taskId: string,
    sprintId: string,
    gateResults: GateResult[],
    stopReason: string
  ): Promise<void> {
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
    await artifactService.write(pipelineId, "test_results.json", JSON.stringify(payload, null, 2));
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

