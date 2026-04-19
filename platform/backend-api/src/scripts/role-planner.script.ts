import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";

export interface PlannerInput {
  description: string;
  project_context?: string;
  previous_artifacts?: string[];
  pipeline_id?: string;
}

/**
 * Canonical phase plan shape — matches ai-project_template/ai_dev_stack/ai_guidance/phase_plan.schema.json
 */
export interface PlannerPhasePlan {
  phase_id: string;
  name: string;
  description: string;
  objectives: string[];
  deliverables: string[];
  dependencies: string[];
  status: "Draft" | "Active" | "Complete";
}

export interface PlannerOutput {
  phase_id: string;
  phase_plan: PlannerPhasePlan;
  artifact_path: string;
}

const SYSTEM_PROMPT = `You are the Planner AI in a governed software delivery pipeline.
Your job is to produce a structured phase plan from a human description.
You determine WHAT should be built. You never write code.

Follow the ai_dev_stack governance model. Tasks must be small and deterministic:
- <= 5 files modified per task
- <= 200 lines of code per task

Output ONLY valid JSON matching this exact schema (phase_plan.schema.json) -- no markdown, no prose:
{
  "phase_id": "PH-{STREAM}-{N}",
  "name": "Short human-readable phase name",
  "description": "One paragraph describing this phase purpose",
  "objectives": [
    "Specific measurable objective 1",
    "Specific measurable objective 2"
  ],
  "deliverables": [
    "Concrete deliverable 1 (artifact or feature)",
    "Concrete deliverable 2"
  ],
  "dependencies": [],
  "status": "Draft"
}

Rules:
- phase_id: PH-{STREAM}-{N} where STREAM is 2-6 uppercase letters from the topic area
- objectives: 2-4 measurable outcomes, each independently verifiable
- deliverables: concrete artifacts or features that can be checked into Git
- dependencies: IDs of phases that must complete first, or empty array
- status: always "Draft" (planner never activates a phase)
- Do NOT produce sprint plans or implementation details -- that is the Sprint Controller job
- Do NOT wrap output in markdown code fences`;

export class PlannerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.planner",
    version: "2026.04.19",
    description: "Plans a software delivery phase from a human description. Produces a phase_plan artifact matching phase_plan.schema.json.",
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

    if (!plan.phase_id || !Array.isArray(plan.objectives) || !Array.isArray(plan.deliverables)) {
      throw new Error("Planner LLM response missing required fields (phase_id, objectives, deliverables)");
    }

    // Artifact path follows ai_dev_stack governance naming convention:
    // phase_plan_<descriptor>.md
    const descriptor = plan.phase_id.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const artifactFilename = `phase_plan_${descriptor}.md`;
    const artifactContent = this.formatMarkdown(plan);
    const artifactPath = await artifactService.write(pipelineId, artifactFilename, artifactContent);

    context.log("Planner complete", { phase_id: plan.phase_id, artifact_path: artifactPath });

    const output: PlannerOutput = {
      phase_id: plan.phase_id,
      phase_plan: plan,
      artifact_path: artifactPath,
    };

    return output;
  }

  private formatMarkdown(plan: PlannerPhasePlan): string {
    const objectives = plan.objectives.map((o) => `- ${o}`).join("\n");
    const deliverables = plan.deliverables.map((d) => `- ${d}`).join("\n");
    const dependencies = plan.dependencies.length
      ? plan.dependencies.map((d) => `- ${d}`).join("\n")
      : "- None";

    return `# Phase Plan: ${plan.phase_id}

**Name:** ${plan.name}
**Status:** ${plan.status}

## Description
${plan.description}

## Objectives
${objectives}

## Deliverables
${deliverables}

## Dependencies
${dependencies}
`;
  }
}
