import fs from "fs/promises";
import path from "path";
import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { prRemediationService } from "../services/pr-remediation.service";
import { githubApiService } from "../services/github-api.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";
import { buildProjectPreamble } from "../utils/prompt-preamble";
import type { RichSprintLlmResponse, TaskSpecification } from "../domain/sprint-plan.types";
import type { ExecutionContract } from "../domain/execution-contract.types";

export interface SprintControllerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
  /**
   * Phase 7 (SCT-006, ORCH-001): Operator-supplied close-out phase token. Absent or "task_close"
   * triggers Phase 1 (task close on verifier PASS). "pr_confirmed" triggers Phase 2 (record PR
   * merge). "stage_next" triggers Phase 3 (stage next task — requires Phases 1 and 2 complete).
   * The system never auto-advances between phases; every phase transition requires an explicit token.
   */
  close_out_phase?: "task_close" | "pr_confirmed" | "stage_next";
}

/**
 * Task flags emitted into the implementation brief — matches AI_TASK_FLAGS_CONTRACT.md
 */
export interface TaskFlags {
  fr_ids_in_scope: string[];
  architecture_contract_change: boolean;
  ui_evidence_required: boolean;
  incident_tier: "none" | "p0" | "p1" | "p2" | "p3";
  schema_change?: boolean;
  migration_change?: boolean;
  cross_subsystem_change?: boolean;
}

/**
 * Canonical task shape — matches ai-project_template/ai_dev_stack/ai_guidance/task.schema.json
 */
export interface SprintTask {
  task_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  estimated_effort: "S" | "M" | "L";
  files_likely_affected: string[];
  status: "pending";
}

/**
 * Sprint plan — matches sprint_plan.schema.json (tasks field is array of task_id strings)
 */
export interface SprintPlan {
  sprint_id: string;
  phase_id: string;
  name: string;
  goals: string[];
  tasks: string[];
  status: "staged";
  /** Phase 5.3 (SCT-005, GTR-003, RUL-008): execution lane; "fast-track" triggers prerequisite enforcement. */
  execution_mode?: "normal" | "fast-track";
  /** Required when execution_mode is fast-track. */
  fast_track_lane?: string;
  fast_track_rationale?: string;
  fast_track_intake_id?: string;
}

/** Setup-mode output: emitted when a new sprint task package is staged. */
export interface SprintControllerSetupOutput {
  mode: "setup";
  sprint_id: string;
  phase_id: string;
  sprint_plan_path: string;
  brief_path: string;
  current_task_path: string;
  /** 6.1 (SCT sprint_state): artifact-service path for sprint_state.json written at staging. Empty when no project is configured. */
  sprint_state_path: string;
  task_flags: TaskFlags;
  first_task: SprintTask;
  sprint_branch?: string;
  pr_number?: number;
  pr_url?: string;
  artifact_paths: string[];
}

/** Close-out-mode output: emitted after completing Phase 1 or Phase 2 of the close-out protocol. */
export interface SprintControllerCloseOutOutput {
  mode: "close_out";
  sprint_id: string;
  phase_id: "closeout";
  last_completed_task_id: string;
  /** 6.3 (SCT close-out): formal output path for sprint_closeout.json; always non-empty on success. */
  closeout_path: string;
  /** Phase 7 (SCT-006): the close-out protocol phase that was just completed. */
  close_out_phase_completed: "task_close" | "pr_confirmed";
  /** Phase 7 (SCT-006): always true — operator must supply a close_out_phase token to advance. */
  stop_required: true;
  sprint_branch?: string;
  sprint_complete_artifacts: string[];
  artifact_paths: string[];
}

/** Discriminated union covering both operating modes. Narrow on `mode` before reading mode-specific fields. */
export type SprintControllerOutput = SprintControllerSetupOutput | SprintControllerCloseOutOutput;

const SPRINT_READY_PHASE_STATUSES = new Set(["Planning", "Approved"]);
/**
 * Phase 9.1 (SCT-A, PTH-001): Statuses that indicate a task is still in-flight.
 * Includes ready_for_verification so a task awaiting verifier PASS also blocks staging.
 */
const OPEN_TASK_STATUSES = new Set(["pending", "in_progress", "active", "open", "ready_for_verification"]);

/** Phase 5.1 (TFC-001): Valid incident_tier values. */
const VALID_INCIDENT_TIERS = new Set<string>(["none", "p0", "p1", "p2", "p3"]);

/**
 * Phase 5.1 (TFC-001): Validates all four required task flags are present and non-null.
 * Called before brief emission; throws MISSING_TASK_FLAGS on any violation.
 * Sprint-controller is the sole authority for task flags (TFC-003).
 */
function validateRequiredTaskFlags(flags: TaskFlags): void {
  const missing: string[] = [];
  if (!Array.isArray(flags.fr_ids_in_scope)) missing.push("fr_ids_in_scope");
  if (typeof flags.architecture_contract_change !== "boolean") missing.push("architecture_contract_change");
  if (typeof flags.ui_evidence_required !== "boolean") missing.push("ui_evidence_required");
  if (!flags.incident_tier || !VALID_INCIDENT_TIERS.has(flags.incident_tier)) missing.push("incident_tier");
  if (missing.length > 0) {
    throw new HttpError(
      422,
      "MISSING_TASK_FLAGS",
      `Sprint staging is blocked: the following required task flags are missing or null: ${missing.join(", ")}. ` +
        `All four required flags must be present in every implementation brief (AI_TASK_FLAGS_CONTRACT.md TFC-001).`,
      { missing_flags: missing }
    );
  }
}

interface TaskFlagsLlmResponse {
  task_flags: TaskFlags;
}

interface CanonicalIds {
  sprintId: string;
  taskId: string;
}

