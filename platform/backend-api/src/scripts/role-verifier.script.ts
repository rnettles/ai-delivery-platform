import fs from "fs/promises";
import path from "path";
import { Script, ScriptExecutionContext } from "./script.interface";
import { exec } from "child_process";
import { promisify } from "util";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { config } from "../config";

const execAsync = promisify(exec);

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
  command_results: CommandResult[];
  verified_at: string;
}

interface CommandResult {
  command: string;
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
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

const DEFAULT_VERIFY_COMMANDS = ["npm test", "npm run lint", "npx tsc --noEmit"];

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
    context.notify("🔍 Verifier starting — reviewing implementation against acceptance criteria...");

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

    const taskId = this.extractTaskId(taskArtifact?.content) ?? `task-${pipelineId}`;

    const repoPath =
      (context.metadata.repo_path as string | undefined) ??
      (input.repo_path as string | undefined) ??
      config.gitClonePath;

    const commands = this.resolveCommands(input);
    context.notify(`🧪 Running verification: ${commands.map((c) => `\`${c}\``).join(", ")}`);
    const commandResults = await this.runCommands(commands, repoPath, context);
    const passed = commandResults.every((r) => r.ok);
    context.notify(passed ? "✅ All verification checks passed" : `❌ ${commandResults.filter((r) => !r.ok).length} check(s) failed — analyzing failures...`);

    let summary = passed
      ? "All verifier commands completed successfully."
      : "One or more verifier commands failed.";
    let requiredCorrections: string[] = [];
    let handoff: HandoffContract | undefined;

    if (!passed) {
      const triage = await this.triageFailures({
        taskId,
        commandResults,
        briefContent: briefArtifact?.content,
        taskContent: taskArtifact?.content,
        implContent: implArtifact?.content,
      });
      summary = triage.summary;
      requiredCorrections = triage.required_corrections;
      handoff = triage.handoff;
    }

    const verifiedAt = new Date().toISOString();

    // Write verification_result.json — machine-readable, consumed by Fixer and Sprint Controller
    const verificationResult: VerificationResult = {
      task_id: taskId,
      result: passed ? "PASS" : "FAIL",
      summary,
      required_corrections: requiredCorrections,
      command_results: commandResults,
      verified_at: verifiedAt,
    };
    const verificationResultPath = await artifactService.write(
      pipelineId,
      "verification_result.json",
      JSON.stringify(verificationResult, null, 2)
    );

    // Write human-readable markdown summary
    const artifactContent = this.formatMarkdown(verificationResult, handoff);
    const artifactPath = await artifactService.write(
      pipelineId,
      "verification_result.md",
      artifactContent
    );

    // Persist verification result to repo (AI_RUNTIME_PATHS.md)
    try {
      const run = await pipelineService.get(pipelineId);
      const project = run.project_id ? await projectService.getById(run.project_id) : null;
      if (project && run.sprint_branch) {
        const activeDir = path.join("ai_dev_stack", "ai_project_tasks", "active");
        const repoBase = path.isAbsolute(project.clone_path)
          ? project.clone_path
          : path.join(process.cwd(), project.clone_path);
        const absPath = path.join(repoBase, activeDir, "verification_result.json");
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, JSON.stringify(verificationResult, null, 2), "utf-8");
        await projectGitService.commitAll(
          project,
          run.sprint_branch,
          `verify(${taskId}): record ${verificationResult.result} result`
        );
        context.notify(`📊 Verification result committed to \`${activeDir}/\` on \`${run.sprint_branch}\``);
      }
    } catch (err) {
      context.log("Verifier: failed to persist result to repo (non-fatal)", { error: String(err) });
    }

    context.log("Verifier complete", {
      task_id: taskId,
      result: verificationResult.result,
      corrections: requiredCorrections.length,
    });

    const output: VerifierOutput = {
      task_id: taskId,
      passed,
      verification_result_path: verificationResultPath,
      artifact_path: artifactPath,
      handoff,
    };

    return output;
  }

  private resolveCommands(input: Record<string, unknown>): string[] {
    const requested = input.verification_commands;
    if (Array.isArray(requested)) {
      const normalized = requested
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter(Boolean);
      if (normalized.length > 0) return normalized;
    }

    const envRaw = process.env.VERIFIER_COMMANDS ?? "";
    if (envRaw.trim()) {
      return envRaw.split(",").map((c) => c.trim()).filter(Boolean);
    }

    return DEFAULT_VERIFY_COMMANDS;
  }

  private async runCommands(commands: string[], cwd: string, context: ScriptExecutionContext): Promise<CommandResult[]> {
    const results: CommandResult[] = [];

    for (const command of commands) {
      context.log("Verifier executing command", { command, cwd });
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: 600000,
          maxBuffer: 4 * 1024 * 1024,
          env: process.env,
        });

        results.push({
          command,
          ok: true,
          exit_code: 0,
          stdout: (stdout ?? "").slice(0, 12000),
          stderr: (stderr ?? "").slice(0, 12000),
        });
      } catch (error) {
        const err = error as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          message?: string;
        };

        results.push({
          command,
          ok: false,
          exit_code: typeof err.code === "number" ? err.code : 1,
          stdout: (err.stdout ?? "").slice(0, 12000),
          stderr: `${err.stderr ?? ""}${err.message ? `\n${err.message}` : ""}`.slice(0, 12000),
        });

        // Fail fast on first command failure to reduce cost and runtime.
        break;
      }
    }

    return results;
  }

  private async triageFailures(opts: {
    taskId: string;
    commandResults: CommandResult[];
    briefContent?: string;
    taskContent?: string;
    implContent?: string;
  }): Promise<LlmResponse> {
    const systemPrompt = await governanceService.getPrompt("verifier");
    const provider = await llmFactory.forRole("verifier");

    const sections: string[] = [];
    if (opts.briefContent) sections.push(`# AI_IMPLEMENTATION_BRIEF.md\n\n${opts.briefContent}`);
    if (opts.taskContent) sections.push(`# current_task.json\n\n${opts.taskContent}`);
    if (opts.implContent) sections.push(`# implementation_summary.md\n\n${opts.implContent}`);
    sections.push(`# command_results.json\n\n${JSON.stringify(opts.commandResults, null, 2)}`);

    const userContent = `${sections.join("\n\n---\n\n")}\n\nAnalyze command failures and return required corrections.`;

    const llm = await provider.chatJson<LlmResponse>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!llm.summary) {
      return {
        task_id: opts.taskId,
        result: "FAIL",
        summary: "Verification command failed. Review command_results for details.",
        required_corrections: ["Fix failing verifier command output in command_results."],
        handoff: {
          changed_scope: [],
          verification_state: "fail",
          open_risks: ["Verification command failed"],
          next_role_action: "implementer_retry",
          evidence_refs: [],
        },
      };
    }

    return {
      ...llm,
      task_id: llm.task_id || opts.taskId,
      result: "FAIL",
    };
  }

  private extractTaskId(taskJson?: string): string | undefined {
    if (!taskJson) return undefined;
    try {
      const parsed = JSON.parse(taskJson) as { task_id?: string };
      return parsed.task_id;
    } catch {
      return undefined;
    }
  }

  private formatMarkdown(result: VerificationResult, handoff?: HandoffContract): string {
    const status = result.result === "PASS" ? "PASS" : "FAIL";
    const corrections =
      result.required_corrections.length > 0
        ? result.required_corrections.map((c) => `- ${c}`).join("\n")
        : "None — all acceptance criteria met.";
    const commandResults = result.command_results
      .map((r) => `- [${r.ok ? "PASS" : "FAIL"}] \`${r.command}\` (exit=${r.exit_code})`)
      .join("\n");

    const handoffSection = handoff
      ? `\n## Handoff Contract\n\`\`\`json\n${JSON.stringify(handoff, null, 2)}\n\`\`\``
      : "";

    return `# Verification Result: ${result.task_id}

## Status: ${status}

**Verified at:** ${result.verified_at}

## Summary
${result.summary}

## Command Results
${commandResults}

## Required Corrections
${corrections}
${handoffSection}
`;
  }
}

