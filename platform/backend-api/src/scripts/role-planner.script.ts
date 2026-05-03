import fs from "fs/promises";
import path from "path";
import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { githubApiService } from "../services/github-api.service";
import { prRemediationService } from "../services/pr-remediation.service";
import { designInputGateService, EntryMode, DesignInputGateResult } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";
import { buildProjectPreamble } from "../utils/prompt-preamble";
import { sprintPlanValidatorService } from "../services/sprint-plan-validator.service";
import { sprintPlanRendererService } from "../services/sprint-plan-renderer.service";
import type { RichSprintLlmResponse } from "../domain/sprint-plan.types";
import { logger } from "../services/logger.service";

export interface PlannerInput {
  description: string;
  project_context?: string;
  previous_artifacts?: string[];
  pipeline_id?: string;
  entry_mode?: EntryMode;
  execution_mode?: string;
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
  /** FR identifiers from the loaded FR/PRD documents that this phase addresses. Must not be empty. */
  fr_ids_in_scope: string[];
  /** Design artifacts required before this phase can advance to Planning (TDNs, ADRs, Spikes) */
  required_design_artifacts: Array<{
    type: "TDN" | "ADR" | "Spike";
    title: string;
    status: "Required" | "Exists" | "Approved";
  }>;
  status: "Draft" | "Active" | "Complete";
}

export interface PlannerOutput {
  phase_id?: string;
  phase_plan?: PlannerPhasePlan;
  artifact_path: string;
  sprint_plan_path?: string;
  closeout_mode?: "sprint";
  pr_number?: number;
  pr_url?: string;
  sprint_branch?: string;
}

interface PlannerCloseoutContext {
  closeout: PlannerOutput;
  metadata: {
    reused_closeout_artifact: boolean;
    reused_existing_pr: boolean;
  };
}

type NextModeState =
  | { kind: "open_sprint"; sprint: { sprint_id: string; status: string; sprint_plan_path: string } }
  | { kind: "sprint_ready"; phasePlan: { content: string; filePath: string } }
  | { kind: "needs_fr_evaluation" }
  | { kind: "phase_planning" }
  | { kind: "no_work" };

