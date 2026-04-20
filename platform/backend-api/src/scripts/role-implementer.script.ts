import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";

export interface ImplementerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface FileChange {
  path: string;
  action: "Create" | "Modify";
  description: string;
}

export interface ImplementerOutput {
  task_id: string;
  sprint_id: string;
  summary: string;
  files_changed: FileChange[];
  test_approach: string;
  artifact_path: string;
}

export class ImplementerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.implementer",
    version: "2026.04.19",
    description: "Produces an implementation summary from AI_IMPLEMENTATION_BRIEF.md. Describes exact code changes needed (≤5 files, ≤200 lines).",
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
      required: ["task_id", "sprint_id", "summary", "files_changed", "test_approach", "artifact_path"],
    },
    tags: ["role", "implementer"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<ImplementerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Implementer running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Primary source: AI_IMPLEMENTATION_BRIEF.md (Sprint Controller's output)
    // Stage A loads per AI_RUNTIME_LOADING_RULES.md
    const briefArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))
    );
    const taskArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task"))
    );
    // Stage B conditional: sprint plan for broader context
    const sprintArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_plan"))
    );

    const contextParts: string[] = [];
    if (briefArtifact) contextParts.push(`# AI_IMPLEMENTATION_BRIEF.md\n\n${briefArtifact.content}`);
    if (taskArtifact) contextParts.push(`# current_task.json\n\n${taskArtifact.content}`);
    if (sprintArtifact) contextParts.push(`# Sprint Plan (context)\n\n${sprintArtifact.content}`);

    const userContent = contextParts.length > 0
      ? `${contextParts.join("\n\n---\n\n")}\n\nProduce the implementation summary for the active task.`
      : "No implementation brief found. Produce a generic 2-file implementation summary for a data model task.";

    const systemPrompt = await governanceService.getPrompt("implementer");
    const provider = await llmFactory.forRole("implementer");
    const impl = await provider.chatJson<ImplementerOutput>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!impl.task_id || !Array.isArray(impl.files_changed)) {
      throw new Error("Implementer LLM response missing required fields");
    }

    if (impl.files_changed.length > 5) {
      throw new Error(`Implementer produced ${impl.files_changed.length} file changes — governance limit is 5`);
    }

    const artifactContent = this.formatMarkdown(impl);
    const artifactPath = await artifactService.write(
      pipelineId,
      "implementation_summary.md",
      artifactContent
    );

    context.log("Implementer complete", {
      task_id: impl.task_id,
      files_changed: impl.files_changed.length,
      artifact_path: artifactPath,
    });

    return { ...impl, artifact_path: artifactPath };
  }

  private formatMarkdown(impl: ImplementerOutput): string {
    const fileLines = impl.files_changed
      .map((f) => `### ${f.action}: \`${f.path}\`\n${f.description}`)
      .join("\n\n");

    return `# Implementation Summary

**Task:** ${impl.task_id}
**Sprint:** ${impl.sprint_id}

## Summary
${impl.summary}

## Deliverables Checklist

${fileLines}

## Test Approach
${impl.test_approach}
`;
  }
}