interface ActiveTaskPackage {
  sprintPlanName: string;
  sprintPlanContent: string;
  briefContent: string;
  currentTaskContent: string;
  sprintPlan: SprintPlan;
  firstTask: SprintTask;
  taskFlags: TaskFlags;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildTaskFeatureBranch(taskId: string): string {
  return `feature/${taskId}`;
}

export class SprintControllerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.sprint-controller",
    version: "2026.04.19",
    description: "Converts a phase plan into a sprint plan + AI_IMPLEMENTATION_BRIEF.md + current_task.json.",
    input_schema: {
      type: "object",
      properties: {
        previous_artifacts: { type: "array" },
        pipeline_id: { type: "string" },
      },
      additionalProperties: true,
    },
    output_schema: {
      oneOf: [
        {
          title: "setup",
          type: "object",
          properties: { mode: { const: "setup" } },
          required: ["mode", "sprint_id", "sprint_plan_path", "brief_path", "current_task_path", "sprint_state_path", "task_flags", "first_task", "artifact_paths"],
        },
        {
          title: "close_out",
          type: "object",
          properties: { mode: { const: "close_out" } },
          required: ["mode", "sprint_id", "last_completed_task_id", "closeout_path", "close_out_phase_completed", "stop_required", "sprint_complete_artifacts", "artifact_paths"],
        },
      ],
    },
    tags: ["role", "sprint-controller", "planning"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<SprintControllerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    const previousArtifacts = typed.previous_artifacts ?? [];
    const closeOutPhase = typed.close_out_phase;

    context.log("Sprint Controller running", { pipeline_id: pipelineId, close_out_phase: closeOutPhase ?? "none" });

    // Phase 7.1/7.2: Explicit operator tokens are the only path to Phase 2 and Phase 3.
    // No implicit transition from PASS detection to next-task staging is permitted.
    if (closeOutPhase === "stage_next") {
      return this.runCloseOutPhase3(pipelineId, previousArtifacts, context);
    }
    if (closeOutPhase === "pr_confirmed") {
      return this.runCloseOutPhase2(pipelineId, previousArtifacts, context);
    }

    // Phase 1 close-out: triggered by verifier PASS (no explicit phase token needed).
    const verificationArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("verification_result.json"))
    );
    if (verificationArtifact) {
      return this.runCloseOut(pipelineId, previousArtifacts, verificationArtifact.content, context);
    }

    return this.runSetup(pipelineId, previousArtifacts, context);
  }

  private async runSetup(
    pipelineId: string,
    previousArtifacts: string[],
    context: ScriptExecutionContext
  ): Promise<SprintControllerSetupOutput> {
    context.notify("🗂️ Loading staged sprint plan and staging task package...");

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "sprint-controller", "plan", "sprint-controller");
    context.notify(
      `📚 Design inputs validated (${designInputs.sample_files.length} found). ` +
      `Using project: \`${designInputs.project_name}\``
    );

    // If a task package is already open in this pipeline's artifact namespace, reuse it.
    const activeTaskPackage = await this.loadOpenActiveTaskPackage(pipelineId, previousArtifacts, designInputs.clone_path);
    if (activeTaskPackage) {
      context.notify(
        `♻️ Task ${activeTaskPackage.firstTask.task_id} in ${activeTaskPackage.sprintPlan.sprint_id} is still open. ` +
        `Finish the pending task and pass its close-out gate before requesting another task package.`
      );
      return this.publishExistingTaskPackage(pipelineId, activeTaskPackage, context);
    }

    // Load staged sprint plan — Planner owns sprint plan creation and commits to staged_sprints/.
    const stagedSprint = await this.findStagedSprintPlan(designInputs.clone_path);
    if (!stagedSprint) {
      throw new HttpError(
        409,
        "NO_STAGED_SPRINT_PLAN",
        "Sprint Controller requires a staged sprint plan in project_work/ai_project_tasks/staged_sprints/. " +
          "Run the Planner to generate and stage a sprint plan before invoking Sprint Controller.",
        { staged_sprints_path: "project_work/ai_project_tasks/staged_sprints/" }
      );
    }

    context.notify(
      `📋 Sprint plan loaded: \`${stagedSprint.sprintPlan.sprint_id}\` — ` +
      `task ${stagedSprint.firstTask.task_id}: ${stagedSprint.firstTask.title}`
    );


    // Load phase plan for gate checks — always read directly from the repo's staged_phases/.
    // ADR-001: Git is the authoritative source of truth for planning artifacts. The pipeline
    // artifact store holds a Draft copy written by the Planner; human promotion (Draft -> Planning)
    // happens in the repo file. Reading previousArtifacts here would always see Draft and block
    // staging even after operator approval.
    let phasePlanArtifact: { path: string; content: string } | null = null;
    {
      const stagedPhasesDir = path.join(
        designInputs.clone_path,
        "project_work",
        "ai_project_tasks",
        "staged_phases"
      );
      try {
        const entries = await fs.readdir(stagedPhasesDir, { withFileTypes: true });
        const planFiles = entries
          .filter((e) => e.isFile() && /^phase_plan_.*\.md$/i.test(e.name))
          .map((e) => path.join(stagedPhasesDir, e.name));
        if (planFiles.length > 0) {
          const withMtime = await Promise.all(
            planFiles.map(async (fp) => ({ fp, mtime: (await fs.stat(fp)).mtimeMs }))
          );
          withMtime.sort((a, b) => b.mtime - a.mtime);
          const content = await fs.readFile(withMtime[0].fp, "utf-8");
          phasePlanArtifact = { path: withMtime[0].fp, content };
          context.notify(`📄 Phase plan loaded from repo: \`${path.basename(withMtime[0].fp)}\``);
        }
      } catch {
        context.log("Sprint Controller: no staged_phases dir found, continuing without phase plan");
      }
    }

    // Gate: phase must be approved for sprint staging (process_invariants §Phase Lifecycle Gates)
    if (phasePlanArtifact) {
      const statusMatch = /^\*\*Status:\*\*\s+(.+)$/m.exec(phasePlanArtifact.content);
      const phaseStatus = statusMatch?.[1]?.trim();
      if (phaseStatus && !SPRINT_READY_PHASE_STATUSES.has(phaseStatus)) {
        throw new HttpError(
          409,
          "PHASE_NOT_IN_PLANNING",
          `Sprint staging requires the phase plan to be in 'Planning' or 'Approved' status, but found '${phaseStatus}'. ` +
            `Approve the phase plan before staging Sprint 1 (process_invariants §Phase Lifecycle Gates).`,
          { phase_status: phaseStatus }
        );
      }
      // Gate: all required TDNs must be Approved before sprint staging (AI_RULES.md Design Artifact Rules)
      const blockingTdns = this.extractBlockingTdns(phasePlanArtifact.content);
      if (blockingTdns.length > 0) {
        throw new HttpError(
          422,
          "NO_APPROVED_TDNS",
          `Sprint staging is blocked: the phase plan lists ${blockingTdns.length} required TDN(s) that are not Status: Approved. ` +
            `Human approval of all required TDNs is required before staging Sprint 1 (AI_RULES.md Design Artifact Rules).`,
          { blocking_tdns: blockingTdns }
        );
      }
    }

    // LLM call for task_flags only — Sprint Controller owns gate artifacts (not sprint plan creation).
    // Phase 3 (deterministic staging): if the staged plan is rich and includes a task_specifications
    // entry for the staged task, skip the LLM call and use those flags + execution_contract directly.
    const richSpec: TaskSpecification | undefined = stagedSprint.rich?.task_specifications.find(
      (s) => s.task_id === stagedSprint.firstTask.task_id
    );

    let taskFlagsValue: TaskFlags;
    if (richSpec) {
      taskFlagsValue = richSpec.task_flags;
      context.log("Sprint Controller: deterministic staging path (rich plan, no LLM task_flags call)", {
        task_id: stagedSprint.firstTask.task_id,
      });
    } else {
      const userContent = [
        `Sprint plan:\n\n${stagedSprint.sprintPlanContent}`,
        phasePlanArtifact ? `\nPhase plan:\n\n${phasePlanArtifact.content}` : "",
        `\nGenerate task flags for task ${stagedSprint.firstTask.task_id}.`,
      ].join("");

      const _preambleRun = await pipelineService.get(pipelineId);
      const _preambleProject = _preambleRun.project_id ? await projectService.getById(_preambleRun.project_id) : null;
      const systemPrompt = buildProjectPreamble(_preambleProject) + await governanceService.getComposedPrompt("sprint-controller");
      const provider = await llmFactory.forRole("sprint-controller");
      const llm = await provider.chatJson<TaskFlagsLlmResponse>(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        { meta: { role: "sprint-controller", pipeline_id: pipelineId, call_type: "task-flags" } }
      );

      // Phase 5.1 (TFC-001): Validate required task flags before brief emission.
      validateRequiredTaskFlags(llm.task_flags);
      taskFlagsValue = llm.task_flags;
    }

    // Phase 5.3 (SCT-005, GTR-003, RUL-008): Parse execution mode and enforce fast-track prerequisites.
    const isFastTrack = stagedSprint.sprintPlan.execution_mode === "fast-track";
    if (isFastTrack) {
      await this.enforceFastTrackPrerequisites(designInputs.clone_path, stagedSprint.sprintPlan);
    }

    // UX gate: user_flow.md must be Approved before staging any user-facing sprint (AI_RULES.md UX Artifact Rules)
    if (taskFlagsValue?.ui_evidence_required === true) {
      const uxFlowPath = path.join(
        designInputs.clone_path,
        "project_work", "ai_project_tasks", "active", "ux", "user_flow.md"
      );
      let uxFlowContent: string | null = null;
      try {
        uxFlowContent = await fs.readFile(uxFlowPath, "utf-8");
      } catch {
        // file not found
      }
      if (!uxFlowContent || !uxFlowContent.includes("Status: Approved")) {
        throw new HttpError(
          422,
          "UX_GATE_NOT_SATISFIED",
          `Sprint staging is blocked: task has ui_evidence_required=true but user_flow.md is ` +
            `${uxFlowContent ? "not Status: Approved" : "missing"}. ` +
            `Create and approve user_flow.md at project_work/ai_project_tasks/active/ux/user_flow.md ` +
            `before staging Sprint 1 (AI_RULES.md UX Artifact Rules).`,
          { path: uxFlowPath, found: uxFlowContent !== null }
        );
      }
    }

    context.notify(
      `🎯 Staging task: *${stagedSprint.firstTask.task_id}* — ${stagedSprint.firstTask.title}\n` +
      `> Effort: ${stagedSprint.firstTask.estimated_effort} | ${stagedSprint.firstTask.files_likely_affected.length} file(s) likely affected`
    );

    // Validate execution contract paths against the actual repo on disk.
    // Catches mismatches early (e.g. Planner wrote "tailwind.config.js" but repo has
    // "health-prototype/tailwind.config.ts") so the Implementer doesn't waste turns.
    if (richSpec?.execution_contract) {
      await this.validateContractPaths(
        richSpec.execution_contract,
        designInputs.clone_path,
        context
      );
    }

    // Write AI_IMPLEMENTATION_BRIEF.md — the Implementer's source of truth.
    // Phase 5.4 (SCT-005): isFastTrack controls Fast Track Controls block injection.
    // Phase 3 (deterministic staging): when richSpec is present, brief gains Section 0
    // (Execution Contract JSON) plus filtered Data Contracts / Invariants / Test Matrix.
    const briefContent = this.formatBrief(
      stagedSprint.firstTask,
      taskFlagsValue,
      stagedSprint.sprintPlan,
      isFastTrack,
      richSpec && stagedSprint.rich
        ? { spec: richSpec, plan: stagedSprint.rich }
        : undefined
    );
    const briefPath = await artifactService.write(pipelineId, "AI_IMPLEMENTATION_BRIEF.md", briefContent);

    // Write current_task.json — required by Verifier and Fixer.
    // ADR-035: brief_path references the pipeline-scoped artifact service path.
    const currentTask = {
      task_id: stagedSprint.firstTask.task_id,
      title: stagedSprint.firstTask.title,
      description: stagedSprint.firstTask.description,
      assigned_to: "implementer",
      status: "pending",
      brief_path: briefPath,
      artifacts: [],
    };
    const currentTaskPath = await artifactService.write(
      pipelineId,
      "current_task.json",
      JSON.stringify(currentTask, null, 2)
    );

    // Write sprint plan to artifacts bus for downstream consumers (e.g. runCloseOut sprint_id extraction).
    const sprintPlanPath = await artifactService.write(
      pipelineId,
      stagedSprint.sprintPlanName,
      stagedSprint.sprintPlanContent
    );

    const run = await pipelineService.get(pipelineId);
    const project = run.project_id
      ? await projectService.getById(run.project_id)
      : await projectService.getByName("default");

    let sprintBranch: string | undefined;
    let prNumber: number | undefined;
    let prUrl: string | undefined;
    let sprintStatePath = "";
    if (project) {
      sprintBranch = buildTaskFeatureBranch(stagedSprint.firstTask.task_id);
      await projectGitService.ensureReady(project);
      await projectGitService.createBranch(project, sprintBranch);
      await pipelineService.setSprintBranch(pipelineId, sprintBranch);
      context.notify(`🌿 Branch \`${sprintBranch}\` created and ready`);

      const repoBase = path.isAbsolute(project.clone_path)
        ? project.clone_path
        : path.join(process.cwd(), project.clone_path);

      // 6.1 (SCT sprint_state): Write sprint_state.json — documents active_task_id for downstream consumers.
      const sprintStateDir = path.join(repoBase, "project_work", "ai_state");
      await fs.mkdir(sprintStateDir, { recursive: true });
      const sprintStateContent = JSON.stringify(
        {
          sprint_id: stagedSprint.sprintPlan.sprint_id,
          active_task_id: stagedSprint.firstTask.task_id,
          completed_tasks: [],
        },
        null,
        2
      );
      await fs.writeFile(path.join(sprintStateDir, "sprint_state.json"), sprintStateContent, "utf-8");
      sprintStatePath = await artifactService.write(pipelineId, "sprint_state.json", sprintStateContent);

      // ADR-035: Write a pointer-only sprint_state.json to active/ for human legibility.
      // This file is informational only — it is NOT read by any script as a source of task content.
      const activeDir = path.join("project_work", "ai_project_tasks", "active");
      await fs.mkdir(path.join(repoBase, activeDir), { recursive: true });
      const activePointer = JSON.stringify(
        {
          pipeline_id: pipelineId,
          sprint_id: stagedSprint.sprintPlan.sprint_id,
          task_id: stagedSprint.firstTask.task_id,
          artifact_path: `artifacts/${pipelineId}/`,
          started_at: new Date().toISOString(),
        },
        null,
        2
      );
      await fs.writeFile(path.join(repoBase, activeDir, "sprint_state.json"), activePointer, "utf-8");

      await projectGitService.commitAll(
        project,
        sprintBranch,
        `chore(${stagedSprint.firstTask.task_id}): stage task package`
      );
      await projectGitService.push(project, sprintBranch);

      const prResult = await prRemediationService.createPullRequestWithRecovery(project, {
        title: `[${stagedSprint.sprintPlan.sprint_id}] ${stagedSprint.firstTask.task_id} implementation`,
        body: [
          "## Sprint Implementation",
          `Sprint: ${stagedSprint.sprintPlan.sprint_id}`,
          `Phase: ${stagedSprint.sprintPlan.phase_id}`,
          `Branch: ${sprintBranch}`,
          "",
          `Task: **${stagedSprint.firstTask.task_id}** — ${stagedSprint.firstTask.title}`,
          "",
          `Artifacts: \`artifacts/${pipelineId}/\``,
        ].join("\n"),
        head: sprintBranch,
        base: project.default_branch,
      });
      const pr = prResult.pr;
      prNumber = pr.number;
      prUrl = pr.html_url;
      await pipelineService.setPrDetails(pipelineId, pr.number, pr.html_url, sprintBranch);
      if (prResult.remediation_performed) {
        context.notify("🛠️ PR create was auto-remediated after a 404 and retried once.");
      }
      context.notify(`📋 Task package committed and opened as PR #${pr.number}: <${pr.html_url}|View Pull Request>`);
    }

    context.log("Sprint Controller setup complete", {
      sprint_id: stagedSprint.sprintPlan.sprint_id,
      first_task: stagedSprint.firstTask.task_id,
      brief_path: briefPath,
      sprint_branch: sprintBranch,
    });

    return {
      mode: "setup",
      sprint_id: stagedSprint.sprintPlan.sprint_id,
      phase_id: stagedSprint.sprintPlan.phase_id,
      sprint_plan_path: sprintPlanPath,
      brief_path: briefPath,
      current_task_path: currentTaskPath,
      sprint_state_path: sprintStatePath,
      task_flags: taskFlagsValue,
      first_task: stagedSprint.firstTask,
      sprint_branch: sprintBranch,
      pr_number: prNumber,
      pr_url: prUrl,
      artifact_paths: [sprintPlanPath, briefPath, currentTaskPath, ...(sprintStatePath ? [sprintStatePath] : [])],
    };
  }

  private async runCloseOut(
    pipelineId: string,
    previousArtifacts: string[],
    verificationJson: string,
    context: ScriptExecutionContext
  ): Promise<SprintControllerCloseOutOutput> {
    const verification = JSON.parse(verificationJson) as { result?: string; summary?: string; task_id?: string };
    if (verification.result !== "PASS") {
      throw new Error("Sprint Controller close-out called before verifier PASS");
    }
    context.notify("🏁 Verification passed — closing out task and preparing sprint-complete artifacts for Planner...");

    const run = await pipelineService.get(pipelineId);

    const currentTaskArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task.json"))
    );

    if (!currentTaskArtifact?.content) {
      throw new HttpError(
        409,
        "MISSING_TASK_CONTEXT",
        "Sprint Controller close-out requires current_task.json from the active task package.",
      );
    }

    const implementationArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("implementation_summary"))
    );
    if (!implementationArtifact?.path) {
      throw new HttpError(
        409,
        "MISSING_IMPLEMENTATION_ARTIFACT",
        "Sprint Controller close-out requires implementation_summary.md from Implementer before task closure.",
      );
    }

    const sprintPlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_plan_"))
    );

    let currentTaskId: string | undefined;
    try {
      const parsed = JSON.parse(currentTaskArtifact.content) as { task_id?: string };
      currentTaskId = parsed.task_id;
    } catch {
      throw new HttpError(409, "INVALID_TASK_CONTEXT", "current_task.json is not valid JSON.");
    }

    if (!currentTaskId || !verification.task_id || verification.task_id !== currentTaskId) {
      context.notify(
        `❗ Cannot close task: verifier reported ${verification.task_id ?? "n/a"} but active task is ${currentTaskId ?? "n/a"}. ` +
        "Complete verification for the active task before requesting sprint close-out."
      );
      context.log("Sprint Controller close-out blocked: verification task mismatch", {
        pipeline_id: pipelineId,
        verification_task_id: verification.task_id,
        current_task_id: currentTaskId,
      });
      throw new HttpError(
        409,
        "VERIFICATION_TASK_MISMATCH",
        "Verifier PASS does not match the active task context; Sprint Controller will not close the task.",
        { verification_task_id: verification.task_id, current_task_id: currentTaskId }
      );
    }

    const sprintCompleteArtifacts = [
      sprintPlanArtifact?.path,
      currentTaskArtifact?.path,
      ...previousArtifacts.filter(
        (p) =>
          p.includes("AI_IMPLEMENTATION_BRIEF") ||
          p.includes("verification_result.json") ||
          p.includes("verification_result.md")
      ),
    ].filter((p): p is string => Boolean(p));

    // Phase 7 (SCT-006): resolve sprint_id once so it can be written to both the artifact and the return.
    const sprintId = this.extractSprintId(sprintPlanArtifact?.path, pipelineId);
    const taskIdForCloseout = currentTaskId as string;

    // Phase 1: Sprint Controller owns the PR. Create (or find existing) PR for operator to merge.
    let prNumber: number | undefined;
    let prUrl: string | undefined;
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (project && run.sprint_branch) {
      try {
        const existingPr = await githubApiService.findOpenPullRequestByHead({
          repoUrl: project.repo_url,
          head: run.sprint_branch,
          base: project.default_branch,
        });
        const pr = existingPr ?? (await prRemediationService.createPullRequestWithRecovery(project, {
          title: `[${sprintId}] ${taskIdForCloseout} implementation`,
          body: [
            "## Sprint Implementation",
            `Sprint: ${sprintId}`,
            `Task: ${taskIdForCloseout}`,
            `Branch: \`${run.sprint_branch}\``,
            "",
            "Review and merge this PR to complete sprint close-out.",
            "",
            `**Verifier summary:** ${verification.summary ?? ""}`,
          ].join("\n"),
          head: run.sprint_branch,
          base: project.default_branch,
        })).pr;
        prNumber = pr.number;
        prUrl = pr.html_url;
        await pipelineService.setPrDetails(pipelineId, pr.number, pr.html_url, run.sprint_branch);
        context.notify(`🔗 PR #${pr.number} ready for review: <${pr.html_url}|View Pull Request>`);
      } catch (err) {
        context.log("Sprint Controller: PR create/find failed (non-fatal)", { error: String(err) });
        context.notify(
          `⚠️ Could not create PR automatically: ${String(err)}. ` +
          `Please create a PR from \`${run.sprint_branch}\` → \`${project.default_branch}\` manually.`
        );
      }
    }

    const closeOutPath = await artifactService.write(
      pipelineId,
      "sprint_closeout.json",
      JSON.stringify(
        {
          pipeline_id: pipelineId,
          sprint_id: sprintId,
          sprint_branch: run.sprint_branch,
          last_completed_task_id: taskIdForCloseout,
          closeout_role: "sprint-controller",
          closeout_scope: "task",
          gate_result: "PASS",
          // Phase 7 (SCT-006): tracks which close-out protocol phase was last completed.
          close_out_phase_completed: "task_close",
          verifier_summary: verification.summary ?? "",
          sprint_complete_artifacts: sprintCompleteArtifacts,
          pr_number: prNumber,
          pr_url: prUrl,
        },
        null,
        2
      )
    );

    const prNotify = prUrl
      ? `Merge PR <${prUrl}|#${prNumber}> then re-invoke with close_out_phase: 'pr_confirmed'.`
      : `Merge the sprint PR from \`${run.sprint_branch ?? "sprint-branch"}\` → main, then re-invoke with close_out_phase: 'pr_confirmed'.`;
    context.notify(`🛑 Phase 1 complete. Task ${taskIdForCloseout} closed. ` + prNotify);
    context.log("Sprint Controller close-out Phase 1 complete", {
      pipeline_id: pipelineId,
      sprint_branch: run.sprint_branch,
      last_completed_task_id: taskIdForCloseout,
    });

    return {
      mode: "close_out",
      sprint_id: sprintId,
      phase_id: "closeout",
      last_completed_task_id: taskIdForCloseout,
      close_out_phase_completed: "task_close",
      stop_required: true,
      closeout_path: closeOutPath,
      sprint_branch: run.sprint_branch,
      sprint_complete_artifacts: sprintCompleteArtifacts,
      artifact_paths: [closeOutPath],
    };
  }

  /**
   * Phase 7 (SCT-006, ORCH-001): Close-Out Protocol Phase 2 — PR Confirmation.
   * Requires explicit operator token close_out_phase: "pr_confirmed". Validates that Phase 1
   * (task_close) was completed via sprint_closeout.json before updating phase state. Returns
   * a STOP output; does not advance to Phase 3 automatically.
   */
  private async runCloseOutPhase2(
    pipelineId: string,
    previousArtifacts: string[],
    context: ScriptExecutionContext
  ): Promise<SprintControllerCloseOutOutput> {
    const closeoutArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_closeout.json"))
    );
    if (!closeoutArtifact?.content) {
      throw new HttpError(
        409,
        "CLOSE_OUT_PHASE_GATE",
        "Close-out Phase 2 (pr_confirmed) requires sprint_closeout.json from Phase 1. Complete Phase 1 first."
      );
    }
    const closeout = JSON.parse(closeoutArtifact.content) as {
      close_out_phase_completed?: string;
      sprint_id?: string;
      last_completed_task_id?: string;
      sprint_branch?: string;
      sprint_complete_artifacts?: string[];
    };
    if (closeout.close_out_phase_completed !== "task_close") {
      throw new HttpError(
        409,
        "CLOSE_OUT_PHASE_GATE",
        `Close-out Phase 2 cannot proceed: Phase 1 (task_close) must be completed first. ` +
          `Found close_out_phase_completed=${closeout.close_out_phase_completed ?? "absent"}.`,
        { close_out_phase_completed: closeout.close_out_phase_completed }
      );
    }

    const updated = { ...closeout, close_out_phase_completed: "pr_confirmed" };
    const closeOutPath = await artifactService.write(
      pipelineId,
      "sprint_closeout.json",
      JSON.stringify(updated, null, 2)
    );

    // Write sprint closeout to main branch (post-merge artifacts go directly to main).
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (project) {
      try {
        await projectGitService.ensureReady(project);
        await projectGitService.checkoutBranch(project, project.default_branch);
        await projectGitService.ensureReady(project, { forcePull: true });
        const historyDir = path.join(
          project.clone_path,
          "project_work",
          "ai_project_tasks",
          "history"
        );
        await fs.mkdir(historyDir, { recursive: true });
        const sprintIdForFile = closeout.sprint_id ?? "unknown";
        await fs.writeFile(
          path.join(historyDir, `sprint_closeout_${sprintIdForFile}.json`),
          JSON.stringify(updated, null, 2),
          "utf-8"
        );
        await projectGitService.commitAll(
          project,
          project.default_branch,
          `chore(${sprintIdForFile}): record sprint closeout`
        );
        await projectGitService.push(project, project.default_branch);
        context.notify(`📝 Sprint closeout recorded on \`${project.default_branch}\``);
      } catch (err) {
        context.log("Sprint Controller: closeout repo write failed (non-fatal)", { error: String(err) });
      }
    }

    context.notify(
      `✅ Phase 2 complete. PR merge recorded for task ${closeout.last_completed_task_id ?? "n/a"}. ` +
        "To stage the next task, re-invoke with close_out_phase: 'stage_next'."
    );
    context.log("Sprint Controller close-out Phase 2 complete", {
      pipeline_id: pipelineId,
      last_completed_task_id: closeout.last_completed_task_id,
    });

    return {
      mode: "close_out",
      sprint_id: closeout.sprint_id ?? pipelineId,
      phase_id: "closeout",
      last_completed_task_id: closeout.last_completed_task_id ?? "n/a",
      close_out_phase_completed: "pr_confirmed",
      stop_required: true,
      closeout_path: closeOutPath,
      sprint_branch: closeout.sprint_branch,
      sprint_complete_artifacts: closeout.sprint_complete_artifacts ?? [],
      artifact_paths: [closeOutPath],
    };
  }

  /**
   * Phase 7 (SCT-006, ORCH-001): Close-Out Protocol Phase 3 — Stage Next Task.
   * Requires explicit operator token close_out_phase: "stage_next". Validates that Phase 2
   * (pr_confirmed) was completed before allowing setup to proceed. Phase-skip protection:
   * if close_out_phase_completed is not "pr_confirmed" the gate throws CLOSE_OUT_PHASE_GATE.
   * Delegates to runSetup after the guard passes (7.3: preserves flow-task compatibility).
   */
  private async runCloseOutPhase3(
    pipelineId: string,
    previousArtifacts: string[],
    context: ScriptExecutionContext
  ): Promise<SprintControllerSetupOutput> {
    const closeoutArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_closeout.json"))
    );
    if (!closeoutArtifact?.content) {
      throw new HttpError(
        409,
        "CLOSE_OUT_PHASE_GATE",
        "Close-out Phase 3 (stage_next) requires sprint_closeout.json from Phase 1 and Phase 2. Complete both phases first."
      );
    }
    const closeout = JSON.parse(closeoutArtifact.content) as { close_out_phase_completed?: string };
    if (closeout.close_out_phase_completed !== "pr_confirmed") {
      throw new HttpError(
        409,
        "CLOSE_OUT_PHASE_GATE",
        `Close-out Phase 3 cannot proceed: Phase 2 (pr_confirmed) must be completed first. ` +
          `Found close_out_phase_completed=${closeout.close_out_phase_completed ?? "absent"}.`,
        { close_out_phase_completed: closeout.close_out_phase_completed }
      );
    }

    context.notify("🚀 Phase 3: operator-authorized next-task staging...");
    context.log("Sprint Controller close-out Phase 3 (stage_next) triggered by operator", { pipeline_id: pipelineId });

    return this.runSetup(pipelineId, previousArtifacts, context);
  }

  private extractSprintId(sprintPlanPath: string | undefined, fallback: string): string {
    if (!sprintPlanPath) return fallback;
    const match = sprintPlanPath.match(/sprint_plan_([^/.]+)\.md/i);
    return match?.[1] ?? fallback;
  }

  private formatSprintMarkdown(plan: SprintPlan, firstTask: SprintTask): string {
    const goals = plan.goals.map((g) => `- ${g}`).join("\n");
    const tasks = plan.tasks.map((t) => `- ${t}`).join("\n");
    const executionMode = plan.execution_mode ?? "normal";
    const fastTrackMeta =
      plan.execution_mode === "fast-track"
        ? `\n**Lane:** ${plan.fast_track_lane ?? ""}\n**Rationale:** ${plan.fast_track_rationale ?? ""}\n**Intake:** ${plan.fast_track_intake_id ?? ""}`
        : "";
    return `# Sprint Plan: ${plan.sprint_id}

**Phase:** ${plan.phase_id}
**Name:** ${plan.name}
**Status:** ${plan.status}
**Execution mode:** ${executionMode}${fastTrackMeta}

## Goals
${goals}

## Tasks
${tasks}

---

## First Task Detail: ${firstTask.task_id}

**${firstTask.title}** [${firstTask.estimated_effort}]

${firstTask.description}

**Files likely affected:**
${firstTask.files_likely_affected.map((f) => `- \`${f}\``).join("\n")}

