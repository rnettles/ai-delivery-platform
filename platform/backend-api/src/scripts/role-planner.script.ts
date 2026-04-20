import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";

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
    context.notify(`📋 Planning delivery phase...\n> _${description.slice(0, 120)}${description.length > 120 ? "…" : ""}_`);

    const userContent = typed.project_context
      ? `Project context:\n${typed.project_context}\n\nDelivery request: ${description}`
      : `Delivery request: ${description}`;

    const systemPrompt = await governanceService.getPrompt("planner");
    const provider = await llmFactory.forRole("planner");
    const plan = await provider.chatJson<PlannerPhasePlan>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!plan.phase_id || !Array.isArray(plan.objectives) || !Array.isArray(plan.deliverables)) {
      throw new Error("Planner LLM response missing required fields (phase_id, objectives, deliverables)");
    }
    context.notify(`📝 Phase plan drafted: *${plan.name}* (\`${plan.phase_id}\`)\n> ${plan.objectives.length} objective${plan.objectives.length !== 1 ? "s" : ""}, ${plan.deliverables.length} deliverable${plan.deliverables.length !== 1 ? "s" : ""}`);

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
