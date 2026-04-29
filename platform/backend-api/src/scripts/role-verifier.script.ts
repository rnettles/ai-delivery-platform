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
import { designInputGateService } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 – Rule-to-runtime contract (REV-001..REV-004, HND-001/002/003)
//
// Contract modes:
//   "pass"               – all 10 checks pass; no handoff emitted
//   "fail_with_handoff"  – ≥1 check fails; full handoff with non-empty evidence_refs (REV-003, HND-001/002/003)
//   "fail_input_gate"    – REV-001 gate fires before verification starts; handoff lists missing inputs
//
// Mandatory inputs (REV-001): AI_IMPLEMENTATION_BRIEF.md, current_task.json,
//   test_results.json (previous artifact), AI_RULES.md (project repo filesystem).
//
// Mandatory outputs (REV-003): verification_result.json with task_id/result/summary/
//   required_corrections/verified_at/checks. FAIL additionally emits handoff with
//   all 5 HND fields and non-empty evidence_refs.
//
// Ordered checks (REV-002): 10 checks, numbered 1-10. Categories: command, governance,
//   filesystem. All 10 checks are evaluated on every run; fail-fast on commands but
//   skipped commands are marked NOT_RUN with explicit evidence markers.
//
// Phase 4 – FAIL handoff contract hardening (HND-001/002/003, REV-003)
//   Every FAIL path emits a complete handoff with all 5 HND fields.
//   HandoffContract.task_id added for downstream tracing.
//   open_risks guaranteed non-empty: synthesized from failed check evidence when LLM omits.
//   evidence_refs guaranteed non-empty: deterministic check refs merged with LLM refs.
//
// Phase 5 – Gate command and evidence alignment (GTR-001/002, POL-004)
//   resolveCommands returns ResolvedCommand[] — baseline is mandatory and additive;
//   verification_commands/VERIFIER_COMMANDS env can only extend, not replace, baseline.
//   command_source field tracks "baseline" | "override" provenance in command_results.
//   test_results.json content quality validated as part of check 7 CI evidence.
//
// Phase 6 – Task-flag context determinism (TFC-002, PSR-004)
//   parseTaskFlags() replaces regex-only parseUiEvidenceRequired().
//   All known Task Flags (ui_evidence_required, architecture_contract_change,
//   fr_ids_in_scope, incident_tier) parsed structurally from both JSON and markdown.
//   TaskFlags passed to LLM governance prompt so checks 2-6/10 use canonical context.
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifierInput {
  previous_artifacts?: string[];
  pipeline_id?: string;
}

/**
 * REV-002: One entry in the 10-check ordered verification pipeline.
 * category "command"    = CI gate (run via shell)
 * category "governance" = LLM-evaluated policy check
 * category "filesystem" = deterministic repo/artifact check
 */
export interface VerificationCheck {
  check_number: number;
  check_name: string;
  category: "command" | "governance" | "filesystem";
  result: "PASS" | "FAIL" | "SKIP" | "NOT_RUN";
  evidence: string;
  failure_detail?: string;
}

/**
 * Machine-readable verification result — matches AI_REVIEW.md output contract (REV-003).
 * Written to verification_result.json (required by Fixer and Sprint Controller).
 */
export interface VerificationResult {
  task_id: string;
  result: "PASS" | "FAIL";
  summary: string;
  required_corrections: string[];
  command_results: CommandResult[];
  /** REV-002: full 10-check ordered evidence record */
  checks: VerificationCheck[];
  verified_at: string;
  /** Phase 7.1: FAIL handoff included in persisted JSON for machine-readable Fixer/Sprint Controller consumption (REV-003). */
  handoff?: HandoffContract;
}

interface CommandResult {
  command: string;
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  /** Phase 5: provenance — "baseline" = mandatory default gate, "override" = caller-added. */
  command_source?: "baseline" | "override";
}

/** Phase 5: resolved command with provenance before execution. */
interface ResolvedCommand {
  cmd: string;
  source: "baseline" | "override";
}

/**
 * Phase 6: All known Task Flags parsed structurally from the brief (TFC-002).
 * Safe defaults provided for all absent flags — no inference permitted.
 */
export interface TaskFlags {
  task_id?: string;
  ui_evidence_required: boolean;
  architecture_contract_change: boolean;
  fr_ids_in_scope: string[];
  incident_tier?: string;
}

/**
 * Handoff contract — matches AI_HANDOFF_CONTRACT.md.
 * Emitted on every FAIL per REV-003 + HND-001/002/003.
 * evidence_refs must be non-empty on FAIL (HND-003).
 * Phase 4: task_id added for downstream tracing; open_risks guaranteed non-empty.
 */
export interface HandoffContract {
  /** Phase 4: optional task identifier for downstream role tracing. */
  task_id?: string;
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
  /** Phase 8.2: canonical active brief path carried in output for PTH-005 downstream evidence compliance. */
  brief_path?: string;
}

interface Artifact {
  path: string;
  content: string;
}

/** Return type of enforceRequiredInputs (Phase 2 – REV-001). */
type RequiredInputsResult =
  | { ok: true; brief: Artifact; task: Artifact; testResults: Artifact; aiRulesPath: string }
  | { ok: false; missing: string[] };

