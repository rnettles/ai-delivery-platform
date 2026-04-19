import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";

export interface PlannerInput {
  description: string;
  project_context?: string;
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface PlannerTask {
  task_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
}

export interface PlannerSprint {
  sprint_id: string;
  goal: string;
  tasks: PlannerTask[];
}

export interface PlannerPhasePlan {
  phase_id: string;
  objective: string;
  constraints: string[];
  sprints: PlannerSprint[];
}

export interface PlannerOutput {
  phase_id: string;
  phase_plan: PlannerPhasePlan;
  artifact_path: string;
}

const SYSTEM_PROMPT = `You are the Planner AI in a governed software delivery pipeline.
Your job is to produce a structured phase plan from a human description.

Output ONLY valid JSON matching this exact schema — no markdown, no prose:
{
  "phase_id": "PH-{STREAM}-{N}",
  "objective": "one sentence describing the delivery goal",
  "constraints": ["constraint 1", "constraint 2"],
  "sprints": [
    {
      "sprint_id": "SPR-001",
      "goal": "sprint goal",
      "tasks": [
        {
          "task_id": "TASK-001",
          "title": "short title",
          "description": "what to implement",
          "acceptance_criteria": ["criterion 1", "criterion 2"]
        }
      ]
    }
  ]
}

Rules:
- phase_id: PH-{STREAM}-{N} where STREAM is 2-6 uppercase letters derived from the topic
- Include 1-3 sprints, 2-4 tasks per sprint
- Constraints must be specific and binding (not generic platitudes)
- acceptance_criteria must be testable
- Do NOT wrap output in markdown code fences`;

export class PlannerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.planner",
    version: "2026.04.19",
    description: "Plans a software delivery phase from a human description. Produces a phase plan artifact.",
    input_schema: {
      type: "object",
      required: ["description"],
      properties: {
        description: { type: "string" },
        project_context: { type: "string" },
        previous_artifacts: { type: "array" },
        pipeline_id: { type: "string" },
      },
      additionalProperties: true,
    },
    output_schema: {
      type: "object",
      required: ["phase_id", "phase_plan", "artifact_path"],
      properties: {
        phase_id: { type: "string" },
        phase_plan: { type: "object" },
        artifact_path: { type: "string" },
      },
    },
    tags: ["role", "planner", "planning"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<PlannerInput>;
    const description = typed.description?.trim() || "Unspecified objective";
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Planner running", { description_length: description.length });

    const userContent = typed.project_context
      ? `Project context:\n${typed.project_context}\n\nDelivery request: ${description}`
      : `Delivery request: ${description}`;

    const plan = await azureOpenAiService.chatJson<PlannerPhasePlan>([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    // Validate minimum shape before writing artifact
    if (!plan.phase_id || !plan.sprints?.length) {
      throw new Error("Planner LLM response is missing required fields (phase_id, sprints)");
    }

    const artifactContent = this.formatMarkdown(plan);
    const artifactPath = await artifactService.write(pipelineId, "phase_plan.md", artifactContent);

    context.log("Planner complete", { phase_id: plan.phase_id, artifact_path: artifactPath });

    const output: PlannerOutput = {
      phase_id: plan.phase_id,
      phase_plan: plan,
      artifact_path: artifactPath,
    };

    return output;
  }

  private formatMarkdown(plan: PlannerPhasePlan): string {
    const sprintSections = plan.sprints.map((s) => {
      const taskLines = s.tasks
        .map((t) => {
          const criteria = t.acceptance_criteria.map((c) => `  - ${c}`).join("\n");
          return `#### ${t.task_id}: ${t.title}\n${t.description}\n**Acceptance criteria:**\n${criteria}`;
        })
        .join("\n\n");
      return `### ${s.sprint_id}: ${s.goal}\n\n${taskLines}`;
    });

    const constraintLines = plan.constraints.map((c) => `- ${c}`).join("\n");

    return `# Phase Plan: ${plan.phase_id}

## Objective
${plan.objective}

## Constraints
${constraintLines}

## Sprints
${sprintSections.join("\n\n")}
`;
  }
}