const SPRINT_READY_PHASE_STATUSES = new Set(["Planning", "Approved"]);
const OPEN_SPRINT_STATUSES = new Set(["staged", "Planning", "Active", "ready_for_verification"]);
const APPROVED_STATUSES = new Set(["approved", "accepted"]);

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
      required: ["artifact_path"],
      properties: {
        phase_id: { type: "string" },
        phase_plan: { type: "object" },
        artifact_path: { type: "string" },
        closeout_mode: { type: "string" },
        pr_number: { type: "number" },
        pr_url: { type: "string" },
        sprint_branch: { type: "string" },
      },
    },
    tags: ["role", "planner", "planning"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<PlannerInput>;
    const description = typed.description?.trim() || "Unspecified objective";
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;
    const entryMode: EntryMode = typed.entry_mode === "intake" ? "intake" : "plan";
    const executionMode = typed.execution_mode as string | undefined;
    const previousArtifacts = typed.previous_artifacts ?? [];

    const verificationArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("verification_result.json"))
    );
    const sprintCloseOutArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_closeout.json"))
    );

    let closeoutContext: PlannerCloseoutContext | undefined;

    if (verificationArtifact && sprintCloseOutArtifact) {
      closeoutContext = await this.runSprintCloseOut(
        pipelineId,
        previousArtifacts,
        verificationArtifact.content,
        sprintCloseOutArtifact.content,
        context
      );

      if (executionMode !== "next") {
        return closeoutContext.closeout;
      }

      context.notify("✅ Sprint closeout complete. Evaluating next Planner step...");
    }

    // Sprint planning mode: execution_mode "next" resolves in a strict order.
    if (executionMode === "next") {
      const nextState = await this.resolveNextModeState(pipelineId);
      if (nextState.kind === "open_sprint") {
        this.throwOpenSprintExists(nextState.sprint, executionMode);
      }

      if (nextState.kind === "sprint_ready") {
        context.log("Planner sprint planning mode detected", { execution_mode: executionMode });
        return this.runSprintPlanning(pipelineId, nextState.phasePlan.content, description, context);
      }

      if (closeoutContext?.metadata.reused_closeout_artifact) {
        context.log("Planner next mode: detected prior closeout artifact and continuing decision flow", {
          execution_mode: executionMode,
          closeout_artifact: closeoutContext.closeout.artifact_path,
        });
      }

      context.log("Planner next mode: no Planning-status phases found, will check for unclaimed FRs");
    }

    context.log("Planner running", { description_length: description.length, execution_mode: executionMode });
    context.notify(`📋 Planning delivery phase...\n> _${description.slice(0, 120)}${description.length > 120 ? "…" : ""}_`);

    // Pre-condition: no open phase exists (process_invariants §Phase Lifecycle Gates, ADR-031)
    try {
      const staged = await pipelineService.listStagedPhases(pipelineId);
      const OPEN_PHASE_STATUSES = ["Draft", "Planning", "Approved", "Active"];
      const openPhase = staged.phases.find((p) => OPEN_PHASE_STATUSES.includes(p.status));
      if (openPhase) {
        throw new HttpError(
          409,
          "OPEN_PHASE_EXISTS",
          `A phase is already open (${openPhase.phase_id}, status: ${openPhase.status}). ` +
            "Close or supersede it before staging a new phase (process_invariants §Phase Lifecycle Gates).",
          { phase_id: openPhase.phase_id, status: openPhase.status }
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Artifact read failure (e.g., no prior artifacts on a fresh pipeline) is non-fatal.
      context.log("Planner: open-phase pre-condition check skipped", { reason: String(err) });
    }

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "planner", entryMode, "planner");
    context.notify(
      `📚 Design inputs loaded: ${designInputs.fr_context.length} FR/PRD, ` +
      `${designInputs.adr_context.length} ADR, ${designInputs.tdn_context.length} TDN file(s) ` +
      `from project \`${designInputs.project_name}\``
    );

    // Read already-claimed FR IDs from existing phase plans in the project repo
    const stagedPhasesDir = path.join(
      designInputs.clone_path,
      "project_work",
      "ai_project_tasks",
      "staged_phases"
    );
    const claimedFrIds = await this.readClaimedFrIds(stagedPhasesDir);
    
    // In next mode, provide comprehensive status before proceeding
    if (executionMode === "next") {
      const planningPhases = await this.findAllPhases(pipelineId);
      const planningCount = planningPhases.filter((p) => SPRINT_READY_PHASE_STATUSES.has(p.status ?? "")).length;
      const unclaimedFrIds = [...new Set(designInputs.fr_context.flatMap((f) => this.extractFrIds(f.content)))]
        .filter((id) => !claimedFrIds.includes(id));

      const statusLines = [
        `**Sprint-ready phases:** ${planningCount} (Status: Planning or Approved)`,
        `**Unclaimed FRs:** ${unclaimedFrIds.length} (available for new phase planning)`,
      ];

      const nextState = await this.resolveNextModeState(pipelineId, unclaimedFrIds.length);
      if (nextState.kind === "open_sprint") {
        this.throwOpenSprintExists(nextState.sprint, executionMode);
      }

      if (nextState.kind === "sprint_ready") {
        context.log("Planner next mode: sprint-ready phase became available during FR evaluation", {
          execution_mode: executionMode,
        });
        return this.runSprintPlanning(pipelineId, nextState.phasePlan.content, description, context);
      }

      if (nextState.kind === "no_work") {
        throw new HttpError(
          409,
          "NO_WORK_AVAILABLE",
          statusLines.join("\n") + 
          "\n\nNo work available: approve a phase plan to stage a sprint, or add new FR work to plan additional phases.",
          { planning_phases: planningCount, unclaimed_frs: unclaimedFrIds.length, execution_mode: executionMode }
        );
      }

      if (nextState.kind === "phase_planning") {
        // In next mode, unclaimed FRs mean Planner should draft the next logical phase.
        context.notify(`ℹ️ ${statusLines.join(" | ")} — No sprint-ready phase found; drafting the next phase.`);
      }

      if (planningCount > 0 && unclaimedFrIds.length === 0) {
        context.notify(`✅ ${statusLines.join(" | ")} — Ready to stage sprint`);
        // Continue to sprint planning (already handled above by return)
      }

      if (planningCount > 0 && unclaimedFrIds.length > 0) {
        context.notify(`✅ ${statusLines.join(" | ")} — Multiple options available`);
        // Continue to sprint planning (already handled above by return)
      }
    }
    
    if (claimedFrIds.length > 0) {
      context.notify(`🗂️ Existing phase plans claim ${claimedFrIds.length} FR ID(s): ${claimedFrIds.join(", ")}`);
    }

    // Build LLM user message: FR docs → ADR docs → TDN docs → claimed FRs → planning request
    const frSection = designInputs.fr_context.length > 0
      ? `# Functional Requirements & PRD Documents\n\n` +
        `The following documents define what must be built. ` +
        `Your phase plan MUST reference FR identifiers from these documents in fr_ids_in_scope. ` +
        `Only plan for FRs that are NOT already claimed by existing phases.\n\n` +
        designInputs.fr_context.map((f) => `## ${f.path}\n\n${f.content}`).join("\n\n---\n\n")
      : "";

    const adrSection = designInputs.adr_context.length > 0
      ? `# Architecture Decision Records (ADRs)\n\n` +
        `Evaluate your phase plan for compliance and congruency with these decisions. ` +
        `Do not propose anything that contradicts an Accepted ADR. ` +
        `List any ADR conflicts or considerations in required_design_artifacts.\n\n` +
        designInputs.adr_context.map((f) => `## ${f.path}\n\n${f.content}`).join("\n\n---\n\n")
      : "";

    const tdnSection = designInputs.tdn_context.length > 0
      ? `# Technical Design Notes (TDNs) & Architecture\n\n` +
        `Consider these design constraints when scoping the phase. ` +
        `Reference any TDN required before implementation can begin in required_design_artifacts.\n\n` +
        designInputs.tdn_context.map((f) => `## ${f.path}\n\n${f.content}`).join("\n\n---\n\n")
      : "";

    // Always inject Section 4 even when empty so the LLM sees an explicit "none claimed" signal.
    // Omitting Section 4 entirely causes the LLM to conflate "Phase 1"/"Phase 2" labels
    // inside FRD acceptance criteria with delivery pipeline phases, triggering NO_UNMET_FRS.
    const claimedSection =
      `# Already Claimed FR IDs\n\n` +
      (claimedFrIds.length > 0
        ? `These FR identifiers are already covered by existing phase plans. ` +
          `DO NOT include them in fr_ids_in_scope unless this phase is explicitly superseding a prior plan. ` +
          `If all FRs in the provided documents are already claimed and there is nothing left to plan, ` +
          `return: {"error": "NO_UNMET_FRS", "message": "All known FRs are already covered by existing phases."}\n\n` +
          claimedFrIds.map((id) => `- ${id}`).join("\n")
        : `No prior phase plans exist. ALL FR identifiers in the provided documents are unclaimed. ` +
          `You MUST produce a phase plan covering at least the first logical set of FRs. ` +
          `NOTE: "Phase 1" or "Phase 2" labels that appear inside FR acceptance criteria are ` +
          `implementation scoping notes within the requirement — they are NOT delivery pipeline ` +
          `phase plans and do NOT make those FRs already claimed.`);

    const contentSections = [frSection, adrSection, tdnSection, claimedSection].filter(Boolean);
    const userContent =
      contentSections.join("\n\n---\n\n") +
      "\n\n---\n\n" +
      (typed.project_context ? `## Additional Project Context\n\n${typed.project_context}\n\n` : "") +
      `## Planning Request\n\n${description}`;

    const _preambleRun = await pipelineService.get(pipelineId);
    const _preambleProject = _preambleRun.project_id ? await projectService.getById(_preambleRun.project_id) : null;
    const systemPrompt = buildProjectPreamble(_preambleProject) + await governanceService.getComposedPrompt("planner");
    const provider = await llmFactory.forRole("planner");
    const plan = await provider.chatJson<PlannerPhasePlan>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ], { meta: { role: "planner", pipeline_id: pipelineId, call_type: "phase-plan" } });

    // Detect LLM-reported semantic errors before field validation
    const planAsRecord = plan as unknown as Record<string, unknown>;
    if (typeof planAsRecord["error"] === "string") {
      const errorCode = planAsRecord["error"] as string;
      let errorMsg = (planAsRecord["message"] as string | undefined) ?? `Planner stopped with error code: ${errorCode}`;
      const errorDetails: Record<string, unknown> = {
        claimed_fr_ids: claimedFrIds,
        fr_context_files: designInputs.fr_context.map((f) => f.path),
        execution_mode: executionMode,
      };
      
      // Provide context-aware message for NO_UNMET_FRS
      if (errorCode === "NO_UNMET_FRS") {
        errorMsg = "No unclaimed FR work available to plan. All FR requirements are staged in existing phases. Approve a phase plan to stage a sprint.";
      }

      // Provide context-aware message for NO_APPROVED_FRDS with detailed FRD list
      if (errorCode === "NO_APPROVED_FRDS") {
        const draftFrds = (planAsRecord["draft_frds"] ?? []) as unknown[];
        const approvedFrds = (planAsRecord["approved_frds"] ?? []) as unknown[];

        let draftList = "None";
        if (Array.isArray(draftFrds) && draftFrds.length > 0) {
          draftList = draftFrds
            .map((frd: unknown) => {
              if (typeof frd === "object" && frd !== null) {
                const id = (frd as Record<string, unknown>)["id"] ?? "?";
                const title = (frd as Record<string, unknown>)["title"] ?? "?";
                const status = (frd as Record<string, unknown>)["status"] ?? "?";
                return `- **${id}** (${title}) — Status: ${status}`;
              }
              return `- ${frd}`;
            })
            .join("\n");
        }

        let approvedList = "None";
        if (Array.isArray(approvedFrds) && approvedFrds.length > 0) {
          approvedList = approvedFrds
            .map((frd: unknown) => {
              if (typeof frd === "object" && frd !== null) {
                const id = (frd as Record<string, unknown>)["id"] ?? "?";
                const title = (frd as Record<string, unknown>)["title"] ?? "?";
                return `- **${id}** (${title})`;
              }
              return `- ${frd}`;
            })
            .join("\n");
        }

        errorMsg = `Planner cannot create a phase plan because no FRDs with Status: Approved were found.\n\n**FRDs requiring approval:**\n${draftList}\n\n**Already approved FRDs (if any):**\n${approvedList}\n\nApprove all required FRDs in docs/functional_requirements/ and docs/prd/, then rerun Planner.`;
        errorDetails["draft_frds"] = draftFrds;
        errorDetails["approved_frds"] = approvedFrds;
      }
      
      throw new HttpError(422, errorCode, errorMsg, errorDetails);
    }

    if (!plan.phase_id || !Array.isArray(plan.objectives) || !Array.isArray(plan.deliverables)) {
      throw new Error("Planner LLM response missing required fields (phase_id, objectives, deliverables)");
    }

    // Hard gate: FR IDs must be present and reference real documents (PLN-GATE-001, ADR-031)
    if (!Array.isArray(plan.fr_ids_in_scope) || plan.fr_ids_in_scope.length === 0) {
      throw new HttpError(
        422,
        "FR_IDS_REQUIRED",
        "Planner produced a phase plan with no fr_ids_in_scope. All tasks must map to valid FR IDs " +
          "(PLN-GATE-001). Ensure docs/functional_requirements or docs/prd contains FR documents.",
        { phase_id: plan.phase_id, fr_context_files: designInputs.fr_context.map((f) => f.path) }
      );
    }

    // Hard gate: dependent FRs and required TDNs must be human-approved before phase plan creation.
    // This prevents creating phase plans that are guaranteed to fail sprint-stage design gates.
    this.assertApprovedDependencies(plan, designInputs);

    context.notify(`📝 Phase plan drafted: *${plan.name}* (\`${plan.phase_id}\`)\n> ${plan.objectives.length} objective${plan.objectives.length !== 1 ? "s" : ""}, ${plan.deliverables.length} deliverable${plan.deliverables.length !== 1 ? "s" : ""}`);

    // Artifact path follows project_work governance naming convention:
    // phase_plan_<descriptor>.md
    const descriptor = plan.phase_id.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const artifactFilename = `phase_plan_${descriptor}.md`;
    const artifactContent = this.formatMarkdown(plan);
    const artifactPath = await artifactService.write(pipelineId, artifactFilename, artifactContent);

    // Persist to project repo: project_work/ai_project_tasks/staged_phases/ (AI_PHASE_PROCESS.md)
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (project) {
      const repoRelPath = path.join("project_work", "ai_project_tasks", "staged_phases", artifactFilename);
      const absPath = path.isAbsolute(project.clone_path)
        ? path.join(project.clone_path, repoRelPath)
        : path.join(process.cwd(), project.clone_path, repoRelPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, artifactContent, "utf-8");
      await projectGitService.ensureReady(project);
      await projectGitService.commitAll(project, project.default_branch, `plan: draft ${plan.phase_id} phase plan`);
      await projectGitService.push(project, project.default_branch);
      context.notify(`📁 Phase plan persisted to \`${repoRelPath}\` on \`${project.default_branch}\``);
    }

    context.log("Planner phase plan complete", { phase_id: plan.phase_id, artifact_path: artifactPath });

    // Immediately stage Sprint 1 plan after phase plan commit (two discrete commits on main).
    let sprintPlanPath: string | undefined;
    if (project) {
      const staged = await this.runInitialSprintPlanning(pipelineId, artifactContent, description, context);
      if (staged) sprintPlanPath = staged;
    }

    const output: PlannerOutput = {
      phase_id: plan.phase_id,
      phase_plan: plan,
      artifact_path: artifactPath,
      ...(sprintPlanPath ? { sprint_plan_path: sprintPlanPath } : {}),
    };

    return output;
  }

  /**
   * Step 1.3 (Phase 1): Called immediately after the phase plan is committed to staged_phases/.
   * Generates Sprint 1 plan (with first task detail) and commits it to staged_sprints/ on main.
   * This makes the Planner the sole owner of sprint plan creation.
   */
  private async runInitialSprintPlanning(
    pipelineId: string,
    phasePlanContent: string,
    description: string,
    context: ScriptExecutionContext
  ): Promise<string | null> {
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (!project) return null;

    const repoBase = path.isAbsolute(project.clone_path)
      ? project.clone_path
      : path.join(process.cwd(), project.clone_path);
    const stagedSprintsDir = path.join(repoBase, "project_work", "ai_project_tasks", "staged_sprints");

    // Skip if a sprint plan already exists — planner is idempotent.
    try {
      const existing = await fs.readdir(stagedSprintsDir);
      const existingFile = existing.find((e) => /^sprint_plan_.*\.md$/i.test(e));
      if (existingFile) {
        context.notify("ℹ️ Sprint plan already exists in staged_sprints/ — skipping Sprint 1 generation.");
        return path.relative(process.cwd(), path.join(stagedSprintsDir, existingFile)).replace(/\\/g, "/");
      }
    } catch {
      // staged_sprints/ doesn't exist yet — that's fine, we'll create it
    }

    context.notify("📋 Staging Sprint 1 plan from phase plan...");

    const { content: sprintPlanContent, sprint_id: sprintIdRaw, rich } = await this.generateSprintPlanContent(
      pipelineId,
      phasePlanContent,
      description,
      project
    );

    const sprintPlanFilename = `sprint_plan_${sprintIdRaw.toLowerCase()}.md`;
    const sprintPlanJsonFilename = `sprint_plan_${sprintIdRaw.toLowerCase()}.json`;
    const repoRelPath = path.join("project_work", "ai_project_tasks", "staged_sprints", sprintPlanFilename);

    await fs.mkdir(stagedSprintsDir, { recursive: true });
    await fs.writeFile(path.join(stagedSprintsDir, sprintPlanFilename), sprintPlanContent, "utf-8");
    if (rich) {
      await fs.writeFile(
        path.join(stagedSprintsDir, sprintPlanJsonFilename),
        JSON.stringify(rich, null, 2),
        "utf-8"
      );
    }
    await projectGitService.ensureReady(project);
    await projectGitService.commitAll(project, project.default_branch, `plan: stage ${sprintIdRaw} sprint plan`);
    await projectGitService.push(project, project.default_branch);
    context.notify(`📁 Sprint plan staged at \`${repoRelPath}\` on \`${project.default_branch}\``);

    return path.relative(process.cwd(), path.join(stagedSprintsDir, sprintPlanFilename)).replace(/\\/g, "/");
  }

  private formatMarkdown(plan: PlannerPhasePlan): string {
    const objectives = plan.objectives.map((o) => `- ${o}`).join("\n");
    const deliverables = plan.deliverables.map((d) => `- ${d}`).join("\n");
    const dependencies = plan.dependencies.length
      ? plan.dependencies.map((d) => `- ${d}`).join("\n")
      : "- None";
    const frIds = plan.fr_ids_in_scope?.length
      ? plan.fr_ids_in_scope.map((id) => `- ${id}`).join("\n")
      : "- None";
    const designArtifacts = plan.required_design_artifacts?.length
      ? `| Type | Title | Status |\n|---|---|---|\n` +
        plan.required_design_artifacts.map((a) => `| ${a.type} | ${a.title} | ${a.status} |`).join("\n")
      : "_None required_";

    return `# Phase Plan: ${plan.phase_id}

**Name:** ${plan.name}
**Status:** ${plan.status}

## Description
${plan.description}

## FR IDs in Scope
${frIds}

## Objectives
${objectives}

## Deliverables
${deliverables}

## Dependencies
${dependencies}

## Required Design Artifacts
${designArtifacts}
`;
  }

  private async runSprintCloseOut(
    pipelineId: string,
    previousArtifacts: string[],
    verificationJson: string,
    sprintCloseOutJson: string,
    context: ScriptExecutionContext
  ): Promise<PlannerCloseoutContext> {
    const verification = JSON.parse(verificationJson) as { result?: string; summary?: string; task_id?: string };
    if (verification.result !== "PASS") {
      throw new Error("Planner sprint close-out called before verifier PASS");
    }

    const sprintCloseOut = JSON.parse(sprintCloseOutJson) as {
      sprint_branch?: string;
      last_completed_task_id?: string;
      sprint_complete_artifacts?: string[];
      verifier_summary?: string;
    };

    const existingPlannerCloseoutArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("planner_sprint_closeout.json"))
    );

    if (existingPlannerCloseoutArtifact?.content) {
      const parsed = JSON.parse(existingPlannerCloseoutArtifact.content) as {
        pr_number?: number;
        pr_url?: string;
        sprint_branch?: string;
      };
      const existingBranch = parsed.sprint_branch ?? sprintCloseOut.sprint_branch;
      if (parsed.pr_number && parsed.pr_url && existingBranch) {
        await pipelineService.setPrDetails(pipelineId, parsed.pr_number, parsed.pr_url, existingBranch);
        context.notify(`ℹ️ Reusing existing planner closeout PR #${parsed.pr_number}: <${parsed.pr_url}|View Pull Request>`);
        return {
          closeout: {
            phase_id: "closeout",
            artifact_path: existingPlannerCloseoutArtifact.path,
            closeout_mode: "sprint",
            pr_number: parsed.pr_number,
            pr_url: parsed.pr_url,
            sprint_branch: existingBranch,
          },
          metadata: {
            reused_closeout_artifact: true,
            reused_existing_pr: true,
          },
        };
      }
    }

    context.notify("🏁 Planner closing sprint from PASS gate artifacts and task closeout evidence...");

    const run = await pipelineService.get(pipelineId);
    const project = run.project_id
      ? await projectService.getById(run.project_id)
      : await projectService.getByName("default");
    if (!project) {
      throw new Error("Planner sprint close-out failed: project not found");
    }

    const sprintBranch = sprintCloseOut.sprint_branch ?? run.sprint_branch ?? `feature/${pipelineId}`;

    await projectGitService.ensureReady(project);
    await projectGitService.push(project, sprintBranch);

    const sprintPlanArtifact = await artifactService.findFirst(
      previousArtifacts.filter((p) => p.includes("sprint_plan_"))
    );

    const title = `[${sprintBranch}] Autonomous sprint`;
    const body = [
      "## Sprint Summary",
      sprintCloseOut.verifier_summary ?? verification.summary ?? "Verifier passed.",
      "",
      "## Pipeline",
      `Pipeline ID: ${pipelineId}`,
      sprintCloseOut.last_completed_task_id
        ? `Last Task: ${sprintCloseOut.last_completed_task_id}`
        : verification.task_id
          ? `Last Task: ${verification.task_id}`
          : "",
      "",
      "## Gate Artifacts",
      ...(sprintCloseOut.sprint_complete_artifacts ?? []).map((p) => `- ${p}`),
    ]
      .filter(Boolean)
      .join("\n");

    const existingBranchPr = await githubApiService.findOpenPullRequestByHead({
      repoUrl: project.repo_url,
      head: sprintBranch,
      base: project.default_branch,
    });

    const existingTitlePr = existingBranchPr
      ? null
      : await githubApiService.findOpenPullRequestByTitle({
        repoUrl: project.repo_url,
        title,
        base: project.default_branch,
      });

    const remediated = existingBranchPr || existingTitlePr
      ? null
      : await prRemediationService.createPullRequestWithRecovery(project, {
        title,
        body,
        head: sprintBranch,
        base: project.default_branch,
      });

    const pr = existingBranchPr ?? existingTitlePr ?? remediated!.pr;

    const reusedExistingPr = Boolean(existingBranchPr ?? existingTitlePr);

    await pipelineService.setPrDetails(pipelineId, pr.number, pr.html_url, sprintBranch);
    if (reusedExistingPr) {
      context.notify(`ℹ️ Reusing existing open PR #${pr.number}: <${pr.html_url}|View Pull Request>`);
    } else {
      if (remediated?.remediation_performed) {
        context.notify("🛠️ PR create hit a 404 and was auto-remediated (reconcile + push + retry). ");
      }
      context.notify(`🔗 Planner opened PR #${pr.number}: <${pr.html_url}|View Pull Request>`);
    }

    const closeOutPath = await artifactService.write(
      pipelineId,
      "planner_sprint_closeout.json",
      JSON.stringify(
        {
          pipeline_id: pipelineId,
          sprint_branch: sprintBranch,
          pr_number: pr.number,
          pr_url: pr.html_url,
          last_completed_task_id: sprintCloseOut.last_completed_task_id ?? verification.task_id ?? "n/a",
          closeout_role: "planner",
          closeout_scope: "sprint",
          gate_result: "PASS",
          sprint_plan_path: sprintPlanArtifact?.path,
          sprint_complete_artifacts: sprintCloseOut.sprint_complete_artifacts ?? [],
        },
        null,
        2
      )
    );

    context.log("Planner sprint close-out complete", {
      pipeline_id: pipelineId,
      sprint_branch: sprintBranch,
      pr_number: pr.number,
      pr_url: pr.html_url,
    });

    return {
      closeout: {
        phase_id: "closeout",
        artifact_path: closeOutPath,
        closeout_mode: "sprint",
        pr_number: pr.number,
        pr_url: pr.html_url,
        sprint_branch: sprintBranch,
      },
      metadata: {
        reused_closeout_artifact: false,
        reused_existing_pr: reusedExistingPr,
      },
    };
  }

  private async resolveNextModeState(pipelineId: string, unclaimedFrCount?: number): Promise<NextModeState> {
    const openRepoSprint = await this.findOpenRepoSprint(pipelineId);
    if (openRepoSprint) {
      return { kind: "open_sprint", sprint: openRepoSprint };
    }

    const sprintPlan = await this.findOpenPhasePlan(pipelineId);
    if (sprintPlan) {
      return { kind: "sprint_ready", phasePlan: sprintPlan };
    }

    if (typeof unclaimedFrCount !== "number") {
      return { kind: "needs_fr_evaluation" };
    }

    if (unclaimedFrCount > 0) {
      return { kind: "phase_planning" };
    }

    return { kind: "no_work" };
  }

  private throwOpenSprintExists(
    openRepoSprint: { sprint_id: string; status: string; sprint_plan_path: string },
    executionMode: string | undefined
  ): never {
    const sprintStatus = (openRepoSprint.status ?? "").toLowerCase();
    const sprintReadiness = sprintStatus === "staged" || sprintStatus === "planning"
      ? "ready for Sprint Controller"
      : sprintStatus === "active" || sprintStatus === "ready_for_verification"
        ? "in progress"
        : "already open";
    throw new HttpError(
      409,
      "OPEN_SPRINT_EXISTS",
      `Sprint ${openRepoSprint.sprint_id} is already open (status: ${openRepoSprint.status}) and is ${sprintReadiness}. Review current sprint artifacts before requesting another Planner next step.`,
      {
        sprint_id: openRepoSprint.sprint_id,
        status: openRepoSprint.status,
        sprint_plan_path: openRepoSprint.sprint_plan_path,
        execution_mode: executionMode,
      }
    );
  }

  private assertApprovedDependencies(plan: PlannerPhasePlan, designInputs: DesignInputGateResult): void {
    const frDependencyIssues = this.findUnapprovedFrDependencies(plan, designInputs);
    if (frDependencyIssues.length > 0) {
      const issueList = frDependencyIssues
        .map((issue) => {
          if (issue.reason === "not_found") {
            return `- **${issue.fr_id}** (not found)`;
          } else {
            return `- **${issue.fr_id}** (not approved, in: ${issue.paths.join(", ")})`;
          }
        })
        .join("\n");
      
      throw new HttpError(
        422,
        "FR_DEPENDENCIES_NOT_APPROVED",
        `Planner cannot create a phase plan because one or more FR dependencies are not human-approved:\n\n${issueList}\n\nApprove these FR documents first, then rerun Planner.`,
        {
          phase_id: plan.phase_id,
          fr_dependencies_pending_approval: frDependencyIssues,
        }
      );
    }

    const tdnDependencyIssues = this.findUnapprovedTdnDependencies(plan, designInputs);
    if (tdnDependencyIssues.length > 0) {
      const issueList = tdnDependencyIssues
        .map((issue) => {
          if (issue.reason === "missing") {
            return `- **${issue.title}** (not found in docs/design/tdn/)`;
          } else {
            return `- **${issue.title}** (not approved, Status: ${issue.status || "missing"}, in: ${issue.path || "unknown"})`;
          }
        })
        .join("\n");
      
      throw new HttpError(
        422,
        "TDN_DEPENDENCIES_NOT_APPROVED",
        `Planner cannot create a phase plan because required TDN dependencies are missing or not human-approved:\n\n${issueList}\n\nCreate or approve these TDNs, then rerun Planner.`,
        {
          phase_id: plan.phase_id,
          tdn_dependencies_pending_approval: tdnDependencyIssues,
        }
      );
    }

    const adrDependencyIssues = this.findUnapprovedAdrDependencies(plan, designInputs);
    if (adrDependencyIssues.length > 0) {
      const issueList = adrDependencyIssues
        .map((issue) => {
          if (issue.reason === "missing") {
            return `- **${issue.title}** (not found in docs/adr/)`;
          } else {
            return `- **${issue.title}** (not approved, Status: ${issue.status || "missing"}, in: ${issue.path || "unknown"})`;
          }
        })
        .join("\n");

      throw new HttpError(
        422,
        "ADR_DEPENDENCIES_NOT_APPROVED",
        `Planner cannot create a phase plan because required ADR dependencies are missing or not human-approved:\n\n${issueList}\n\nCreate or approve these ADRs, then rerun Planner.`,
        {
          phase_id: plan.phase_id,
          adr_dependencies_pending_approval: adrDependencyIssues,
        }
      );
    }
  }

  private findUnapprovedFrDependencies(
    plan: PlannerPhasePlan,
    designInputs: DesignInputGateResult
  ): Array<{ fr_id: string; reason: "not_found" | "not_approved"; paths: string[] }> {
    const frToContexts = new Map<string, Array<{ path: string; approved: boolean }>>();

    for (const file of designInputs.fr_context) {
      const frIds = this.extractFrIds(file.content);
      const status = this.readArtifactStatus(file.content);
      const approved = status ? APPROVED_STATUSES.has(status.toLowerCase()) : false;

      for (const id of frIds) {
        const existing = frToContexts.get(id) ?? [];
        existing.push({ path: file.path, approved });
        frToContexts.set(id, existing);
      }
    }

    const issues: Array<{ fr_id: string; reason: "not_found" | "not_approved"; paths: string[] }> = [];
    for (const frId of plan.fr_ids_in_scope ?? []) {
      const contexts = frToContexts.get(frId);
      if (!contexts || contexts.length === 0) {
        issues.push({ fr_id: frId, reason: "not_found", paths: [] });
        continue;
      }

      if (!contexts.some((c) => c.approved)) {
        issues.push({
          fr_id: frId,
          reason: "not_approved",
          paths: contexts.map((c) => c.path),
        });
      }
    }

    return issues;
  }

  private findUnapprovedTdnDependencies(
    plan: PlannerPhasePlan,
    designInputs: DesignInputGateResult
  ): Array<{ title: string; reason: "missing" | "not_approved"; path?: string; status?: string }> {
    const requiredTdns = (plan.required_design_artifacts ?? []).filter((a) => a.type === "TDN");
    if (requiredTdns.length === 0) {
      return [];
    }

    const tdnIndex = designInputs.tdn_context.map((file) => {
      const id = this.readTdnId(file.content);
      const title = this.readTdnTitle(file.content);
      const status = this.readArtifactStatus(file.content);
      const approved = status ? APPROVED_STATUSES.has(status.toLowerCase()) : false;
      return {
        path: file.path,
        normalizedId: this.normalizeTitle(id ?? ""),
        normalizedTitle: this.normalizeTitle(title ?? ""),
        status,
        approved,
      };
    });

    const issues: Array<{ title: string; reason: "missing" | "not_approved"; path?: string; status?: string }> = [];
    for (const required of requiredTdns) {
      const requiredNorm = this.normalizeTitle(required.title);
      const matched = tdnIndex.find(
        (tdn) =>
          tdn.normalizedId === requiredNorm ||
          tdn.normalizedId.includes(requiredNorm) ||
          requiredNorm.includes(tdn.normalizedId) ||
          tdn.normalizedTitle === requiredNorm ||
          tdn.normalizedTitle.includes(requiredNorm) ||
          requiredNorm.includes(tdn.normalizedTitle)
      );

      if (!matched) {
        issues.push({ title: required.title, reason: "missing" });
        continue;
      }

      if (!matched.approved) {
        issues.push({
          title: required.title,
          reason: "not_approved",
          path: matched.path,
          status: matched.status,
        });
      }
    }

    return issues;
  }

  private findUnapprovedAdrDependencies(
    plan: PlannerPhasePlan,
    designInputs: DesignInputGateResult
  ): Array<{ title: string; reason: "missing" | "not_approved"; path?: string; status?: string }> {
    const requiredAdrs = (plan.required_design_artifacts ?? []).filter((a) => a.type === "ADR");
    if (requiredAdrs.length === 0) {
      return [];
    }

    const adrIndex = designInputs.adr_context.map((file) => {
      const id = this.readAdrId(file.content);
      const status = this.readArtifactStatus(file.content);
      const approved = status ? APPROVED_STATUSES.has(status.toLowerCase()) : false;
      return {
        path: file.path,
        normalizedId: this.normalizeTitle(id ?? ""),
        status,
        approved,
      };
    });

    const issues: Array<{ title: string; reason: "missing" | "not_approved"; path?: string; status?: string }> = [];
    for (const required of requiredAdrs) {
      const requiredNorm = this.normalizeTitle(required.title);
      const matched = adrIndex.find(
        (adr) =>
          adr.normalizedId === requiredNorm ||
          adr.normalizedId.includes(requiredNorm) ||
          requiredNorm.includes(adr.normalizedId)
      );

      if (!matched) {
        issues.push({ title: required.title, reason: "missing" });
        continue;
      }

      if (!matched.approved) {
        issues.push({
          title: required.title,
          reason: "not_approved",
          path: matched.path,
          status: matched.status,
        });
      }
    }

    return issues;
  }

  private extractFrIds(content: string): string[] {
    const matches = content.match(/\bFR-\d+(?:\.\d+)?\b/gm) ?? [];
    return [...new Set(matches)];
  }

  private readArtifactStatus(content: string): string | undefined {
    const boldStatus = /^\*\*Status:\*\*\s*(.+)$/im.exec(content);
    if (boldStatus?.[1]?.trim()) {
      return boldStatus[1].trim();
    }

    const plainStatus = /^Status:\s*(.+)$/im.exec(content);
    return plainStatus?.[1]?.trim() || undefined;
  }

  private readTdnId(content: string): string | undefined {
    const m = /^TDN ID:\s*(.+)$/im.exec(content);
    return m?.[1]?.trim();
  }

  private readAdrId(content: string): string | undefined {
    const m = /^ADR ID:\s*(.+)$/im.exec(content);
    return m?.[1]?.trim();
  }

  /**
   * Extracts the subject from a TDN H1 heading, stripping the "Technical Design Note:" prefix.
   * e.g. "# Technical Design Note: Main Application Window — Aesthetic Theme Implementation"
   *   → "Main Application Window — Aesthetic Theme Implementation"
   */
  private readTdnTitle(content: string): string | undefined {
    const m = /^#[^\n]*Technical Design Note[:\s]+(.+)$/im.exec(content);
    if (m?.[1]?.trim()) return m[1].trim();
    // Fallback: first H1 line stripped of leading #
    const h1 = /^#\s+(.+)$/im.exec(content);
    return h1?.[1]?.trim();
  }

  private normalizeTitle(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /**
   * Reads FR IDs already claimed by existing phase plan documents in staged_phases/.
   * Used to exclude covered FRs from the current planning cycle.
   */
  private async readClaimedFrIds(stagedPhasesDir: string): Promise<string[]> {
    let fileNames: string[];
    try {
      const entries = await fs.readdir(stagedPhasesDir, { withFileTypes: true });
      fileNames = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => path.join(stagedPhasesDir, e.name));
    } catch {
      return []; // Directory does not exist yet — no prior phases
    }

    const claimed = new Set<string>();
    const SECTION_RE = /^## FR IDs in Scope\s*$/m;
    const ITEM_RE = /^-\s+(.+)$/;

    for (const filePath of fileNames) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const sectionMatch = SECTION_RE.exec(content);
        if (!sectionMatch) continue;

        const afterSection = content.slice(sectionMatch.index + sectionMatch[0].length);
        for (const line of afterSection.split("\n")) {
          if (line.startsWith("## ")) break; // Hit the next section
          const m = ITEM_RE.exec(line.trim());
          if (m && m[1].trim() !== "None") claimed.add(m[1].trim());
        }
      } catch {
        // Unreadable — skip
      }
    }

    return [...claimed];
  }

  /**
  * Finds the most recent phase plan in a sprint-ready status from the project repo.
   * Searches staged_phases/ then active/. Returns null if none found.
   */
  private async findOpenPhasePlan(pipelineId: string): Promise<{ content: string; filePath: string } | null> {
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (!project) {
      return null;
    }

    const repoRoot = path.isAbsolute(project.clone_path)
      ? project.clone_path
      : path.join(process.cwd(), project.clone_path);

    const searchDirs = [
      path.join(repoRoot, "project_work", "ai_project_tasks", "staged_phases"),
      path.join(repoRoot, "project_work", "ai_project_tasks", "active"),
    ];

    const candidates: { filePath: string; mtime: number; status?: string }[] = [];
    for (const dir of searchDirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && /^phase_plan_.*\.md$/i.test(e.name)) {
            const fp = path.join(dir, e.name);
            const stat = await fs.stat(fp);
            const content = await fs.readFile(fp, "utf-8");
            const statusMatch = /^\*\*Status:\*\*\s+(.+)$/m.exec(content);
            const status = statusMatch?.[1]?.trim();
            candidates.push({ filePath: fp, mtime: stat.mtimeMs, status });
          }
        }
      } catch (err) {
        // dir doesn't exist — skip
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by mtime descending (most recent first)
    candidates.sort((a, b) => b.mtime - a.mtime);

    // Return first one with a sprint-ready status
    for (const c of candidates) {
      if (SPRINT_READY_PHASE_STATUSES.has(c.status ?? "")) {
        const content = await fs.readFile(c.filePath, "utf-8");
        return { content, filePath: c.filePath };
      }
    }

    // No Planning phase found
    const statuses = candidates.map((c) => `${path.basename(c.filePath)}:${c.status}`).join("; ");
    return null;
  }

  /**
   * Finds all phase plans from the project repo with their statuses.
   * Used to provide comprehensive status feedback in next mode.
   */
  private async findAllPhases(pipelineId: string): Promise<{ filePath: string; status?: string; phase_id?: string }[]> {
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (!project) return [];

    const repoRoot = path.isAbsolute(project.clone_path)
      ? project.clone_path
      : path.join(process.cwd(), project.clone_path);

    const searchDirs = [
      path.join(repoRoot, "project_work", "ai_project_tasks", "staged_phases"),
      path.join(repoRoot, "project_work", "ai_project_tasks", "active"),
    ];

    const results: { filePath: string; status?: string; phase_id?: string }[] = [];
    for (const dir of searchDirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && /^phase_plan_.*\.md$/i.test(e.name)) {
            const fp = path.join(dir, e.name);
            const content = await fs.readFile(fp, "utf-8");
            const statusMatch = /^\*\*Status:\*\*\s+(.+)$/m.exec(content);
            const phaseMatch = /^# Phase Plan:\s+(.+)$/m.exec(content);
            results.push({
              filePath: fp,
              status: statusMatch?.[1]?.trim(),
              phase_id: phaseMatch?.[1]?.trim(),
            });
          }
        }
      } catch {
        // dir doesn't exist — skip
      }
    }
    return results;
  }

  /**
   * Sprint planning mode: Planner reads an existing phase plan and produces
   * sprint_plan + AI_IMPLEMENTATION_BRIEF.md + current_task.json for Sprint 1.
   */
  private async runSprintPlanning(
    pipelineId: string,
    phasePlanContent: string,
    description: string,
    context: ScriptExecutionContext
  ): Promise<PlannerOutput> {
    context.notify("🗂️ Planner staging Sprint 1 from existing phase plan...");

    // Gate: no open sprint already exists in the project repo
    const openSprint = await this.findOpenRepoSprint(pipelineId);
    if (openSprint) {
      throw new HttpError(
        409,
        "OPEN_SPRINT_EXISTS",
        `A sprint is already open (${openSprint.sprint_id}, status: ${openSprint.status}). ` +
          "Review or close the open sprint before staging a new one (process_invariants §Sprint Lifecycle Gates).",
        {
          sprint_id: openSprint.sprint_id,
          status: openSprint.status,
          sprint_plan_path: openSprint.sprint_plan_path,
        }
      );
    }

    const _preambleRun = await pipelineService.get(pipelineId);
    const _preambleProject = _preambleRun.project_id ? await projectService.getById(_preambleRun.project_id) : null;

    const { content: sprintPlanContent, sprint_id: sprintIdRaw, phase_id: phaseIdRaw, rich } =
      await this.generateSprintPlanContent(
        pipelineId,
        phasePlanContent,
        description,
        _preambleProject
      );

    const sprintPlanPath = await artifactService.write(
      pipelineId,
      `sprint_plan_${sprintIdRaw.toLowerCase()}.md`,
      sprintPlanContent
    );

    // Persist sprint plan to staged_sprints/ on main — no branch or PR (Planner owns sprint plan creation,
    // Sprint Controller owns branch/PR creation when it stages the task package).
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;

    if (project) {
      const repoBase = path.isAbsolute(project.clone_path)
        ? project.clone_path
        : path.join(process.cwd(), project.clone_path);
      const sprintPlanFilename = `sprint_plan_${sprintIdRaw.toLowerCase()}.md`;
      const sprintPlanJsonFilename = `sprint_plan_${sprintIdRaw.toLowerCase()}.json`;
      const stagedSprintsDir = path.join(repoBase, "project_work", "ai_project_tasks", "staged_sprints");
      const repoRelPath = path.join("project_work", "ai_project_tasks", "staged_sprints", sprintPlanFilename);
      await fs.mkdir(stagedSprintsDir, { recursive: true });
      await fs.writeFile(path.join(stagedSprintsDir, sprintPlanFilename), sprintPlanContent, "utf-8");
      if (rich) {
        await fs.writeFile(
          path.join(stagedSprintsDir, sprintPlanJsonFilename),
          JSON.stringify(rich, null, 2),
          "utf-8"
        );
      }
      await projectGitService.ensureReady(project);
      await projectGitService.commitAll(project, project.default_branch, `plan: stage ${sprintIdRaw} sprint plan`);
      await projectGitService.push(project, project.default_branch);
      context.notify(`📁 Sprint plan staged at \`${repoRelPath}\` on \`${project.default_branch}\``);
    }

    return {
      phase_id: phaseIdRaw,
      artifact_path: sprintPlanPath,
    };
  }

  private async findOpenRepoSprint(
    pipelineId: string
  ): Promise<{ sprint_id: string; status: string; sprint_plan_path: string } | null> {
    try {
      const staged = await pipelineService.listRepoStagedSprints({ projectId: (await pipelineService.get(pipelineId)).project_id ?? undefined, limit: 20 });
      const openSprint = staged.sprints.find((s) => OPEN_SPRINT_STATUSES.has(s.status));
      if (!openSprint) {
        return null;
      }

      return {
        sprint_id: openSprint.sprint_id,
        status: openSprint.status,
        sprint_plan_path: openSprint.sprint_plan_path,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calls the Sprint Planner LLM using the rich (Plan v1) prompt and returns the
   * rendered sprint-plan markdown plus top-level identifiers. Validates the response
   * with sprintPlanValidatorService and renders deterministic markdown via
   * sprintPlanRendererService. Also returns the parsed RichSprintLlmResponse so
   * callers can persist the structured JSON alongside the markdown.
   */
  private async generateSprintPlanContent(
    pipelineId: string,
    phasePlanContent: string,
    description: string,
    project: Awaited<ReturnType<typeof projectService.getById>> | null
  ): Promise<{
    content: string;
    sprint_id: string;
    phase_id: string;
    rich?: RichSprintLlmResponse;
  }> {
    const provider = await llmFactory.forRole("sprint-controller");
    const userContent =
      `Phase plan:\n\n${phasePlanContent}\n\n` +
      `Produce a sprint plan for Sprint 1. Do not generate task briefs or current_task artifacts. ` +
      (description ? `Additional context: ${description}` : "");

    const invariants = await governanceService.processInvariantsFor("sprint-controller");
    const richPrompt = await governanceService.getPrompt("sprint-controller-rich");
    const systemPrompt =
      buildProjectPreamble(project) +
      `## PROCESS INVARIANTS (non-overridable)\n\n${invariants}\n\n---\n\n## ROLE-SPECIFIC MECHANICS\n\n${richPrompt}`;

    const richSchema = (await governanceService.getSchema("sprint_plan_rich")) as Record<string, unknown>;

    const llm = await provider.chatJson<RichSprintLlmResponse>(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      {
        meta: { role: "sprint-controller", pipeline_id: pipelineId, call_type: "sprint-plan-rich" },
        output_schema: richSchema,
      }
    );

    const result = await sprintPlanValidatorService.validateRichResponse(llm);
    if (!result.ok) {
      throw new HttpError(
        422,
        "SPRINT_PLAN_VALIDATION_FAILED",
        `Rich sprint plan failed schema validation (${result.errors.length} error(s)).`,
        { errors: result.errors.slice(0, 5) }
      );
    }

    const content = sprintPlanRendererService.render(
      result.value.sprint_plan,
      result.value.task_specifications
    );
    return {
      content,
      sprint_id: result.value.sprint_plan.sprint_id,
      phase_id: result.value.sprint_plan.phase_id,
      rich: result.value,
    };
  }



  private formatBrief(
    task: { task_id: string; title: string; description: string; files_likely_affected: string[]; acceptance_criteria: string[] },
    flags: Record<string, unknown>,
    sprint: { sprint_id: string; phase_id: string }
  ): string {
    const flagLines = Object.entries(flags)
      .map(([k, v]) => `- **${k}:** ${JSON.stringify(v)}`)
      .join("\n");

    return `# AI Implementation Brief

**Task ID:** ${task.task_id}
**Sprint:** ${sprint.sprint_id}
**Phase:** ${sprint.phase_id}

## Task Description
${task.description}

## Files Likely Affected
${task.files_likely_affected.map((f) => `- \`${f}\``).join("\n")}

## Acceptance Criteria (Deliverables Checklist)
${task.acceptance_criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Task Flags
${flagLines}

## Implementation Constraints
- Modify no more than 5 files
- Keep changes under ~200 lines of code
- Add tests for all new behaviour
- Do not refactor unrelated code
- Do not implement future sprint tasks

## Required Reads Before Coding
- \`ai_dev_stack/ai_guidance/AI_RULES.md\`
- \`ai_dev_stack/ai_guidance/AI_RUNTIME_POLICY.md\`
- \`ai_dev_stack/ai_guidance/AI_RUNTIME_GATES.md\`
`;
  }
}