**Acceptance criteria:**
${firstTask.acceptance_criteria.map((c) => `- ${c}`).join("\n")}
`;
  }

  private formatBrief(
    task: SprintTask,
    flags: TaskFlags,
    sprint: SprintPlan,
    isFastTrack: boolean,
    rich?: { spec: TaskSpecification; plan: RichSprintLlmResponse }
  ): string {
    const flagLines = Object.entries(flags)
      .map(([k, v]) => `- **${k}:** ${JSON.stringify(v)}`)
      .join("\n");

    // Phase 3 (deterministic staging): when a rich plan + spec is provided, prepend
    // Section 0 (Execution Contract — non-negotiable) and append filtered detail sections.
    const executionContractSection = rich
      ? this.formatExecutionContractSection(rich.spec.execution_contract)
      : "";
    const richDetailSections = rich ? this.formatRichDetailSections(rich.spec, rich.plan) : "";

    // Phase 5.4 (SCT-005): Inject Fast Track Controls block when execution mode is fast-track.
    const fastTrackSection = isFastTrack
      ? [
          "",
          "## Fast Track Controls",
          "- **Execution lane:** fast-track (operator-approved)",
          `- **Lane:** ${sprint.fast_track_lane ?? ""}`,
          `- **Intake:** ${sprint.fast_track_intake_id ?? ""}`,
          "- **Checkpoint commits:** required every 300–400 changed lines or at each logical boundary (AI_RUNTIME_GATES.md GTR-004)",
          "- **File ceiling:** 12 files / ~1 200 LOC per step; hard ceiling 15 files / ~1 500 LOC (AI_RULES.md RUL-007)",
          "- **Gate compliance:** lint + typecheck + focused tests required at each checkpoint (AI_RUNTIME_GATES.md GTR-004)",
          "- **See:** `ai_dev_stack/ai_guidance/AI_RUNTIME_GATES.md` for full fast-track gate protocol",
          "",
        ].join("\n")
      : "";

    return `# AI Implementation Brief

