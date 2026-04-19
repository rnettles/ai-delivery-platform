import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";

export interface SprintControllerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface SprintTask {
  task_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  estimated_effort: "S" | "M" | "L";
}

export interface SprintControllerOutput {
  sprint_id: string;
  phase_id: string;
  goal: string;
  tasks: SprintTask[];
  artifact_path: string;
}

const SYSTEM_PROMPT = `You are the Sprint Controller AI in a governed software delivery pipeline.
You receive a phase plan and produce a detailed sprint plan for the first sprint.

Output ONLY valid JSON — no markdown, no prose:
{
  "sprint_id": "SPR-001",
  "phase_id": "string",
  "goal": "string",
  "tasks": [
    {
      "task_id": "TASK-001",
      "title": "short title",
      "description": "what to implement and why",
      "acceptance_criteria": ["testable criterion 1", "testable criterion 2"],
      "estimated_effort": "S|M|L"
    }
  ]
}

Rules:
- Focus on Sprint 1 from the phase plan only
- 2-4 tasks maximum
- Each task must be independently deliverable
- acceptance_criteria must be verifiable by the Verifier AI
- estimated_effort: S = <1 day, M = 1-2 days, L = 3+ days
- Do NOT wrap output in markdown code fences`;

export class SprintControllerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.sprint-controller",
    version: "2026.04.19",
    description: "Converts a phase plan into a detailed sprint plan. Produces a sprint_plan artifact.",
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
      required: ["sprint_id", "phase_id", "goal", "tasks", "artifact_path"],
      properties: {
        sprint_id: { type: "string" },
        phase_id: { type: "string" },
        goal: { type: "string" },
        tasks: { type: "array" },
        artifact_path: { type: "string" },
      },
    },
    tags: ["role", "sprint-controller", "planning"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<SprintControllerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Sprint Controller running", { pipeline_id: pipelineId });

    // Read the phase plan from the previous step
    const previousArtifacts = typed.previous_artifacts ?? [];
    const phasePlanArtifact = await artifactService.findFirst(previousArtifacts);

    const userContent = phasePlanArtifact
      ? `Phase plan:\n\n${phasePlanArtifact.content}\n\nProduce a detailed sprint plan for Sprint 1.`
      : "No phase plan artifact found. Produce a generic Sprint 1 plan with 2 foundational tasks.";

    const sprint = await azureOpenAiService.chatJson<SprintControllerOutput>([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    if (!sprint.sprint_id || !sprint.tasks?.length) {
      throw new Error("Sprint Controller LLM response missing required fields");
    }

    const artifactContent = this.formatMarkdown(sprint);
    const artifactPath = await artifactService.write(pipelineId, "sprint_plan.md", artifactContent);

    context.log("Sprint Controller complete", {
      sprint_id: sprint.sprint_id,
      task_count: sprint.tasks.length,
      artifact_path: artifactPath,
    });

    return { ...sprint, artifact_path: artifactPath };
  }

  private formatMarkdown(sprint: SprintControllerOutput): string {
    const taskLines = sprint.tasks
      .map((t) => {
        const criteria = t.acceptance_criteria.map((c) => `  - ${c}`).join("\n");
        return `### ${t.task_id}: ${t.title} [${t.estimated_effort}]\n${t.description}\n**Acceptance criteria:**\n${criteria}`;
      })
      .join("\n\n");

    return `# Sprint Plan: ${sprint.sprint_id}

**Phase:** ${sprint.phase_id}
**Goal:** ${sprint.goal}

## Tasks

${taskLines}
`;
  }
}
