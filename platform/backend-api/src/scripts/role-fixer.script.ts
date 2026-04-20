import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";

export interface FixerInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

/**
 * Handoff contract — matches AI_HANDOFF_CONTRACT.md
 */
export interface HandoffContract {
  changed_scope: string[];
  verification_state: "pass" | "fail" | "not_run";
  open_risks: string[];
  next_role_action: string;
  evidence_refs: string[];
}

export interface FixerOutput {
  task_id: string;
  sprint_id: string;
  fixes_applied: string[];
  handoff: HandoffContract;
  artifact_path: string;
}

export class FixerScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.fixer",
    version: "2026.04.19",
    description: "Addresses verification failures. Produces handoff contract per AI_HANDOFF_CONTRACT.md. Verifier re-runs after Fixer.",
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
      required: ["task_id", "sprint_id", "fixes_applied", "handoff", "artifact_path"],
    },
    tags: ["role", "fixer"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<FixerInput>;
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Fixer running", { pipeline_id: pipelineId });

    const previousArtifacts = typed.previous_artifacts ?? [];

    // Stage A: required inputs — verification result is primary
    const verificationJsonArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("verification_result.json"))
    );
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
    if (verificationJsonArtifact) contextParts.push(`# verification_result.json\n\n${verificationJsonArtifact.content}`);
    if (briefArtifact) contextParts.push(`# AI_IMPLEMENTATION_BRIEF.md\n\n${briefArtifact.content}`);
    if (taskArtifact) contextParts.push(`# current_task.json\n\n${taskArtifact.content}`);
    if (implArtifact) contextParts.push(`# implementation_summary.md\n\n${implArtifact.content}`);

    const userContent = contextParts.length > 0
      ? `${contextParts.join("\n\n---\n\n")}\n\nProduce a fix plan addressing ONLY the listed required_corrections.`
      : "No verification result found. Return a fix plan noting that context was unavailable.";

    const systemPrompt = await governanceService.getPrompt("fixer");
    const provider = await llmFactory.forRole("fixer");
    const llm = await provider.chatJson<FixerOutput>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!llm.task_id || !Array.isArray(llm.fixes_applied) || !llm.handoff) {
      throw new Error("Fixer LLM response missing required fields");
    }

    const artifactContent = this.formatMarkdown(llm);
    const artifactPath = await artifactService.write(pipelineId, "fix_plan.md", artifactContent);

    // Update the handoff with evidence refs pointing to real artifact paths
    const handoff: HandoffContract = {
      ...llm.handoff,
      evidence_refs: [
        ...(verificationJsonArtifact ? [verificationJsonArtifact.path] : []),
        ...(briefArtifact ? [briefArtifact.path] : []),
        artifactPath,
      ],
    };

    context.log("Fixer complete", {
      task_id: llm.task_id,
      fixes_applied: llm.fixes_applied.length,
      artifact_path: artifactPath,
    });

    return { ...llm, handoff, artifact_path: artifactPath };
  }

  private formatMarkdown(result: FixerOutput): string {
    const fixes = result.fixes_applied.map((f) => `- ${f}`).join("\n");

    return `# Fix Plan: ${result.task_id}

**Sprint:** ${result.sprint_id}

## Fixes Applied
${fixes}

## Handoff Contract
\`\`\`json
${JSON.stringify(result.handoff, null, 2)}
\`\`\`
`;
  }
}

