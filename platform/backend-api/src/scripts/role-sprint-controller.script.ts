import fs from "fs/promises";
import path from "path";
import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { githubApiService } from "../services/github-api.service";
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

    const phasePlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("phase_plan")).concat(previousArtifacts)
    );

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

    // Write sprint_plan.md — matches naming convention:
    // ai_dev_stack/ai_project_tasks/active/sprint_plan_<SPRINT_ID>.md
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
      const activeDir = path.join("ai_dev_stack", "ai_project_tasks", "active");
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
      context.notify(`📋 Sprint artifacts committed to \`${activeDir}/\` on \`${sprintBranch}\``);
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
    context.notify("🏁 Verification passed — pushing branch and opening pull request...");

    const run = await pipelineService.get(pipelineId);
    const project = run.project_id
      ? await projectService.getById(run.project_id)
      : await projectService.getByName("default");
    if (!project) {
      throw new Error("Sprint Controller close-out failed: project not found");
    }

    const sprintBranch = run.sprint_branch ?? `feature/${pipelineId}`;

    await projectGitService.ensureReady(project);
    await projectGitService.push(project, sprintBranch);

    const sprintPlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_plan_"))
    );

    const title = `[${sprintBranch}] Autonomous sprint`;
    const body = [
      "## Sprint Summary",
      verification.summary ?? "Verifier passed.",
      "",
      "## Pipeline",
      `Pipeline ID: ${pipelineId}`,
      verification.task_id ? `Last Task: ${verification.task_id}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const pr = await githubApiService.createPullRequest({
      repoUrl: project.repo_url,
      title,
      body,
      head: sprintBranch,
      base: project.default_branch,
    });

    await pipelineService.setPrDetails(pipelineId, pr.number, pr.html_url, sprintBranch);
    context.notify(`🔗 PR #${pr.number} opened: <${pr.html_url}|View Pull Request>`);

    const closeOutPath = await artifactService.write(
      pipelineId,
      "sprint_closeout.json",
      JSON.stringify(
        {
          pipeline_id: pipelineId,
          sprint_branch: sprintBranch,
          pr_number: pr.number,
          pr_url: pr.html_url,
          verifier_summary: verification.summary ?? "",
        },
        null,
        2
      )
    );

    context.log("Sprint Controller close-out complete", {
      pipeline_id: pipelineId,
      sprint_branch: sprintBranch,
      pr_number: pr.number,
      pr_url: pr.html_url,
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
        task_id: verification.task_id ?? "n/a",
        title: "Sprint close-out",
        description: "Push sprint branch and create PR",
        acceptance_criteria: ["Pull request created"],
        estimated_effort: "S",
        files_likely_affected: [],
        status: "pending",
      },
      sprint_branch: sprintBranch,
      pr_number: pr.number,
      pr_url: pr.html_url,
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
}
