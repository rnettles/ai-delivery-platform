import { Script, ScriptExecutionContext } from "./script.interface";

export interface PlannerInput {
  description: string;
  project_context?: string;
}

export interface PlannerOutput {
  phase_id: string;
  phase_plan: {
    objective: string;
    constraints: string[];
    sprints: Array<{
      sprint_id: string;
      goal: string;
      tasks: string[];
    }>;
  };
  artifact_path: string;
}

/**
 * Planner role script — Phase 1 stub.
 * Returns a structured phase plan shape for contract validation.
 * Full Azure OpenAI integration is implemented in Phase 4.
 */
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
        project_context: { type: "string" }
      },
      additionalProperties: false
    },
    output_schema: {
      type: "object",
      required: ["phase_id", "phase_plan", "artifact_path"],
      properties: {
        phase_id: { type: "string" },
        phase_plan: { type: "object" },
        artifact_path: { type: "string" }
      }
    },
    tags: ["role", "planner", "planning"]
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typedInput = input as Partial<PlannerInput>;
    const description = typeof typedInput.description === "string" && typedInput.description.trim()
      ? typedInput.description
      : "Unspecified objective";

    context.log("Planner script running", {
      description_length: description.length,
      has_context: Boolean(typedInput.project_context),
    });

    // Phase 1 stub — returns a deterministic placeholder plan.
    // Phase 4 will replace this body with Azure OpenAI calls and artifact Git writes.
    const phaseId = `PH-STUB-${context.execution_id.slice(0, 8).toUpperCase()}`;
    const artifactPath = `ai_dev_stack/ai_project_tasks/active/phase_plan_${phaseId.toLowerCase()}.md`;

    const output: PlannerOutput = {
      phase_id: phaseId,
      phase_plan: {
        objective: `Deliver: ${description}`,
        constraints: [
          "No breaking changes to existing API contracts",
          "All new behavior must have tests",
          "Artifacts committed to Git before phase close"
        ],
        sprints: [
          {
            sprint_id: "SPR-001",
            goal: "Foundation and scaffolding",
            tasks: ["TASK-001: Define data model", "TASK-002: Implement API endpoints"]
          }
        ]
      },
      artifact_path: artifactPath
    };

    context.log("Planner script complete (stub)", { phase_id: phaseId, artifact_path: artifactPath });

    return output;
  }
}
