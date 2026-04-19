import { Script, ScriptExecutionContext } from "./script.interface";
import { azureOpenAiService } from "../services/azure-openai.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";

export interface VerifierInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

/**
 * Machine-readable verification result — matches AI_REVIEW.md output contract.
 * Written to verification_result.json (required by Fixer and Sprint Controller).
 */
export interface VerificationResult {
  task_id: string;
  result: "PASS" | "FAIL";
  summary: string;
  required_corrections: string[];
  verified_at: string;
}

/**
 * Handoff contract — matches AI_HANDOFF_CONTRACT.md (emitted on FAIL).
 */
export interface HandoffContract {
  changed_scope: string[];
  verification_state: "pass" | "fail" | "not_run";
  open_risks: string[];
  next_role_action: string;
  evidence_refs: string[];
}

export interface VerifierOutput {
  task_id: string;
  passed: boolean;
  verification_result_path: string;
  artifact_path: string;
  handoff?: HandoffContract;
}

interface LlmResponse {
  task_id: string;
  result: "PASS" | "FAIL";
  summary: string;
  required_corrections: string[];
  handoff: HandoffContract;
}

export class VerifierScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.verifier",
    version: "2026.04.19",
    description: "Quality gate — verifies implementation against acceptance criteria. Writes verification_result.json and handoff contract.",
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
      required: ["task_id", "passed", "verification_result_path", "artifact_path"],
    },
    tags: ["role", "verifier"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<VerifierInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Verifier running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Stage A: required inputs per AI_REVIEW.md
    const briefArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))
    );
    const taskArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task"))
    );
    const implArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("implementation_summary"))
    );

    const contextParts: string[] = [];
    if (briefArtifact) contextParts.push(`# AI_IMPLEMENTATION_BRIEF.md\n\n${briefArtifact.content}`);
    if (taskArtifact) contextParts.push(`# current_task.json\n\n${taskArtifact.content}`);
    if (implArtifact) contextParts.push(`# implementation_summary.md\n\n${implArtifact.content}`);

    const userContent = contextParts.length > 0
      ? `${contextParts.join("\n\n---\n\n")}\n\nVerify the implementation against all acceptance criteria.`
      : "No artifacts available. Return FAIL with 'No implementation artifacts found' as the correction.";

    const systemPrompt = await governanceService.getPrompt("verifier");
    const llm = await azureOpenAiService.chatJson<LlmResponse>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!llm.task_id || !llm.result) {
      throw new Error("Verifier LLM response missing required fields");
    }

    const verifiedAt = new Date().toISOString();

    // Write verification_result.json — machine-readable, consumed by Fixer and Sprint Controller
    const verificationResult: VerificationResult = {
      task_id: llm.task_id,
      result: llm.result,
      summary: llm.summary,
      required_corrections: llm.required_corrections ?? [],
      verified_at: verifiedAt,
    };
    const verificationResultPath = await artifactService.write(
      pipelineId,
      "verification_result.json",
      JSON.stringify(verificationResult, null, 2)
    );

    // Write human-readable markdown summary
    const artifactContent = this.formatMarkdown(verificationResult, llm.handoff);
    const artifactPath = await artifactService.write(
      pipelineId,
      "verification_result.md",
      artifactContent
    );

    context.log("Verifier complete", {
      task_id: llm.task_id,
      result: llm.result,
      corrections: verificationResult.required_corrections.length,
    });

    const output: VerifierOutput = {
      task_id: llm.task_id,
      passed: llm.result === "PASS",
      verification_result_path: verificationResultPath,
      artifact_path: artifactPath,
      handoff: llm.handoff,
    };

    return output;
  }

  private formatMarkdown(result: VerificationResult, handoff?: HandoffContract): string {
    const status = result.result === "PASS" ? "✅ PASS" : "❌ FAIL";
    const corrections =
      result.required_corrections.length > 0
        ? result.required_corrections.map((c) => `- ${c}`).join("\n")
        : "None — all acceptance criteria met.";

    const handoffSection = handoff
      ? `\n## Handoff Contract\n\`\`\`json\n${JSON.stringify(handoff, null, 2)}\n\`\`\``
      : "";

    return `# Verification Result: ${result.task_id}

## Status: ${status}

**Verified at:** ${result.verified_at}

## Summary
${result.summary}

## Required Corrections
${corrections}
${handoffSection}
`;
  }
}

