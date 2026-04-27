import fs from "fs/promises";
import path from "path";
import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";

export interface SprintControllerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
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
}

export interface SprintControllerOutput {
  sprint_id: string;
  phase_id: string;
  sprint_plan_path: string;
  brief_path: string;
  current_task_path: string;
  task_flags: TaskFlags;
  first_task: SprintTask;
  sprint_branch?: string;
  pr_number?: number;
  pr_url?: string;
  artifact_paths: string[];
}

const SPRINT_READY_PHASE_STATUSES = new Set(["Planning", "Approved"]);

interface LlmResponse {
  sprint_plan: SprintPlan;
  first_task: SprintTask;
  task_flags: TaskFlags;
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
      type: "object",
      required: ["sprint_id", "phase_id", "sprint_plan_path", "brief_path", "current_task_path", "task_flags", "first_task"],
    },
    tags: ["role", "sprint-controller", "planning"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<SprintControllerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Sprint Controller running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Close-out mode: verifier has produced verification_result.json (PASS/FAIL)
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
  ): Promise<SprintControllerOutput> {
    context.notify("🗂️ Breaking phase plan into sprint tasks and drafting implementation brief...");

    // Pre-condition: no open sprint exists (process_invariants §Sprint Lifecycle Gates, ADR-031)
    try {
      const staged = await pipelineService.listStagedSprints(pipelineId);
      const OPEN_SPRINT_STATUSES = ["staged", "Planning", "Active", "ready_for_verification"];
      const openSprint = staged.sprints.find((s) => OPEN_SPRINT_STATUSES.includes(s.status));
      if (openSprint) {
        throw new HttpError(
          409,
          "OPEN_SPRINT_EXISTS",
          `A sprint is already open (${openSprint.sprint_id}, status: ${openSprint.status}). ` +
            "Close the open sprint before staging a new one (process_invariants §Sprint Lifecycle Gates).",
          { sprint_id: openSprint.sprint_id, status: openSprint.status }
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Artifact read failure on a fresh pipeline is non-fatal.
      context.log("Sprint Controller: open-sprint pre-condition check skipped", { reason: String(err) });
    }

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "sprint-controller");
    context.notify(
      `📚 Design inputs validated (${designInputs.sample_files.length} found). ` +
      `Using project: \`${designInputs.project_name}\``
    );

    let phasePlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("phase_plan")).concat(previousArtifacts)
    );

    // Fallback: if no phase plan in pipeline artifacts, read most recent one from project repo staged_phases/
    if (!phasePlanArtifact) {
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
          // Pick most recently modified phase plan
          const withMtime = await Promise.all(
            planFiles.map(async (fp) => ({ fp, mtime: (await fs.stat(fp)).mtimeMs }))
          );
          withMtime.sort((a, b) => b.mtime - a.mtime);
          const content = await fs.readFile(withMtime[0].fp, "utf-8");
          phasePlanArtifact = { path: withMtime[0].fp, content };
          context.notify(`📄 Phase plan loaded from repo: \`${path.basename(withMtime[0].fp)}\``);
        }
      } catch {
        // staged_phases dir doesn't exist yet — non-fatal, continue without phase plan
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

    const userContent = phasePlanArtifact
      ? `Phase plan:\n\n${phasePlanArtifact.content}\n\nProduce a sprint plan and implementation brief for Sprint 1, Task 1.`
      : "No phase plan found. Produce a generic 2-task Sprint 1 with a foundational first task.";

    const systemPrompt = await governanceService.getComposedPrompt("sprint-controller");
    const provider = await llmFactory.forRole("sprint-controller");
    const llm = await provider.chatJson<LlmResponse>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!llm.sprint_plan?.sprint_id || !llm.first_task?.task_id) {
      throw new Error("Sprint Controller LLM response missing required fields");
    }
    context.notify(`🎯 First task identified: *${llm.first_task.task_id}* — ${llm.first_task.title}\n> Effort: ${llm.first_task.estimated_effort} | ${llm.first_task.files_likely_affected.length} file(s) likely affected`);

    // UX gate: user_flow.md must be Approved before staging any user-facing sprint (AI_RULES.md UX Artifact Rules)
    if (llm.task_flags?.ui_evidence_required === true) {
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

    // Write sprint_plan.md — matches naming convention:
    // project_work/ai_project_tasks/active/sprint_plan_<SPRINT_ID>.md
    const sprintPlanContent = this.formatSprintMarkdown(llm.sprint_plan, llm.first_task);
    const sprintPlanPath = await artifactService.write(
      pipelineId,
      `sprint_plan_${llm.sprint_plan.sprint_id.toLowerCase()}.md`,
      sprintPlanContent
    );

    // Write AI_IMPLEMENTATION_BRIEF.md — the Implementer's source of truth
    const briefContent = this.formatBrief(llm.first_task, llm.task_flags, llm.sprint_plan);
    const briefPath = await artifactService.write(
      pipelineId,
      "AI_IMPLEMENTATION_BRIEF.md",
      briefContent
    );

    // Write current_task.json — required by Verifier and Fixer
    const currentTask = {
      task_id: llm.first_task.task_id,
      title: llm.first_task.title,
      description: llm.first_task.description,
      assigned_to: "implementer",
      status: "pending",
      artifacts: [],
    };
    const currentTaskPath = await artifactService.write(
      pipelineId,
      "current_task.json",
      JSON.stringify(currentTask, null, 2)
    );

    const run = await pipelineService.get(pipelineId);
    const project = run.project_id
      ? await projectService.getById(run.project_id)
      : await projectService.getByName("default");

    let sprintBranch: string | undefined;
    if (project) {
      sprintBranch = buildTaskFeatureBranch(llm.first_task.task_id);
      await projectGitService.ensureReady(project);
      await projectGitService.createBranch(project, sprintBranch);
      await pipelineService.setSprintBranch(pipelineId, sprintBranch);
      context.notify(`🌿 Branch \`${sprintBranch}\` created and ready`);

      // Persist planning artifacts to repo (AI_RUNTIME_PATHS.md)
      const activeDir = path.join("project_work", "ai_project_tasks", "active");
      const repoBase = path.isAbsolute(project.clone_path)
        ? project.clone_path
        : path.join(process.cwd(), project.clone_path);
      await fs.mkdir(path.join(repoBase, activeDir), { recursive: true });
      await fs.writeFile(
        path.join(repoBase, activeDir, `sprint_plan_${llm.sprint_plan.sprint_id.toLowerCase()}.md`),
        sprintPlanContent,
        "utf-8"
      );
      await fs.writeFile(path.join(repoBase, activeDir, "AI_IMPLEMENTATION_BRIEF.md"), briefContent, "utf-8");
      await fs.writeFile(
        path.join(repoBase, activeDir, "current_task.json"),
        JSON.stringify(currentTask, null, 2),
        "utf-8"
      );
      await projectGitService.commitAll(
        project,
        sprintBranch,
        `chore(${llm.first_task.task_id}): stage sprint artifacts`
      );
      await projectGitService.push(project, sprintBranch);
      context.notify(`📋 Sprint artifacts committed and pushed from \`${activeDir}/\` on \`${sprintBranch}\``);
    }

    context.log("Sprint Controller setup complete", {
      sprint_id: llm.sprint_plan.sprint_id,
      first_task: llm.first_task.task_id,
      brief_path: briefPath,
      sprint_branch: sprintBranch,
    });

    const output: SprintControllerOutput = {
      sprint_id: llm.sprint_plan.sprint_id,
      phase_id: llm.sprint_plan.phase_id,
      sprint_plan_path: sprintPlanPath,
      brief_path: briefPath,
      current_task_path: currentTaskPath,
      task_flags: llm.task_flags,
      first_task: llm.first_task,
      sprint_branch: sprintBranch,
      artifact_paths: [sprintPlanPath, briefPath, currentTaskPath],
    };

    return output;
  }

  private async runCloseOut(
    pipelineId: string,
    previousArtifacts: string[],
    verificationJson: string,
    context: ScriptExecutionContext
  ): Promise<SprintControllerOutput> {
    const verification = JSON.parse(verificationJson) as { result?: string; summary?: string; task_id?: string };
    if (verification.result !== "PASS") {
      throw new Error("Sprint Controller close-out called before verifier PASS");
    }
    context.notify("🏁 Verification passed — closing out task and preparing sprint-complete artifacts for Planner...");

    const run = await pipelineService.get(pipelineId);

    const currentTaskArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task.json"))
    );

    const sprintPlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_plan_"))
    );

    let currentTaskId: string | undefined;
    if (currentTaskArtifact?.content) {
      try {
        const parsed = JSON.parse(currentTaskArtifact.content) as { task_id?: string };
        currentTaskId = parsed.task_id;
      } catch {
        // Non-fatal: keep fallback from verification task id.
      }
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

    const closeOutPath = await artifactService.write(
      pipelineId,
      "sprint_closeout.json",
      JSON.stringify(
        {
          pipeline_id: pipelineId,
          sprint_branch: run.sprint_branch,
          last_completed_task_id: currentTaskId ?? verification.task_id ?? "n/a",
          closeout_role: "sprint-controller",
          closeout_scope: "task",
          gate_result: "PASS",
          verifier_summary: verification.summary ?? "",
          sprint_complete_artifacts: sprintCompleteArtifacts,
        },
        null,
        2
      )
    );

    context.log("Sprint Controller close-out complete", {
      pipeline_id: pipelineId,
      sprint_branch: run.sprint_branch,
      last_completed_task_id: currentTaskId ?? verification.task_id ?? "n/a",
    });

    return {
      sprint_id: this.extractSprintId(sprintPlanArtifact?.path, pipelineId),
      phase_id: "closeout",
      sprint_plan_path: sprintPlanArtifact?.path ?? "",
      brief_path: "",
      current_task_path: "",
      task_flags: {
        fr_ids_in_scope: [],
        architecture_contract_change: false,
        ui_evidence_required: false,
        incident_tier: "none",
      },
      first_task: {
        task_id: currentTaskId ?? verification.task_id ?? "n/a",
        title: "Task close-out",
        description: "Publish task closeout artifacts for planner sprint closure",
        acceptance_criteria: ["sprint_closeout.json emitted"],
        estimated_effort: "S",
        files_likely_affected: [],
        status: "pending",
      },
      sprint_branch: run.sprint_branch,
      artifact_paths: [closeOutPath],
    };
  }

  private extractSprintId(sprintPlanPath: string | undefined, fallback: string): string {
    if (!sprintPlanPath) return fallback;
    const match = sprintPlanPath.match(/sprint_plan_([^/.]+)\.md/i);
    return match?.[1] ?? fallback;
  }

  private formatSprintMarkdown(plan: SprintPlan, firstTask: SprintTask): string {
    const goals = plan.goals.map((g) => `- ${g}`).join("\n");
    const tasks = plan.tasks.map((t) => `- ${t}`).join("\n");
    return `# Sprint Plan: ${plan.sprint_id}

**Phase:** ${plan.phase_id}
**Name:** ${plan.name}
**Status:** ${plan.status}

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

  private formatBrief(task: SprintTask, flags: TaskFlags, sprint: SprintPlan): string {
    const flagLines = Object.entries(flags)
      .map(([k, v]) => `- **${k}:** ${JSON.stringify(v)}`)
      .join("\n");

    return `# AI Implementation Brief

**Task ID:** ${task.task_id}
**Sprint:** ${sprint.sprint_id}
**Phase:** ${sprint.phase_id}

## Task Description
${task.description}

## Files Likely Affected
${task.files_likely_affected.map((f) => `- \`${f}\``).join("\n")}

## Acceptance Criteria (Deliverables Checklist)
${task.acceptance_criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Task Flags
${flagLines}

## Implementation Constraints
- Modify no more than 5 files
- Keep changes under ~200 lines of code
- Add tests for all new behaviour
- Do not refactor unrelated code
- Do not implement future sprint tasks

## Required Reads Before Coding
- \`ai_dev_stack/ai_guidance/AI_RULES.md\`
- \`ai_dev_stack/ai_guidance/AI_RUNTIME_POLICY.md\`
- \`ai_dev_stack/ai_guidance/AI_RUNTIME_GATES.md\`
`;
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
}