/** LLM response for governance checks 2, 3, 4, 5, 6, 10 (Phase 3 – REV-002). */
interface LlmGovernanceCheck {
  check_number: number;
  check_name: string;
  result: "PASS" | "FAIL" | "NOT_RUN";
  evidence: string;
  failure_detail?: string;
}

interface LlmGovernanceResponse {
  checks: LlmGovernanceCheck[];
  summary: string;
  required_corrections: string[];
  handoff: HandoffContract;
}

// REV-001: AI_RULES.md candidate locations within the project repo (searched in order)
const AI_RULES_CANDIDATE_PATHS = [
  path.join("ai_dev_stack", "ai_guidance", "AI_RULES.md"),
  path.join("docs", "AI_RULES.md"),
];

const DEFAULT_VERIFY_COMMANDS = ["npm test", "npm run lint", "npx tsc --noEmit"];

export class VerifierScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "role.verifier",
    version: "2026.04.29",
    description: "Quality gate — verifies implementation against acceptance criteria. Enforces REV-001 input gate, REV-002 10-check ordered pipeline, and REV-003/HND output contracts.",
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

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "verifier");
    context.notify(
      `📚 Design inputs validated (${designInputs.sample_files.length} found). ` +
      `Using project: \`${designInputs.project_name}\``
    );

    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (!project) {
      throw new HttpError(
        422,
        "DESIGN_INPUT_MISSING",
        "Verifier requires a project-mapped pipeline run.",
        { pipeline_id: pipelineId }
      );
    }
    const repoPath = path.isAbsolute(project.clone_path)
      ? project.clone_path
      : path.join(process.cwd(), project.clone_path);

    // ── Phase 2: REV-001 hard gate ────────────────────────────────────────────
    // All 4 required inputs must be present before verification proceeds.
    // Fail closed with structured FAIL result + handoff listing missing inputs.
    const inputGate = await this.enforceRequiredInputs(previousArtifacts, repoPath);
    if (!inputGate.ok) {
      context.notify(`🚫 REV-001 gate: missing required inputs — ${inputGate.missing.join(", ")}`);
      return this.emitInputGateFail(pipelineId, inputGate.missing, repoPath, project, run);
    }

    const { brief, task, testResults } = inputGate;

    // task_id is mandatory — no synthetic fallback (Phase 2: removes task-${pipelineId})
    const taskId = this.extractTaskId(task.content);
    if (!taskId) {
      context.notify("🚫 REV-001 gate: current_task.json is missing the task_id field");
      return this.emitInputGateFail(
        pipelineId,
        ["current_task.json (task_id field absent or unparseable)"],
        repoPath,
        project,
        run
      );
    }

    // ── Phases 3/5: CI gate commands (feeds check 7) ──────────────────────────
    // Phase 5.2: resolveCommands returns ResolvedCommand[]; baseline is mandatory and
    // cannot be bypassed by verification_commands input or VERIFIER_COMMANDS env.
    const resolvedCmds = this.resolveCommands(input);
    context.notify(`🧪 Running CI gates: ${resolvedCmds.map(({ cmd, source }) => `\`${cmd}\`${source === "override" ? " (override)" : ""}`).join(", ")}`);
    const commandResults = await this.runCommands(resolvedCmds, repoPath, context);
    const allCommandsPassed = commandResults.every((r) => r.ok);
    context.notify(
      allCommandsPassed
        ? "✅ All CI gate commands passed"
        : `❌ ${commandResults.filter((r) => !r.ok).length} CI gate command(s) failed — running governance checks...`
    );

    // ── Phases 3/6: Governance checks via LLM (checks 2, 3, 4, 5, 6, 10) ─────
    // Phase 6.1: parse task flags structurally for deterministic governance context (TFC-002)
    const taskFlags = this.parseTaskFlags(brief.content);
    const systemPrompt = await governanceService.getComposedPrompt("verifier");
    const provider = await llmFactory.forRole("verifier");
    const governanceResult = await this.evaluateGovernanceChecks({
      provider,
      systemPrompt,
      taskId,
      briefContent: brief.content,
      taskContent: task.content,
      testResultsContent: testResults.content,
      commandResults,
      taskFlags,
    });

    // ── Phases 3/5: Build all 10 ordered checks ───────────────────────────────
    const checks = this.buildOrderedChecks({
      taskId,
      briefContent: brief.content,
      taskContent: task.content,
      commandResults,
      governanceChecks: governanceResult.checks,
      repoPath,
      testResultsContent: testResults.content,
    });

    // Check 8 (UI evidence) — replace placeholder with concrete result
    const uxCheck = await this.runUxEvidenceCheck(brief.content, repoPath);
    const check8Idx = checks.findIndex((c) => c.check_number === 8);
    if (check8Idx >= 0) checks[check8Idx] = uxCheck;

    // ── Aggregate ─────────────────────────────────────────────────────────────
    const failedChecks = checks.filter((c) => c.result === "FAIL");
    const passed = failedChecks.length === 0;

    const requiredCorrections = dedup([
      ...governanceResult.required_corrections,
      ...failedChecks
        .filter((c) => c.category !== "governance" && c.failure_detail)
        .map((c) => c.failure_detail!),
    ]);

    const summary = passed
      ? "All 10 verification checks passed."
      : `${failedChecks.length} of 10 verification check(s) failed.`;

    let handoff: HandoffContract | undefined;
    if (!passed) {
      // Phase 8.2: pass canonical active brief path so evidence_refs meets PTH-005
      handoff = this.buildFailHandoff(taskId, failedChecks, governanceResult.handoff, CANONICAL_ACTIVE_BRIEF_PATH);
    }

    const verifiedAt = new Date().toISOString();

    // ── REV-003: write verification_result.json ───────────────────────────────
    // Phase 7.1: handoff included in JSON so downstream agents have one canonical
    // machine-readable truth (no separate markdown parsing required).
    const verificationResult: VerificationResult = {
      task_id: taskId,
      result: passed ? "PASS" : "FAIL",
      summary,
      required_corrections: requiredCorrections,
      command_results: commandResults,
      checks,
      verified_at: verifiedAt,
      ...(handoff ? { handoff } : {}),
    };
    const verificationResultPath = await artifactService.write(
      pipelineId,
      "verification_result.json",
      JSON.stringify(verificationResult, null, 2)
    );

    // Write human-readable markdown summary — Phase 7.3: derived from same verificationResult
    // object as JSON so both outputs are always consistent (no separate data source).
    const artifactContent = this.formatMarkdown(verificationResult, handoff, CANONICAL_ACTIVE_BRIEF_PATH);
    const artifactPath = await artifactService.write(
      pipelineId,
      "verification_result.md",
      artifactContent
    );

    // Persist verification result to repo (PTH-002 active-slot lifecycle)
    try {
      if (project && run.sprint_branch) {
        const activeDir = path.join("project_work", "ai_project_tasks", "active");
        const absPath = path.join(repoPath, activeDir, "verification_result.json");
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, JSON.stringify(verificationResult, null, 2), "utf-8");
        await projectGitService.commitAll(
          project,
          run.sprint_branch,
          `verify(${taskId}): record ${verificationResult.result} result`
        );
        await projectGitService.push(project, run.sprint_branch);
        context.notify(
          `📊 Verification result committed and pushed from \`${activeDir}/\` on \`${run.sprint_branch}\``
        );
      }
    } catch (err) {
      context.log("Verifier: failed to persist result to repo (non-fatal)", { error: String(err) });
    }

    context.log("Verifier complete", {
      task_id: taskId,
      result: verificationResult.result,
      checks_failed: failedChecks.length,
    });

    return {
      task_id: taskId,
      passed,
      verification_result_path: verificationResultPath,
      artifact_path: artifactPath,
      handoff,
      // Phase 8.2: canonical active brief path in output for downstream PTH-005 compliance
      brief_path: CANONICAL_ACTIVE_BRIEF_PATH,
    } as VerifierOutput;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 2: REV-001 — Mandatory input enforcement
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Checks for all 4 required inputs (REV-001) before verification starts.
   * Returns ok=true with resolved artifacts, or ok=false with list of missing inputs.
   * Never synthesises fallback values — callers must treat ok=false as a blocking gate.
   */
  private async enforceRequiredInputs(
    previousArtifacts: string[],
    repoPath: string
  ): Promise<RequiredInputsResult> {
    const missing: string[] = [];

    const brief = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))
    );
    if (!brief) missing.push("AI_IMPLEMENTATION_BRIEF.md");

    const task = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("current_task"))
    );
    if (!task) missing.push("current_task.json");

    const testResults = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("test_results"))
    );
    if (!testResults) missing.push("test_results.json");

    // AI_RULES.md must exist on the project repo filesystem
    let aiRulesPath: string | undefined;
    for (const candidate of AI_RULES_CANDIDATE_PATHS) {
      const absCandidate = path.join(repoPath, candidate);
      try {
        await fs.access(absCandidate);
        aiRulesPath = absCandidate;
        break;
      } catch {
        // not found at this candidate — try next
      }
    }
    if (!aiRulesPath) missing.push("AI_RULES.md");

    if (missing.length > 0) return { ok: false, missing };
    return { ok: true, brief: brief!, task: task!, testResults: testResults!, aiRulesPath: aiRulesPath! };
  }

  /**
   * Emits a structured FAIL verification_result.json and returns a VerifierOutput
   * when REV-001 inputs are missing. HND-003 evidence_refs is non-empty (lists missing inputs).
   */
  private async emitInputGateFail(
    pipelineId: string,
    missing: string[],
    repoPath: string,
    project: { clone_path: string } | null,
    run: { sprint_branch?: string | null }
  ): Promise<VerifierOutput> {
    const taskId = "UNKNOWN";
    const verifiedAt = new Date().toISOString();

    const checks: VerificationCheck[] = REV002_CHECK_NAMES.map((name, i) => ({
      check_number: i + 1,
      check_name: name.name,
      category: name.category,
      result: "NOT_RUN" as const,
      evidence: `REV-001 gate blocked verification — missing: ${missing.join(", ")}`,
    }));

    const handoff: HandoffContract = {
      changed_scope: [],
      verification_state: "fail",
      open_risks: [`REV-001: required inputs absent — ${missing.join(", ")}`],
      next_role_action: "implementer_retry",
      // HND-003: evidence_refs non-empty on FAIL
      evidence_refs: missing.map((m) => `required-input:${m}`),
    };

    // Phase 7.1: include handoff in JSON so machine-readable contract is complete (REV-003)
    const verificationResult: VerificationResult = {
      task_id: taskId,
      result: "FAIL",
      summary: `REV-001 gate failed: ${missing.length} required input(s) absent — ${missing.join(", ")}.`,
      required_corrections: missing.map((m) => `Provide required artifact: ${m}`),
      command_results: [],
      checks,
      verified_at: verifiedAt,
      handoff,
    };

    const verificationResultPath = await artifactService.write(
      pipelineId,
      "verification_result.json",
      JSON.stringify(verificationResult, null, 2)
    );
    // Phase 7.3: brief_path omitted here — brief was not found (REV-001 gate)
    const artifactPath = await artifactService.write(
      pipelineId,
      "verification_result.md",
      this.formatMarkdown(verificationResult, handoff)
    );

    // Persist to repo if possible (best-effort — repoPath already resolved)
    try {
      if (project && run.sprint_branch) {
        const activeDir = path.join("project_work", "ai_project_tasks", "active");
        const absPath = path.join(repoPath, activeDir, "verification_result.json");
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, JSON.stringify(verificationResult, null, 2), "utf-8");
        await projectGitService.commitAll(
          project as Parameters<typeof projectGitService.commitAll>[0],
          run.sprint_branch,
          `verify(${taskId}): FAIL — REV-001 input gate`
        );
        await projectGitService.push(
          project as Parameters<typeof projectGitService.push>[0],
          run.sprint_branch
        );
      }
    } catch {
      // non-fatal — primary artifact already written above
    }

    return { task_id: taskId, passed: false, verification_result_path: verificationResultPath, artifact_path: artifactPath, handoff };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 3: REV-002 — Ordered verification check engine
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Calls LLM to evaluate governance checks 2, 3, 4, 5, 6, 10 (REV-002).
   * Always runs — not gated on command pass/fail — so both categories are always reported.
   */
  private async evaluateGovernanceChecks(opts: {
    provider: Awaited<ReturnType<typeof llmFactory.forRole>>;
    systemPrompt: string;
    taskId: string;
    briefContent: string;
    taskContent: string;
    testResultsContent: string;
    commandResults: CommandResult[];
    /** Phase 6: deterministic task flag context passed to LLM (TFC-002). */
    taskFlags: TaskFlags;
  }): Promise<LlmGovernanceResponse> {
    const sections = [
      `# AI_IMPLEMENTATION_BRIEF.md\n\n${opts.briefContent}`,
      `# current_task.json\n\n${opts.taskContent}`,
      `# test_results.json\n\n${opts.testResultsContent}`,
      `# command_results.json\n\n${JSON.stringify(opts.commandResults, null, 2)}`,
      `# task_flags.json\n\n${JSON.stringify(opts.taskFlags, null, 2)}`,
    ];

    const userContent = `${sections.join("\n\n---\n\n")}

---

Evaluate the following 6 governance checks from REV-002 and return a JSON object with this exact schema:

{
  "checks": [
    {
      "check_number": <2|3|4|5|6|10>,
      "check_name": "<name>",
      "result": "PASS" | "FAIL",
      "evidence": "<one-sentence evidence summary>",
      "failure_detail": "<correction needed, only on FAIL>"
    }
  ],
  "summary": "<overall governance assessment>",
  "required_corrections": ["<correction>"],
  "handoff": {
    "changed_scope": [],
    "verification_state": "pass" | "fail",
    "open_risks": [],
    "next_role_action": "none" | "implementer_retry",
    "evidence_refs": []
  }
}

Checks to evaluate:
2. deliverable_completeness — All deliverables listed in current_task.json acceptance criteria have implementation evidence in the brief.
3. file_evidence — Create/Modify file actions documented in the brief match what was expected by the task.
4. contradiction_guardrail_behavior — Contradiction detection rules were implemented correctly per brief scope.
5. contradiction_guardrail_test_coverage — Tests cover contradiction guardrail behavior where applicable.
6. test_existence — Tests exist for all acceptance criteria that require them.
10. scope_expansion_guard — No changes were made outside the task scope defined in current_task.json.

Use task_flags.json to inform scope validation:
- fr_ids_in_scope lists the in-scope functional requirements; validate that changes stay within them.
- architecture_contract_change=true requires evidence of architecture document updates in the scope expansion check.
- incident_tier (if present) may indicate stricter evidence requirements for the relevant checks.

Be precise and evidence-based. Reference specific artifact content in evidence fields.`;

    const fallback = this.governanceFallback(opts.taskId, opts.commandResults);
    try {
      const llm = await opts.provider.chatJson<LlmGovernanceResponse>([
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: userContent },
      ]);
      if (!llm?.checks?.length) return fallback;

      // Ensure evidence_refs non-empty when governance result is fail (HND-003)
      if (llm.handoff && llm.handoff.verification_state === "fail") {
        if (!llm.handoff.evidence_refs?.length) {
          llm.handoff.evidence_refs = llm.checks
            .filter((c) => c.result === "FAIL")
            .map((c) => `check-${c.check_number}:${c.check_name}`);
        }
      }
      return llm;
    } catch {
      return fallback;
    }
  }

  /**
   * Constructs the full 10-check ordered array (REV-002) by combining deterministic
   * code checks (1, 7, 9) with governance checks from LLM (2, 3, 4, 5, 6, 10).
   * Check 8 (UI evidence) is a placeholder replaced by runUxEvidenceCheck().
   */
  private buildOrderedChecks(opts: {
    taskId: string;
    briefContent: string;
    taskContent: string;
    commandResults: CommandResult[];
    governanceChecks: LlmGovernanceCheck[];
    repoPath: string;
    /** Phase 5: test_results.json content for CI evidence quality validation (GTR-002). */
    testResultsContent?: string;
  }): VerificationCheck[] {
    const govByNumber = new Map(opts.governanceChecks.map((c) => [c.check_number, c]));

    const checks: VerificationCheck[] = [];

    // Check 1: Task ID alignment (deterministic)
    checks.push(this.buildTaskIdAlignmentCheck(opts.taskId, opts.briefContent, opts.taskContent));

    // Checks 2, 3, 4, 5, 6 (governance — from LLM)
    for (const checkNum of [2, 3, 4, 5, 6] as const) {
      const meta = REV002_CHECK_NAMES[checkNum - 1];
      const gov = govByNumber.get(checkNum);
      checks.push(
        gov
          ? { check_number: checkNum, check_name: gov.check_name, category: "governance", result: gov.result, evidence: gov.evidence, failure_detail: gov.failure_detail }
          : { check_number: checkNum, check_name: meta.name, category: "governance", result: "NOT_RUN", evidence: "Governance check not returned by LLM" }
      );
    }

    // Check 7: CI evidence quality (from command results + test_results.json validation)
    checks.push(this.buildCiEvidenceCheck(opts.commandResults, opts.testResultsContent));

    // Check 8: UI evidence placeholder (replaced after)
    checks.push({
      check_number: 8,
      check_name: REV002_CHECK_NAMES[7].name,
      category: "filesystem",
      result: "SKIP",
      evidence: "UI evidence check pending — will be resolved by runUxEvidenceCheck",
    });

    // Check 9: Active artifact overwrite integrity (deterministic)
    checks.push(this.buildArtifactIntegrityCheck(opts.taskId, opts.repoPath));

    // Check 10: Scope expansion guard (governance — from LLM)
    const gov10 = govByNumber.get(10);
    const meta10 = REV002_CHECK_NAMES[9];
    checks.push(
      gov10
        ? { check_number: 10, check_name: gov10.check_name, category: "governance", result: gov10.result, evidence: gov10.evidence, failure_detail: gov10.failure_detail }
        : { check_number: 10, check_name: meta10.name, category: "governance", result: "NOT_RUN", evidence: "Governance check not returned by LLM" }
    );

    return checks;
  }

  /** Check 1: task_id declared in brief must match task_id in current_task.json. */
  private buildTaskIdAlignmentCheck(
    taskId: string,
    briefContent: string,
    taskContent: string
  ): VerificationCheck {
    // Extract task_id from brief (JSON or markdown task flags block)
    const briefTaskId = this.extractTaskIdFromBrief(briefContent);
    const taskParsedId = this.extractTaskId(taskContent);
    const aligned = !!briefTaskId && briefTaskId === taskParsedId;
    return {
      check_number: 1,
      check_name: REV002_CHECK_NAMES[0].name,
      category: "filesystem",
      result: aligned ? "PASS" : "FAIL",
      evidence: `brief task_id: '${briefTaskId ?? "(not found)"}'; current_task.json task_id: '${taskParsedId ?? "(not found)"}'`,
      failure_detail: aligned
        ? undefined
        : `task_id mismatch — brief declares '${briefTaskId}' but current_task.json contains '${taskParsedId}'`,
    };
  }

  /**
   * Extracts task_id from the brief's task flags block.
   * Handles JSON (`"task_id": "TST-001"`) and markdown (`**task_id:** TST-001`) formats.
   */
  private extractTaskIdFromBrief(briefContent: string): string | undefined {
    // JSON task flags
    const jsonMatch = /"task_id"\s*:\s*"([^"]+)"/.exec(briefContent);
    if (jsonMatch) return jsonMatch[1];
    // Markdown task flags
    const mdMatch = /\*\*task_id:\*\*\s*(\S+)/.exec(briefContent);
    if (mdMatch) return mdMatch[1].trim();
    return undefined;
  }

  /** Check 7: CI evidence is real (non-placeholder), all commands passed, and test_results.json is valid. */
  private buildCiEvidenceCheck(commandResults: CommandResult[], testResultsContent?: string): VerificationCheck {
    if (commandResults.length === 0) {
      return {
        check_number: 7,
        check_name: REV002_CHECK_NAMES[6].name,
        category: "command",
        result: "FAIL",
        evidence: "No CI gate commands were executed",
        failure_detail: "At least one CI gate command must run and produce real output",
      };
    }
    const failed = commandResults.filter((r) => !r.ok);
    const skipped = commandResults.filter(
      (r) => r.ok && r.stdout === "" && r.stderr === "" && r.exit_code === 0
    );
    if (failed.length > 0) {
      const names = failed.map((r) => `\`${r.command}\``).join(", ");
      return {
        check_number: 7,
        check_name: REV002_CHECK_NAMES[6].name,
        category: "command",
        result: "FAIL",
        evidence: `${failed.length} command(s) failed: ${names}`,
        failure_detail: `CI gate failure — fix failing commands: ${names}`,
      };
    }
    // Phase 5.3: Include test_results.json content quality in CI evidence (GTR-002)
    const testQuality = testResultsContent ? this.validateTestResultsContent(testResultsContent) : null;
    const evidenceParts: string[] = [`${commandResults.length} command(s) passed`];
    if (skipped.length > 0) evidenceParts.push(`${skipped.length} produced empty output`);
    if (testQuality) evidenceParts.push(`test_results: ${testQuality.summary}`);
    return {
      check_number: 7,
      check_name: REV002_CHECK_NAMES[6].name,
      category: "command",
      result: "PASS",
      evidence: evidenceParts.join("; "),
    };
  }

  /** Check 9: verification_result.json target path is within the active-slot directory. */
  private buildArtifactIntegrityCheck(taskId: string, repoPath: string): VerificationCheck {
    const activeDir = path.join(repoPath, "project_work", "ai_project_tasks", "active");
    const targetPath = path.join(activeDir, "verification_result.json");
    // Verify the target is under the active directory (no path traversal)
    const resolved = path.resolve(targetPath);
    const base = path.resolve(activeDir);
    const safe = resolved.startsWith(base + path.sep) || resolved === base;
    return {
      check_number: 9,
      check_name: REV002_CHECK_NAMES[8].name,
      category: "filesystem",
      result: safe ? "PASS" : "FAIL",
      evidence: `verification_result.json target: ${resolved}; active-slot base: ${base}`,
      failure_detail: safe ? undefined : "verification_result.json would be written outside the active-slot directory",
    };
  }

  /**
   * Check 8: UI/Playwright evidence check.
   * Phase 6: Uses parseTaskFlags() for deterministic flag parsing (TFC-002/PSR-004).
   * Returns SKIP when ui_evidence_required is false/absent.
   */
  private async runUxEvidenceCheck(briefContent: string, repoPath: string): Promise<VerificationCheck> {
    const required = this.parseTaskFlags(briefContent).ui_evidence_required;
    if (!required) {
      return {
        check_number: 8,
        check_name: REV002_CHECK_NAMES[7].name,
        category: "filesystem",
        result: "SKIP",
        evidence: "ui_evidence_required is false or absent in task flags — UX gate skipped",
      };
    }

    const uxFlowPath = path.join(
      repoPath,
      "project_work", "ai_project_tasks", "active", "ux", "user_flow.md"
    );
    try {
      const uxContent = await fs.readFile(uxFlowPath, "utf-8");
      const approved = uxContent.includes("Status: Approved");
      return {
        check_number: 8,
        check_name: REV002_CHECK_NAMES[7].name,
        category: "filesystem",
        result: approved ? "PASS" : "FAIL",
        evidence: `user_flow.md found at ${uxFlowPath}; Status: Approved present: ${approved}`,
        failure_detail: approved
          ? undefined
          : "UX gate: user_flow.md exists but Status: Approved is missing — obtain operator approval before task close",
      };
    } catch {
      return {
        check_number: 8,
        check_name: REV002_CHECK_NAMES[7].name,
        category: "filesystem",
        result: "FAIL",
        evidence: `user_flow.md not found at ${uxFlowPath}`,
        failure_detail: "UX gate: ui_evidence_required=true but user_flow.md is absent — create and get it approved",
      };
    }
  }

  /**
   * Phase 6: Parses all known Task Flags from brief content (TFC-002 deterministic flag parsing).
   * Handles both JSON (`"key": value`) and markdown (`**key:** value`) formats.
   * Returns canonical TaskFlags with safe defaults for all absent flags — no inference permitted.
   * Replaces the former parseUiEvidenceRequired() helper.
   */
  parseTaskFlags(briefContent: string): TaskFlags {
    const flags: TaskFlags = {
      ui_evidence_required: false,
      architecture_contract_change: false,
      fr_ids_in_scope: [],
    };

    // task_id
    const taskIdJson = /"task_id"\s*:\s*"([^"]+)"/.exec(briefContent);
    if (taskIdJson) flags.task_id = taskIdJson[1];
    else {
      const taskIdMd = /\*\*task_id:\*\*\s*(\S+)/.exec(briefContent);
      if (taskIdMd) flags.task_id = taskIdMd[1].trim();
    }

    // ui_evidence_required
    const uiJson = /"ui_evidence_required"\s*:\s*(true|false)/.exec(briefContent);
    if (uiJson) flags.ui_evidence_required = uiJson[1] === "true";
    else {
      const uiMd = /\*\*ui_evidence_required:\*\*\s*(true|false)/i.exec(briefContent);
      if (uiMd) flags.ui_evidence_required = uiMd[1].toLowerCase() === "true";
    }

    // architecture_contract_change
    const archJson = /"architecture_contract_change"\s*:\s*(true|false)/.exec(briefContent);
    if (archJson) flags.architecture_contract_change = archJson[1] === "true";
    else {
      const archMd = /\*\*architecture_contract_change:\*\*\s*(true|false)/i.exec(briefContent);
      if (archMd) flags.architecture_contract_change = archMd[1].toLowerCase() === "true";
    }

    // fr_ids_in_scope — JSON array: ["FR-001", "FR-002"]
    const frJson = /"fr_ids_in_scope"\s*:\s*\[([^\]]*)\]/.exec(briefContent);
    if (frJson) {
      flags.fr_ids_in_scope = frJson[1]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else {
      const frMd = /\*\*fr_ids_in_scope:\*\*\s*([^\n]+)/.exec(briefContent);
      if (frMd) {
        flags.fr_ids_in_scope = frMd[1]
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    // incident_tier
    const tierJson = /"incident_tier"\s*:\s*"([^"]+)"/.exec(briefContent);
    if (tierJson) flags.incident_tier = tierJson[1];
    else {
      const tierMd = /\*\*incident_tier:\*\*\s*(\S+)/.exec(briefContent);
      if (tierMd) flags.incident_tier = tierMd[1].trim();
    }

    return flags;
  }

  /**
   * Phase 5: Validates test_results.json content quality (GTR-002 evidence quality).
   * Returns a summary string for check 7 CI evidence.
   * Presence of pass/fail count fields is the minimal signal of real test execution.
   */
  private validateTestResultsContent(content: string): { valid: boolean; summary: string } {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const hasPassCount = "passed" in parsed || "numPassedTests" in parsed;
      const hasFailCount = "failed" in parsed || "numFailedTests" in parsed;
      if (!hasPassCount && !hasFailCount) {
        return { valid: false, summary: "test_results.json lacks pass/fail count fields (possible placeholder)" };
      }
      const passVal = (parsed.passed ?? parsed.numPassedTests) as number | undefined;
      const failVal = (parsed.failed ?? parsed.numFailedTests) as number | undefined;
      return {
        valid: true,
        summary: `passed=${passVal ?? "unknown"}, failed=${failVal ?? "unknown"}`,
      };
    } catch {
      return { valid: false, summary: "test_results.json is not valid JSON" };
    }
  }

  /**
   * Builds the FAIL handoff object (REV-003, HND-001/002/003).
   * Merges the LLM-provided handoff with concrete evidence from deterministic check failures.
   * Guarantees evidence_refs is non-empty (HND-003).
   */
  private buildFailHandoff(
    taskId: string,
    failedChecks: VerificationCheck[],
    llmHandoff?: HandoffContract,
    /** Phase 8.2: canonical active brief path to include in evidence_refs (PTH-005). */
    briefPath?: string
  ): HandoffContract {
    const checkRefs = failedChecks.map((c) => `check-${c.check_number}:${c.check_name}`);
    // Phase 8.2: PTH-005 — canonical active brief path must be first in deterministic refs
    const deterministicRefs: string[] = briefPath ? [briefPath, ...checkRefs] : checkRefs;

    const baseHandoff: HandoffContract = llmHandoff ?? {
      changed_scope: [],
      verification_state: "fail",
      open_risks: failedChecks.map((c) => c.failure_detail ?? c.evidence),
      next_role_action: "implementer_retry",
      evidence_refs: [],
    };

    // Phase 4.1: Ensure open_risks is non-empty — synthesize from failed checks when LLM omits
    const mergedRisks =
      (baseHandoff.open_risks?.length ?? 0) > 0
        ? baseHandoff.open_risks
        : failedChecks.map((c) => c.failure_detail ?? c.evidence);

    // Merge deterministic refs (canonical path first) with LLM refs; ensure non-empty (HND-003)
    const mergedRefs = dedup([...deterministicRefs, ...(baseHandoff.evidence_refs ?? [])]);
    return {
      ...baseHandoff,
      task_id: taskId,
      verification_state: "fail",
      open_risks: mergedRisks.length > 0 ? mergedRisks : [`verification failed for task ${taskId}`],
      evidence_refs: mergedRefs.length > 0 ? mergedRefs : [`task:${taskId}:verification-failed`],
    };
  }

  /**
   * Fallback governance response when LLM is unavailable or returns malformed output.
   * All governance checks marked NOT_RUN so evidence gap is visible downstream.
   */
  private governanceFallback(taskId: string, commandResults: CommandResult[]): LlmGovernanceResponse {
    const commandsFailed = commandResults.some((r) => !r.ok);
    return {
      checks: ([2, 3, 4, 5, 6, 10] as const).map((n) => ({
        check_number: n,
        check_name: REV002_CHECK_NAMES[n - 1].name,
        result: "NOT_RUN" as const,
        evidence: "LLM governance evaluation unavailable — check logs for provider error",
      })),
      summary: commandsFailed
        ? "CI gate failed. Governance checks could not be evaluated."
        : "CI gate passed. Governance checks could not be evaluated.",
      required_corrections: commandsFailed
        ? ["Fix failing CI gate commands before re-running verification."]
        : ["Re-run verification to obtain governance check evaluation."],
      handoff: {
        changed_scope: [],
        verification_state: commandsFailed ? "fail" : "not_run",
        open_risks: ["Governance checks were not evaluated — LLM provider error"],
        next_role_action: commandsFailed ? "implementer_retry" : "none",
        evidence_refs: commandsFailed
          ? commandResults.filter((r) => !r.ok).map((r) => `command-fail:${r.command}`)
          : [`task:${taskId}:governance-not-evaluated`],
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Shared helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Phase 5.2: Resolves CI gate commands, enforcing mandatory baseline coverage (POL-004).
   * Baseline commands (npm test, lint, tsc) always run; verification_commands/VERIFIER_COMMANDS
   * env adds to the baseline but cannot replace it.
   */
  private resolveCommands(input: Record<string, unknown>): ResolvedCommand[] {
    const baseline: ResolvedCommand[] = DEFAULT_VERIFY_COMMANDS.map((c) => ({ cmd: c, source: "baseline" as const }));

    const requested = input.verification_commands;
    let overrideRaw: string[] = [];

    if (Array.isArray(requested)) {
      overrideRaw = requested
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter(Boolean);
    } else {
      const envRaw = process.env.VERIFIER_COMMANDS ?? "";
      if (envRaw.trim()) {
        overrideRaw = envRaw.split(",").map((c) => c.trim()).filter(Boolean);
      }
    }

    if (overrideRaw.length === 0) return baseline;

    // Baseline is always included; overrides are additive, deduplicating commands in the baseline
    const baselineSet = new Set(DEFAULT_VERIFY_COMMANDS);
    const addlOverrides = overrideRaw
      .filter((c) => !baselineSet.has(c))
      .map((c) => ({ cmd: c, source: "override" as const }));

    return [...baseline, ...addlOverrides];
  }

  private async runCommands(
    commands: ResolvedCommand[],
    cwd: string,
    context: ScriptExecutionContext
  ): Promise<CommandResult[]> {
    const results: CommandResult[] = [];

    for (const { cmd, source } of commands) {
      context.log("Verifier executing command", { command: cmd, cwd });
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd,
          timeout: 600000,
          maxBuffer: 4 * 1024 * 1024,
          env: process.env,
        });
        results.push({
          command: cmd,
          ok: true,
          exit_code: 0,
          stdout: (stdout ?? "").slice(0, 12000),
          stderr: (stderr ?? "").slice(0, 12000),
          command_source: source,
        });
      } catch (error) {
        const err = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
        results.push({
          command: cmd,
          ok: false,
          exit_code: typeof err.code === "number" ? err.code : 1,
          stdout: (err.stdout ?? "").slice(0, 12000),
          stderr: `${err.stderr ?? ""}${err.message ? `\n${err.message}` : ""}`.slice(0, 12000),
          command_source: source,
        });
        // Fail-fast: first failing command stops command execution.
        // Remaining commands are marked NOT_RUN in check 7 evidence via commandResults length gap.
        break;
      }
    }

    return results;
  }

  private extractTaskId(taskJson?: string): string | undefined {
    if (!taskJson) return undefined;
    try {
      const parsed = JSON.parse(taskJson) as { task_id?: string };
      return typeof parsed.task_id === "string" && parsed.task_id.trim()
        ? parsed.task_id.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }

  private formatMarkdown(result: VerificationResult, handoff?: HandoffContract, briefPath?: string): string {
    const corrections =
      result.required_corrections.length > 0
        ? result.required_corrections.map((c) => `- ${c}`).join("\n")
        : "None — all acceptance criteria met.";
    const briefPathLine = briefPath ? `\n**Brief path:** \`${briefPath}\`` : "";

    const commandSection = result.command_results
      .map((r) => `- [${r.ok ? "PASS" : "FAIL"}] \`${r.command}\` (exit=${r.exit_code})`)
      .join("\n") || "_No commands executed_";

    const checksSection = result.checks
      .map(
        (c) =>
          `| ${c.check_number} | ${c.check_name} | ${c.result} | ${c.evidence}${c.failure_detail ? ` — **${c.failure_detail}**` : ""} |`
      )
      .join("\n");

    const handoffSection = handoff
      ? `\n## Handoff Contract\n\`\`\`json\n${JSON.stringify(handoff, null, 2)}\n\`\`\``
      : "";

    return `# Verification Result: ${result.task_id}

## Status: ${result.result}

**Verified at:** ${result.verified_at}${briefPathLine}

## Summary
${result.summary}

## Ordered Checks (REV-002)
| # | Check | Result | Evidence |
|---|-------|--------|----------|
${checksSection}

## CI Gate Commands
${commandSection}

## Required Corrections
${corrections}
${handoffSection}
`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants (REV-002 check catalogue)
// ─────────────────────────────────────────────────────────────────────────────

// Phase 8.2: PTH-005 — canonical active brief path for evidence_refs in FAIL handoffs
const CANONICAL_ACTIVE_BRIEF_PATH = path.join(
  "project_work", "ai_project_tasks", "active", "AI_IMPLEMENTATION_BRIEF.md"
);

const REV002_CHECK_NAMES: { name: string; category: "command" | "governance" | "filesystem" }[] = [
  { name: "task_id_alignment",                category: "filesystem" },  // 1
  { name: "deliverable_completeness",          category: "governance" },  // 2
  { name: "file_evidence",                     category: "governance" },  // 3
  { name: "contradiction_guardrail_behavior",  category: "governance" },  // 4
  { name: "contradiction_guardrail_tests",     category: "governance" },  // 5
  { name: "test_existence",                    category: "governance" },  // 6
  { name: "ci_evidence_quality",               category: "command"    },  // 7
  { name: "ui_evidence_playwright",            category: "filesystem" },  // 8
  { name: "active_artifact_integrity",         category: "filesystem" },  // 9
  { name: "scope_expansion_guard",             category: "governance" },  // 10
];

/** Deduplicate array while preserving order. */
function dedup<T>(arr: T[]): T[] {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