**Task ID:** ${task.task_id}
**Sprint:** ${sprint.sprint_id}
**Phase:** ${sprint.phase_id}
${executionContractSection}
## Task Description
${task.description}

## Files Likely Affected
${task.files_likely_affected.map((f) => `- \`${f}\``).join("\n")}

## Acceptance Criteria (Deliverables Checklist)
${task.acceptance_criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Task Flags
${flagLines}
${fastTrackSection}
## Implementation Constraints
- Modify no more than 5 files
- Keep changes under ~200 lines of code
- Add tests for all new behaviour
- Do not refactor unrelated code
- Do not implement future sprint tasks
${richDetailSections}
## Required Reads Before Coding
- \`ai_dev_stack/ai_guidance/AI_RULES.md\`
- \`ai_dev_stack/ai_guidance/AI_RUNTIME_POLICY.md\`
- \`ai_dev_stack/ai_guidance/AI_RUNTIME_GATES.md\`
`;
  }

  /**
   * Validates execution contract paths against the actual cloned repo on disk.
   *
   * For each literal (non-glob) path in `allowed_paths`, checks whether the file exists.
   * Emits a warning for any path that is missing so the operator can correct the sprint plan
   * before the Implementer wastes turns discovering the mismatch at runtime.
   *
   * Also validates `commands.working_directory` when present — warns if the directory
   * does not exist or contains no package.json.
   */
  private async validateContractPaths(
    contract: ExecutionContract,
    clonePath: string,
    context: ScriptExecutionContext
  ): Promise<void> {
    const repoBase = path.isAbsolute(clonePath)
      ? clonePath
      : path.join(process.cwd(), clonePath);

    const literalPaths = (contract.scope.allowed_paths ?? []).filter(
      (p) => !p.includes("*") && !p.includes("{")
    );

    const missing: string[] = [];
    for (const relPath of literalPaths) {
      const abs = path.join(repoBase, relPath);
      try {
        await fs.access(abs);
      } catch {
        missing.push(relPath);
      }
    }

    if (missing.length > 0) {
      context.notify(
        `⚠️ Contract path warning: the following allowed_paths do not exist in the repo. ` +
        `The Implementer will be blocked from writing to these paths. ` +
        `Update the sprint plan to use the correct paths before retrying.\n` +
        missing.map((p) => `  • \`${p}\``).join("\n")
      );
    }

    // Validate working_directory if present
    const workDir = contract.commands?.working_directory;
    if (workDir) {
      const absWorkDir = path.join(repoBase, workDir);
      let workDirExists = false;
      try {
        await fs.access(absWorkDir);
        workDirExists = true;
      } catch {
        // directory not found
      }

      if (!workDirExists) {
        context.notify(
          `⚠️ Contract working_directory warning: \`${workDir}\` does not exist in the repo. ` +
          `All gate commands will fail. Update the sprint plan.`
        );
      } else {
        // Check for package.json
        try {
          await fs.access(path.join(absWorkDir, "package.json"));
        } catch {
          context.notify(
            `⚠️ Contract working_directory warning: \`${workDir}\` exists but contains no package.json. ` +
            `npm commands will fail. Verify the correct working directory.`
          );
        }
      }
    }
  }

  /**
   * Phase 3 (deterministic staging): emits the binding **Execution Contract** section as
   * a fenced ```json block. Implementer and Verifier extract this with
   * `parseExecutionContract` from `utils/brief-parser`.
   */
  private formatExecutionContractSection(contract: ExecutionContract): string {
    return `
## Execution Contract

> **Binding.** This contract is the source of truth for scope, dependencies, commands,
> determinism, and success criteria for this task. The Implementer's tool layer enforces
> it; the Verifier checks against it. Do NOT exceed scope or alter forbidden actions.

\`\`\`json
${JSON.stringify(contract, null, 2)}
\`\`\`
`;
  }

  /**
   * Phase 3 (deterministic staging): emits filtered Data Contracts, Invariants, Test Matrix,
   * and Dependencies Closed sections — scoped to references declared on the task spec.
   */
  private formatRichDetailSections(spec: TaskSpecification, plan: RichSprintLlmResponse): string {
    const out: string[] = [];

    const refContracts = plan.sprint_plan.data_contracts.filter((c) => spec.contract_refs.includes(c.name));
    if (refContracts.length > 0) {
      out.push("## Data Contracts");
      out.push("");
      for (const c of refContracts) {
        out.push(`### ${c.name} (${c.kind})`);
        out.push("");
        out.push("```json");
        out.push(JSON.stringify(c.json_schema, null, 2));
        out.push("```");
        out.push("");
      }
    }

    const refInvariants = plan.sprint_plan.invariants.filter((i) => spec.invariant_refs.includes(i.id));
    if (refInvariants.length > 0) {
      out.push("## Invariants");
      out.push("");
      out.push("| ID | Statement | Testable via |");
      out.push("|---|---|---|");
      for (const i of refInvariants) {
        out.push(`| ${i.id} | ${i.statement.replace(/\|/g, "\\|")} | ${i.testable_via.replace(/\|/g, "\\|")} |`);
      }
      out.push("");
    }

    const refTests = plan.sprint_plan.test_matrix.filter((t) => t.task_id === spec.task_id || spec.test_refs.includes(t.task_id));
    if (refTests.length > 0) {
      out.push("## Test Matrix");
      out.push("");
      out.push("| Task | Normal | Edge | Failure | Idempotency |");
      out.push("|---|---|---|---|---|");
      for (const t of refTests) {
        out.push(
          `| ${t.task_id} | ${(t.normal ?? []).join("; ") || "—"} | ${(t.edge ?? []).join("; ") || "—"} | ${(t.failure ?? []).join("; ") || "—"} | ${(t.idempotency ?? []).join("; ") || "—"} |`
        );
      }
      out.push("");
    }

    if (spec.depends_on.length > 0) {
      out.push("## Dependencies Closed");
      out.push("");
      out.push(`This task depends on (must be complete): ${spec.depends_on.map((d) => `\`${d}\``).join(", ")}`);
      out.push("");
    }

    return out.length === 0 ? "" : "\n" + out.join("\n");
  }

  /**
   * Phase 5.3 (SCT-005, GTR-003, RUL-008): Enforces fast-track staging prerequisites.
   * Throws FAST_TRACK_PREREQUISITES_MISSING if lane, rationale, or intake are absent from
   * the sprint plan, or if next_steps.md does not record fast-track designation.
   */
  private async enforceFastTrackPrerequisites(clonePath: string, plan: SprintPlan): Promise<void> {
    const missing: string[] = [];
    if (!plan.fast_track_lane?.trim()) missing.push("lane (in sprint plan)");
    if (!plan.fast_track_rationale?.trim()) missing.push("rationale (in sprint plan)");
    if (!plan.fast_track_intake_id?.trim()) missing.push("intake ID (in sprint plan)");

    const nextStepsPath = path.join(clonePath, "project_work", "ai_project_tasks", "next_steps.md");
    let nextStepsContent: string | null = null;
    try {
      nextStepsContent = await fs.readFile(nextStepsPath, "utf-8");
    } catch {
      // file not found — absence counts as missing fast-track designation
    }

    if (!nextStepsContent) {
      missing.push("fast-track designation in next_steps.md (file not found)");
    } else if (!/fast.?track/i.test(nextStepsContent)) {
      missing.push("fast-track designation in next_steps.md (not mentioned)");
    }

    if (missing.length > 0) {
      throw new HttpError(
        422,
        "FAST_TRACK_PREREQUISITES_MISSING",
        `Sprint staging as fast-track is blocked: required prerequisites are missing: ${missing.join("; ")}. ` +
          `Fast Track mode requires operator direction recorded in sprint plan and next_steps.md ` +
          `(SCT-005, GTR-003, RUL-008).`,
        { missing_prerequisites: missing }
      );
    }
  }

  /**
   * Parses the phase plan markdown "Required Design Artifacts" table and returns the titles of
   * any TDN entries whose status is not "Approved". Used to enforce the TDN staging gate.
   */
  private extractBlockingTdns(markdown: string): string[] {
    const blocking: string[] = [];
    let inArtifactsSection = false;
    for (const line of markdown.split("\n")) {
      if (/^## Required Design Artifacts/.test(line)) { inArtifactsSection = true; continue; }
      if (inArtifactsSection && /^## /.test(line)) break;
      if (!inArtifactsSection) continue;
      // Match table rows: | TDN | <title> | <status> |
      const m = /^\|\s*TDN\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/.exec(line);
      if (m) {
        const status = m[2].trim();
        if (status !== "Approved") blocking.push(m[1].trim());
      }
    }
    return blocking;
  }

  /**
   * Reads the most recently modified sprint plan from staged_sprints/ and returns the parsed
   * SprintPlan + SprintTask (first task). Returns null if no staged sprint plan is found.
   */
  private async findStagedSprintPlan(clonePath: string): Promise<{
    sprintPlan: SprintPlan;
    firstTask: SprintTask;
    sprintPlanContent: string;
    sprintPlanName: string;
    rich: RichSprintLlmResponse | null;
  } | null> {
    const stagedSprintsDir = path.join(clonePath, "project_work", "ai_project_tasks", "staged_sprints");
    try {
      const entries = await fs.readdir(stagedSprintsDir, { withFileTypes: true });
      const planEntries = entries
        .filter((e) => e.isFile() && /^sprint_plan_.*\.md$/i.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (planEntries.length === 0) return null;

      // Take lexically last entry — sprint plan naming convention puts most recent last.
      const selectedEntry = planEntries[planEntries.length - 1];
      const selectedPath = path.join(stagedSprintsDir, selectedEntry.name);
      const content = await fs.readFile(selectedPath, "utf-8");
      const filename = selectedEntry.name;
      const sprintPlan = this.parseActiveSprintPlan(content, filename, "");

      // Phase 3: Load rich JSON sidecar if Planner wrote one (rich path).
      const jsonSidecarPath = selectedPath.replace(/\.md$/i, ".json");
      let rich: RichSprintLlmResponse | null = null;
      try {
        const rawJson = await fs.readFile(jsonSidecarPath, "utf-8");
        const parsed = JSON.parse(rawJson) as RichSprintLlmResponse;
        if (parsed && typeof parsed === "object" && parsed.plan_version === 1) {
          rich = parsed;
        }
      } catch {
        // No sidecar → fall through to legacy markdown parsing.
      }

      let firstTask: SprintTask | null;
      if (rich) {
        // Pick the next task: first_task_id, or the first task in tasks[] whose dependencies are satisfied
        // (Phase 3 deterministic staging — completed_tasks integration is handled at higher levels).
        const nextTaskId = this.pickNextTaskId(rich, []);
        const spec = rich.task_specifications.find((s) => s.task_id === nextTaskId);
        if (spec) {
          firstTask = this.specToSprintTask(spec);
        } else {
          firstTask = this.parseFirstTaskFromSprintPlan(content);
        }
      } else {
        firstTask = this.parseFirstTaskFromSprintPlan(content);
      }
      if (!firstTask) return null;

      return { sprintPlan, firstTask, sprintPlanContent: content, sprintPlanName: filename, rich };
    } catch {
      return null;
    }
  }

  /**
   * Phase 3 (deterministic staging): selects the next task to stage from a rich plan.
   * Strategy: pick the first task in `sprint_plan.tasks` whose `dependency_graph` entry is
   * fully satisfied by `completedTaskIds`. If none qualifies (or graph is empty), fall back
   * to `first_task_id`.
   */
  private pickNextTaskId(rich: RichSprintLlmResponse, completedTaskIds: string[]): string {
    const completed = new Set(completedTaskIds);
    const depMap = new Map(rich.sprint_plan.dependency_graph.map((e) => [e.task_id, e.depends_on]));
    for (const id of rich.sprint_plan.tasks) {
      if (completed.has(id)) continue;
      const deps = depMap.get(id) ?? [];
      if (deps.every((d) => completed.has(d))) return id;
    }
    return rich.first_task_id;
  }

  /** Adapt a rich TaskSpecification into the legacy SprintTask shape consumed by downstream code. */
  private specToSprintTask(spec: TaskSpecification): SprintTask {
    return {
      task_id: spec.task_id,
      title: spec.title,
      description: spec.description,
      acceptance_criteria: spec.acceptance_criteria,
      estimated_effort: spec.estimated_effort,
      files_likely_affected: spec.files_likely_affected,
      status: "pending",
    };
  }

  /**
   * Parses the "## First Task Detail: {task_id}" section from a sprint plan markdown
   * to extract the structured SprintTask. Returns null if the section is absent.
   */
  private parseFirstTaskFromSprintPlan(markdown: string): SprintTask | null {
    const headerMatch = /## First Task Detail:\s*(\S+)/i.exec(markdown);
    if (!headerMatch) return null;
    const taskId = headerMatch[1].trim();

    const sectionStart = markdown.indexOf("## First Task Detail:");
    const sectionContent = markdown.slice(sectionStart);

    const titleLineMatch = /\*\*(.+?)\*\*\s*\[([SML])\]/.exec(sectionContent);
    const title = titleLineMatch?.[1]?.trim() ?? taskId;
    const effort = (titleLineMatch?.[2] ?? "M") as SprintTask["estimated_effort"];

    const descMatch = /\*\*.+?\*\*\s*\[[SML]\]\n\n([\s\S]*?)\n\*\*Files likely affected:\*\*/i.exec(sectionContent);
    const description = descMatch?.[1]?.trim() ?? "";

    const filesMatch = /\*\*Files likely affected:\*\*\n([\s\S]*?)(?=\n\*\*Acceptance criteria:|$)/i.exec(sectionContent);
    const filesAffected = (filesMatch?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).replace(/^`|`$/g, "").trim());

    const criteriaMatch = /\*\*Acceptance criteria:\*\*\n([\s\S]*?)(?=\n---|$)/i.exec(sectionContent);
    const acceptance = (criteriaMatch?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim());

    return {
      task_id: taskId,
      title,
      description,
      acceptance_criteria: acceptance,
      estimated_effort: effort,
      files_likely_affected: filesAffected,
      status: "pending",
    };
  }

  /**
   * Scans active/ and history/ directories for sprint_plan_sNN.md files and returns
   * the next sprint number (max found + 1, or 1 if none exist).
   */
  private async getNextSprintNumber(clonePath: string): Promise<number> {
    const dirsToScan = [
      path.join(clonePath, "project_work", "ai_project_tasks", "active"),
      path.join(clonePath, "project_work", "ai_project_tasks", "history"),
    ];
    let maxSprint = 0;
    for (const dir of dirsToScan) {
      try {
        const entries = await fs.readdir(dir);
        for (const name of entries) {
          const m = /^sprint_plan_s(\d+)\.md$/i.exec(name);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > maxSprint) maxSprint = n;
          }
        }
      } catch {
        // dir doesn't exist — non-fatal
      }
    }
    return maxSprint + 1;
  }

  private async allocateCanonicalIds(clonePath: string, nextSprintNum: number): Promise<CanonicalIds> {
    const sprintId = `S${String(nextSprintNum).padStart(2, "0")}`;
    const nextTaskNum = await this.getNextTaskNumber(clonePath, sprintId);
    const taskId = `${sprintId}-${String(nextTaskNum).padStart(3, "0")}`;
    return { sprintId, taskId };
  }

  private async getNextTaskNumber(clonePath: string, sprintId: string): Promise<number> {
    const dirsToScan = [
      path.join(clonePath, "project_work", "ai_project_tasks", "active"),
      path.join(clonePath, "project_work", "ai_project_tasks", "history"),
    ];
    const taskRegex = new RegExp(`\\b${sprintId}-(\\d{3})\\b`, "g");
    let maxTaskNum = 0;

    for (const dir of dirsToScan) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
        for (const filePath of files) {
          let content = "";
          try {
            content = await fs.readFile(filePath, "utf-8");
          } catch {
            continue;
          }
          for (const match of content.matchAll(taskRegex)) {
            const n = parseInt(match[1], 10);
            if (n > maxTaskNum) maxTaskNum = n;
          }
        }
      } catch {
        // directory missing is non-fatal
      }
    }

    return maxTaskNum + 1;
  }

  private async loadOpenActiveTaskPackage(pipelineId: string, previousArtifacts: string[], clonePath: string): Promise<ActiveTaskPackage | null> {
    // ADR-035: Read brief and current_task from the pipeline-scoped artifact service path,
    // not from the shared active/ directory. This ensures each pipeline is isolated.
    const briefResult = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))
    );
    const taskResult = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task"))
    );

    if (!briefResult || !taskResult) {
      return null;
    }

    try {
      const briefContent = briefResult.content;
      const currentTaskContent = taskResult.content;
      const currentTask = JSON.parse(currentTaskContent) as {
        task_id?: string;
        title?: string;
        description?: string;
        status?: string;
      };

      const status = String(currentTask.status ?? "pending").toLowerCase();
      if (!currentTask.task_id || !OPEN_TASK_STATUSES.has(status)) {
        return null;
      }

      // Sprint plan lives in staged_sprints/ (not active/) — load it from there.
      const stagedSprintsDir = path.join(clonePath, "project_work", "ai_project_tasks", "staged_sprints");
      let sprintPlanName = `sprint_plan_unknown.md`;
      let sprintPlanContent = "";
      let sprintPlan: SprintPlan = {
        sprint_id: "unknown",
        phase_id: "unknown",
        name: "Open Sprint",
        goals: [],
        tasks: [currentTask.task_id],
        status: "staged",
      };

      try {
        const entries = await fs.readdir(stagedSprintsDir, { withFileTypes: true });
        const sprintPlanEntry = entries.find((e) => e.isFile() && /^sprint_plan_.*\.md$/i.test(e.name));
        if (sprintPlanEntry) {
          sprintPlanName = sprintPlanEntry.name;
          sprintPlanContent = await fs.readFile(path.join(stagedSprintsDir, sprintPlanEntry.name), "utf-8");
          sprintPlan = this.parseActiveSprintPlan(sprintPlanContent, sprintPlanName, currentTask.task_id);
        }
      } catch {
        // staged_sprints/ not found — use defaults
      }

      const parsedBrief = this.parseBriefContent(briefContent);

      return {
        sprintPlanName,
        sprintPlanContent,
        briefContent,
        currentTaskContent,
        sprintPlan,
        firstTask: {
          task_id: currentTask.task_id,
          title: currentTask.title ?? "Open task",
          description: currentTask.description ?? parsedBrief.description,
          acceptance_criteria: parsedBrief.acceptanceCriteria,
          estimated_effort: parsedBrief.estimatedEffort,
          files_likely_affected: parsedBrief.filesLikelyAffected,
          status: "pending",
        },
        taskFlags: parsedBrief.taskFlags,
      };
    } catch {
      return null;
    }
  }

  private async publishExistingTaskPackage(
    pipelineId: string,
    activeTaskPackage: ActiveTaskPackage,
    context: ScriptExecutionContext
  ): Promise<SprintControllerSetupOutput> {
    // Phase 5.1 (TFC-001): Re-validate required task flags even for existing briefs to catch tampered/malformed artifacts.
    validateRequiredTaskFlags(activeTaskPackage.taskFlags);

    const sprintPlanPath = await artifactService.write(
      pipelineId,
      activeTaskPackage.sprintPlanName,
      activeTaskPackage.sprintPlanContent
    );
    const briefPath = await artifactService.write(pipelineId, "AI_IMPLEMENTATION_BRIEF.md", activeTaskPackage.briefContent);
    const currentTaskPath = await artifactService.write(pipelineId, "current_task.json", activeTaskPackage.currentTaskContent);

    const run = await pipelineService.get(pipelineId);
    const project = run.project_id
      ? await projectService.getById(run.project_id)
      : await projectService.getByName("default");

    let sprintBranch: string | undefined;
    if (project) {
      sprintBranch = buildTaskFeatureBranch(activeTaskPackage.firstTask.task_id);
      await pipelineService.setSprintBranch(pipelineId, sprintBranch);
    }

    context.log("Sprint Controller reused open task package", {
      pipeline_id: pipelineId,
      sprint_id: activeTaskPackage.sprintPlan.sprint_id,
      task_id: activeTaskPackage.firstTask.task_id,
      sprint_branch: sprintBranch,
    });

    return {
      mode: "setup",
      sprint_id: activeTaskPackage.sprintPlan.sprint_id,
      phase_id: activeTaskPackage.sprintPlan.phase_id,
      sprint_plan_path: sprintPlanPath,
      brief_path: briefPath,
      current_task_path: currentTaskPath,
      sprint_state_path: "",
      task_flags: activeTaskPackage.taskFlags,
      first_task: activeTaskPackage.firstTask,
      sprint_branch: sprintBranch,
      artifact_paths: [sprintPlanPath, briefPath, currentTaskPath],
    };
  }

  private parseActiveSprintPlan(markdown: string, sprintPlanName: string, taskId: string): SprintPlan {
    const sprintId = /^#\s*Sprint\s*Plan:\s*(.+?)\s*$/im.exec(markdown)?.[1]?.trim() ?? this.extractSprintId(sprintPlanName, "unknown");
    const phaseId = /^\*\*Phase:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "unknown";
    const name = /^\*\*Name:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? `Sprint ${sprintId}`;
    const status = /^\*\*Status:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "staged";
    const tasks = this.extractSectionBullets(markdown, "Tasks");
    const executionMode = /^\*\*Execution mode:\*\*\s+(.+)$/im.exec(markdown)?.[1]?.trim() as SprintPlan["execution_mode"] | undefined;
    const fastTrackLane = /^\*\*Lane:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim();
    const fastTrackRationale = /^\*\*Rationale:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim();
    const fastTrackIntakeId = /^\*\*Intake:\*\*\s+(.+)$/m.exec(markdown)?.[1]?.trim();

    return {
      sprint_id: sprintId,
      phase_id: phaseId,
      name,
      goals: this.extractSectionBullets(markdown, "Goals"),
      tasks: tasks.length > 0 ? tasks : [taskId],
      status: "staged",
      ...(executionMode ? { execution_mode: executionMode } : {}),
      ...(fastTrackLane ? { fast_track_lane: fastTrackLane } : {}),
      ...(fastTrackRationale ? { fast_track_rationale: fastTrackRationale } : {}),
      ...(fastTrackIntakeId ? { fast_track_intake_id: fastTrackIntakeId } : {}),
    };
  }

  private parseBriefContent(markdown: string): {
    description: string;
    filesLikelyAffected: string[];
    acceptanceCriteria: string[];
    estimatedEffort: SprintTask["estimated_effort"];
    taskFlags: TaskFlags;
  } {
    return {
      description: this.extractSectionText(markdown, "Task Description"),
      filesLikelyAffected: this.extractSectionBullets(markdown, "Files Likely Affected").map((line) => line.replace(/^`|`$/g, "")),
      acceptanceCriteria: this.extractSectionBullets(markdown, "Acceptance Criteria \\(Deliverables Checklist\\)").map((line) => line.replace(/^\[ \]\s*/, "")),
      estimatedEffort: "M",
      taskFlags: this.extractTaskFlags(markdown),
    };
  }

  private extractSectionText(markdown: string, title: string): string {
    const sectionRegex = new RegExp(`## ${title}\\n([\\s\\S]*?)(?:\\n## |$)`);
    const match = sectionRegex.exec(markdown);
    return match?.[1]?.trim() ?? "";
  }

  private extractSectionBullets(markdown: string, title: string): string[] {
    return this.extractSectionText(markdown, title)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
  }

  private extractTaskFlags(markdown: string): TaskFlags {
    const sectionText = this.extractSectionText(markdown, "Task Flags");
    const getValue = (key: string): unknown => {
      const match = new RegExp(`- \\*\\*${key}:\\*\\* (.+)$`, "m").exec(sectionText);
      if (!match) {
        return undefined;
      }
      try {
        return JSON.parse(match[1]);
      } catch {
        return match[1];
      }
    };

    return {
      fr_ids_in_scope: (getValue("fr_ids_in_scope") as string[] | undefined) ?? [],
      architecture_contract_change: Boolean(getValue("architecture_contract_change")),
      ui_evidence_required: Boolean(getValue("ui_evidence_required")),
      incident_tier: (getValue("incident_tier") as TaskFlags["incident_tier"] | undefined) ?? "none",
      schema_change: getValue("schema_change") as boolean | undefined,
      migration_change: getValue("migration_change") as boolean | undefined,
      cross_subsystem_change: getValue("cross_subsystem_change") as boolean | undefined,
    };
  }
}
