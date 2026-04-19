import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";

export interface FixerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface Fix {
  task_id: string;
  issue: string;
  fix_approach: string;
  priority: "high" | "medium" | "low";
}

export interface FixerOutput {
  sprint_id: string;
  fixes: Fix[];
  fix_summary: string;
  artifact_path: string;
}

const SYSTEM_PROMPT = `You are the Fixer AI in a governed software delivery pipeline.
You receive verification failure findings and produce a specific fix plan.

Output ONLY valid JSON — no markdown, no prose:
{
  "sprint_id": "string",
  "fixes": [
    {
      "task_id": "string",
      "issue": "exact issue from the verification result",
      "fix_approach": "specific step-by-step fix",
      "priority": "high|medium|low"
    }
  ],
  "fix_summary": "one paragraph describing what was fixed and what the new state should be"
}

Rules:
- One fix entry per failing issue (not per task)
- fix_approach must be actionable and specific
- priority high = blocks delivery, medium = degrades quality, low = nice-to-have
- Do NOT invent new issues not present in the verification result
- Do NOT wrap output in markdown code fences`;

export class FixerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.fixer",
    version: "2026.04.19",
    description: "Produces a fix plan from verification failures. Output is re-verified by Verifier.",
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
      required: ["sprint_id", "fixes", "fix_summary", "artifact_path"],
      properties: {
        sprint_id: { type: "string" },
        fixes: { type: "array" },
        fix_summary: { type: "string" },
        artifact_path: { type: "string" },
      },
    },
    tags: ["role", "fixer"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<FixerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Fixer running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Prioritise the verification result; include all artifacts for full context
    const prioritised = [
      ...previousArtifacts.filter((p) => p.includes("verification_result")),
      ...previousArtifacts.filter((p) => !p.includes("verification_result")),
    ];

    const artifactContents = await Promise.all(
      prioritised.map(async (p) => {
        const content = await artifactService.tryRead(p);
        return content ? `### ${p}\n\n${content}` : null;
      })
    );
    const contextText = artifactContents.filter(Boolean).join("\n\n---\n\n");

    const userContent = contextText
      ? `Available artifacts:\n\n${contextText}\n\nProduce a fix plan addressing all failing issues.`
      : "No verification result found. Return a fix plan with a note that context was unavailable.";

    const result = await azureOpenAiService.chatJson<FixerOutput>([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    if (!result.sprint_id || !Array.isArray(result.fixes)) {
      throw new Error("Fixer LLM response missing required fields");
    }

    const artifactContent = this.formatMarkdown(result);
    const artifactPath = await artifactService.write(pipelineId, "fix_plan.md", artifactContent);

    context.log("Fixer complete", {
      sprint_id: result.sprint_id,
      fix_count: result.fixes.length,
      artifact_path: artifactPath,
    });

    return { ...result, artifact_path: artifactPath };
  }

  private formatMarkdown(result: FixerOutput): string {
    const fixLines = result.fixes
      .map(
        (f) =>
          `### [${f.priority.toUpperCase()}] ${f.task_id}\n**Issue:** ${f.issue}\n**Fix:** ${f.fix_approach}`
      )
      .join("\n\n");

    return `# Fix Plan: ${result.sprint_id}

## Summary
${result.fix_summary}

## Fixes

${fixLines}
`;
  }
}
