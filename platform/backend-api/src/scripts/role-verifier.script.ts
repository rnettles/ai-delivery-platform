import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";

export interface VerifierInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

export interface TaskFinding {
  task_id: string;
  passed: boolean;
  notes: string;
  issues: string[];
}

export interface VerifierOutput {
  sprint_id: string;
  passed: boolean;
  findings: TaskFinding[];
  overall_assessment: string;
  artifact_path: string;
}

const SYSTEM_PROMPT = `You are the Verifier AI in a governed software delivery pipeline.
You evaluate an implementation plan against the original sprint plan's acceptance criteria.

Output ONLY valid JSON — no markdown, no prose:
{
  "sprint_id": "string",
  "passed": true|false,
  "findings": [
    {
      "task_id": "string",
      "passed": true|false,
      "notes": "assessment of this task",
      "issues": ["specific issue 1", "specific issue 2"]
    }
  ],
  "overall_assessment": "one paragraph summary of the verification result"
}

Rules:
- passed at the top level is true ONLY if ALL tasks pass
- Check each acceptance criterion from the sprint plan against the implementation plan
- issues must be specific and actionable — vague issues are not acceptable
- If no sprint plan is available, mark as passed with a note about missing context
- Do NOT wrap output in markdown code fences`;

export class VerifierScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.verifier",
    version: "2026.04.19",
    description: "Verifies an implementation plan against sprint acceptance criteria.",
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
      required: ["sprint_id", "passed", "findings", "overall_assessment", "artifact_path"],
      properties: {
        sprint_id: { type: "string" },
        passed: { type: "boolean" },
        findings: { type: "array" },
        overall_assessment: { type: "string" },
        artifact_path: { type: "string" },
      },
    },
    tags: ["role", "verifier"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<VerifierInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Verifier running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Collect all available previous artifacts to give the verifier full context
    const artifactContents = await Promise.all(
      previousArtifacts.map(async (p) => {
        const content = await artifactService.tryRead(p);
        return content ? `### Artifact: ${p}\n\n${content}` : null;
      })
    );
    const context_text = artifactContents.filter(Boolean).join("\n\n---\n\n");

    const userContent = context_text
      ? `Available artifacts:\n\n${context_text}\n\nVerify the implementation against all acceptance criteria.`
      : "No artifacts available. Return a passing result with a note that no artifacts were provided.";

    const result = await azureOpenAiService.chatJson<VerifierOutput>([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    if (!result.sprint_id || !Array.isArray(result.findings)) {
      throw new Error("Verifier LLM response missing required fields");
    }

    const artifactContent = this.formatMarkdown(result);
    const artifactPath = await artifactService.write(
      pipelineId,
      "verification_result.md",
      artifactContent
    );

    context.log("Verifier complete", {
      sprint_id: result.sprint_id,
      passed: result.passed,
      findings_count: result.findings.length,
      artifact_path: artifactPath,
    });

    return { ...result, artifact_path: artifactPath };
  }

  private formatMarkdown(result: VerifierOutput): string {
    const status = result.passed ? "✅ PASSED" : "❌ FAILED";

    const findingLines = result.findings
      .map((f) => {
        const taskStatus = f.passed ? "✅" : "❌";
        const issues =
          f.issues.length > 0
            ? "\n**Issues:**\n" + f.issues.map((i) => `  - ${i}`).join("\n")
            : "";
        return `### ${taskStatus} ${f.task_id}\n${f.notes}${issues}`;
      })
      .join("\n\n");

    return `# Verification Result: ${result.sprint_id}

## Status: ${status}

## Overall Assessment
${result.overall_assessment}

## Task Findings

${findingLines}
`;
  }
}
