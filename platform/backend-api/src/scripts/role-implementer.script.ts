import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";

export interface ImplementerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface TaskImplementation {
  task_id: string;
  title: string;
  summary: string;
  approach: string;
  files_to_modify: string[];
  test_approach: string;
}

export interface ImplementerOutput {
  sprint_id: string;
  task_implementations: TaskImplementation[];
  artifact_path: string;
}

const SYSTEM_PROMPT = `You are the Implementer AI in a governed software delivery pipeline.
You receive a sprint plan and produce an implementation plan describing what code changes to make.
This is a design-level implementation — you describe the changes precisely without writing raw code.

Output ONLY valid JSON — no markdown, no prose:
{
  "sprint_id": "string",
  "task_implementations": [
    {
      "task_id": "string",
      "title": "string",
      "summary": "what this implementation achieves",
      "approach": "step-by-step description of the implementation approach",
      "files_to_modify": ["src/path/to/file.ts", "..."],
      "test_approach": "how to test this implementation"
    }
  ]
}

Rules:
- Implement ALL tasks from the sprint plan
- files_to_modify must be specific file paths relative to the project root
- approach must be actionable and specific enough for a developer to execute
- test_approach must reference specific test types (unit, integration, e2e)
- Do NOT write actual code, only describe what to implement
- Do NOT wrap output in markdown code fences`;

export class ImplementerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.implementer",
    version: "2026.04.19",
    description: "Produces an implementation plan from a sprint plan. Describes code changes needed.",
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
      required: ["sprint_id", "task_implementations", "artifact_path"],
      properties: {
        sprint_id: { type: "string" },
        task_implementations: { type: "array" },
        artifact_path: { type: "string" },
      },
    },
    tags: ["role", "implementer"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<ImplementerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Implementer running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];
    const sprintArtifact = await artifactService.findFirst(
      // Prefer the sprint plan artifact; fall back to any artifact
      previousArtifacts.filter((p) => p.includes("sprint_plan")).concat(previousArtifacts)
    );

    const userContent = sprintArtifact
      ? `Sprint plan:\n\n${sprintArtifact.content}\n\nProduce a detailed implementation plan for all tasks.`
      : "No sprint plan artifact found. Produce a generic 2-task implementation plan.";

    const impl = await azureOpenAiService.chatJson<ImplementerOutput>([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    if (!impl.sprint_id || !impl.task_implementations?.length) {
      throw new Error("Implementer LLM response missing required fields");
    }

    const artifactContent = this.formatMarkdown(impl);
    const artifactPath = await artifactService.write(
      pipelineId,
      "implementation_summary.md",
      artifactContent
    );

    context.log("Implementer complete", {
      sprint_id: impl.sprint_id,
      tasks_implemented: impl.task_implementations.length,
      artifact_path: artifactPath,
    });

    return { ...impl, artifact_path: artifactPath };
  }

  private formatMarkdown(impl: ImplementerOutput): string {
    const taskSections = impl.task_implementations
      .map((t) => {
        const files = t.files_to_modify.map((f) => `  - \`${f}\``).join("\n");
        return `### ${t.task_id}: ${t.title}

**Summary:** ${t.summary}

**Approach:**
${t.approach}

**Files to modify:**
${files}

**Test approach:** ${t.test_approach}`;
      })
      .join("\n\n");

    return `# Implementation Summary: ${impl.sprint_id}

## Task Implementations

${taskSections}
`;
  }
}
