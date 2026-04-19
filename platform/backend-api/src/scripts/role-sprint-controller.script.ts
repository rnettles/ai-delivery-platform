import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";

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
}

interface LlmResponse {
  sprint_plan: SprintPlan;
  first_task: SprintTask;
  task_flags: TaskFlags;
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
    const phasePlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("phase_plan")).concat(previousArtifacts)
    );

    const userContent = phasePlanArtifact
      ? `Phase plan:\n\n${phasePlanArtifact.content}\n\nProduce a sprint plan and implementation brief for Sprint 1, Task 1.`
      : "No phase plan found. Produce a generic 2-task Sprint 1 with a foundational first task.";

    const systemPrompt = await governanceService.getPrompt("sprint-controller");
    const llm = await azureOpenAiService.chatJson<LlmResponse>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!llm.sprint_plan?.sprint_id || !llm.first_task?.task_id) {
      throw new Error("Sprint Controller LLM response missing required fields");
    }

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

    context.log("Sprint Controller complete", {
      sprint_id: llm.sprint_plan.sprint_id,
      first_task: llm.first_task.task_id,
      brief_path: briefPath,
    });

    const output: SprintControllerOutput = {
      sprint_id: llm.sprint_plan.sprint_id,
      phase_id: llm.sprint_plan.phase_id,
      sprint_plan_path: sprintPlanPath,
      brief_path: briefPath,
      current_task_path: currentTaskPath,
      task_flags: llm.task_flags,
      first_task: llm.first_task,
    };

    return output;
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
