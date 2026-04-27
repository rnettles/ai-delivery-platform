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
import { designInputGateService, EntryMode } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";

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
  closeout_mode?: "sprint";
  pr_number?: number;
  pr_url?: string;
  sprint_branch?: string;
}

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

    if (verificationArtifact && sprintCloseOutArtifact) {
      return this.runSprintCloseOut(
        pipelineId,
        previousArtifacts,
        verificationArtifact.content,
        sprintCloseOutArtifact.content,
        context
      );
    }

    // Sprint planning mode: execution_mode "next" with an open Planning-status phase plan in the repo
    if (executionMode === "next") {
      const sprintPlan = await this.findOpenPhasePlan(pipelineId);
      if (sprintPlan) {
        context.log("Planner sprint planning mode detected", { execution_mode: executionMode });
        return this.runSprintPlanning(pipelineId, sprintPlan.content, description, context);
      }
      // No Planning-status phase found — check for unclaimed FRs before deciding
      // Will provide comprehensive feedback after loading design inputs
      context.log("Planner next mode: no Planning-status phases found, will check for unclaimed FRs");
    }

    context.log("Planner running", { description_length: description.length, execution_mode: executionMode });
    context.notify(`📋 Planning delivery phase...\n> _${description.slice(0, 120)}${description.length > 120 ? "…" : ""}_`);

    // Pre-condition: no open phase exists (process_invariants §Phase Lifecycle Gates, ADR-031)
    try {
      const staged = await pipelineService.listStagedPhases(pipelineId);
      const OPEN_PHASE_STATUSES = ["Draft", "Planning", "Active"];
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

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "planner", entryMode);
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
      const planningCount = planningPhases.filter((p) => p.status === "Planning").length;
      const unclaimedFrIds = designInputs.fr_context
        .flatMap((f) => {
          const matches = f.content.match(/^-\s+(FR-\d+)/gm);
          return matches ? matches.map((m) => m.replace(/^-\s+/, "")) : [];
        })
        .filter((id) => !claimedFrIds.includes(id));

      const statusLines = [
        `**Planning phases:** ${planningCount} (ready for sprint staging)`,
        `**Unclaimed FRs:** ${unclaimedFrIds.length} (available for new phase planning)`,
      ];

      if (planningCount === 0 && unclaimedFrIds.length === 0) {
        throw new HttpError(
          409,
          "NO_WORK_AVAILABLE",
          statusLines.join("\n") + 
          "\n\nNo work available: advance a phase from Draft to Planning to stage a sprint, or add new FR work to plan additional phases.",
          { planning_phases: planningCount, unclaimed_frs: unclaimedFrIds.length, execution_mode: executionMode }
        );
      }

      if (planningCount === 0 && unclaimedFrIds.length > 0) {
        throw new HttpError(
          409,
          "NO_PLANNING_PHASES",
          statusLines.join("\n") +
          "\n\nTo stage a sprint, advance a phase from Draft to Planning status. To plan new phases, use execution_mode='full' or no mode restriction.",
          { planning_phases: planningCount, unclaimed_frs: unclaimedFrIds.length, execution_mode: executionMode }
        );
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

    const systemPrompt = await governanceService.getComposedPrompt("planner");
    const provider = await llmFactory.forRole("planner");
    const plan = await provider.chatJson<PlannerPhasePlan>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    // Detect LLM-reported semantic errors before field validation
    const planAsRecord = plan as unknown as Record<string, unknown>;
    if (typeof planAsRecord["error"] === "string") {
      const errorCode = planAsRecord["error"] as string;
      let errorMsg = (planAsRecord["message"] as string | undefined) ?? `Planner stopped with error code: ${errorCode}`;
      
      // Provide context-aware message for NO_UNMET_FRS
      if (errorCode === "NO_UNMET_FRS") {
        errorMsg = "No unclaimed FR work available to plan. All FR requirements are staged in existing phases. Advance a phase from Draft to Planning to stage a sprint.";
      }
      
      throw new HttpError(422, errorCode, errorMsg, {
        claimed_fr_ids: claimedFrIds,
        fr_context_files: designInputs.fr_context.map((f) => f.path),
        execution_mode: executionMode,
      });
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

    context.log("Planner complete", { phase_id: plan.phase_id, artifact_path: artifactPath });

    const output: PlannerOutput = {
      phase_id: plan.phase_id,
      phase_plan: plan,
      artifact_path: artifactPath,
    };

    return output;
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
  ): Promise<PlannerOutput> {
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

    const pr = await githubApiService.createPullRequest({
      repoUrl: project.repo_url,
      title,
      body,
      head: sprintBranch,
      base: project.default_branch,
    });

    await pipelineService.setPrDetails(pipelineId, pr.number, pr.html_url, sprintBranch);
    context.notify(`🔗 Planner opened PR #${pr.number}: <${pr.html_url}|View Pull Request>`);

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
      phase_id: "closeout",
      artifact_path: closeOutPath,
      closeout_mode: "sprint",
      pr_number: pr.number,
      pr_url: pr.html_url,
      sprint_branch: sprintBranch,
    };
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
   * Finds the most recent phase plan in Planning status from the project repo.
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

    // Return first one with Planning status
    for (const c of candidates) {
      if (c.status === "Planning") {
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

    // Gate: no open sprint already exists
    try {
      const staged = await pipelineService.listStagedSprints(pipelineId);
      const OPEN_SPRINT_STATUSES = ["staged", "Planning", "Active", "ready_for_verification"];
      const openSprint = staged.sprints.find((s) => OPEN_SPRINT_STATUSES.includes(s.status));
      if (openSprint) {
        throw new HttpError(
          409,
          "OPEN_SPRINT_EXISTS",
          `A sprint is already open (${openSprint.sprint_id}, status: ${openSprint.status}). ` +
            "Close the open sprint before staging a new one (process_invariants §Sprint Lifecycle Gates).",
          { sprint_id: openSprint.sprint_id, status: openSprint.status }
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      context.log("Planner: open-sprint pre-condition check skipped", { reason: String(err) });
    }

    const userContent =
      `Phase plan:\n\n${phasePlanContent}\n\n` +
      `Produce a sprint plan and implementation brief for Sprint 1, Task 1. ` +
      (description ? `Additional context: ${description}` : "");

    const systemPrompt = await governanceService.getComposedPrompt("sprint-controller");
    const provider = await llmFactory.forRole("sprint-controller");

    interface SprintLlmResponse {
      sprint_plan: { sprint_id: string; phase_id: string; name: string; goals: string[]; tasks: string[]; status: "staged" };
      first_task: { task_id: string; title: string; description: string; acceptance_criteria: string[]; estimated_effort: "S" | "M" | "L"; files_likely_affected: string[]; status: "pending" };
      task_flags: { fr_ids_in_scope: string[]; architecture_contract_change: boolean; ui_evidence_required: boolean; incident_tier: "none" | "p0" | "p1" | "p2" | "p3"; schema_change?: boolean; migration_change?: boolean; cross_subsystem_change?: boolean };
    }

    const llm = await provider.chatJson<SprintLlmResponse>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    if (!llm.sprint_plan?.sprint_id || !llm.first_task?.task_id) {
      throw new Error("Sprint planning LLM response missing required fields");
    }

    context.notify(`🎯 First task identified: *${llm.first_task.task_id}* — ${llm.first_task.title}\n> Effort: ${llm.first_task.estimated_effort}`);

    // Format artifacts (mirrors Sprint Controller format)
    const sprintPlanContent = this.formatSprintMarkdown(llm.sprint_plan, llm.first_task);
    const briefContent = this.formatBrief(llm.first_task, llm.task_flags, llm.sprint_plan);
    const currentTask = {
      task_id: llm.first_task.task_id,
      title: llm.first_task.title,
      description: llm.first_task.description,
      assigned_to: "implementer",
      status: "pending",
      artifacts: [],
    };

    const sprintPlanPath = await artifactService.write(
      pipelineId,
      `sprint_plan_${llm.sprint_plan.sprint_id.toLowerCase()}.md`,
      sprintPlanContent
    );
    const briefPath = await artifactService.write(pipelineId, "AI_IMPLEMENTATION_BRIEF.md", briefContent);
    const currentTaskPath = await artifactService.write(
      pipelineId,
      "current_task.json",
      JSON.stringify(currentTask, null, 2)
    );

    // Persist to project repo and create sprint branch
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    let sprintBranch: string | undefined;

    if (project) {
      sprintBranch = `feature/${llm.first_task.task_id}`;
      await projectGitService.ensureReady(project);
      await projectGitService.createBranch(project, sprintBranch);
      await pipelineService.setSprintBranch(pipelineId, sprintBranch);
      context.notify(`🌿 Branch \`${sprintBranch}\` created and ready`);

      const repoBase = path.isAbsolute(project.clone_path)
        ? project.clone_path
        : path.join(process.cwd(), project.clone_path);
      const activeDir = path.join(repoBase, "project_work", "ai_project_tasks", "active");
      await fs.mkdir(activeDir, { recursive: true });
      await fs.writeFile(
        path.join(activeDir, `sprint_plan_${llm.sprint_plan.sprint_id.toLowerCase()}.md`),
        sprintPlanContent,
        "utf-8"
      );
      await fs.writeFile(path.join(activeDir, "AI_IMPLEMENTATION_BRIEF.md"), briefContent, "utf-8");
      await fs.writeFile(
        path.join(activeDir, "current_task.json"),
        JSON.stringify(currentTask, null, 2),
        "utf-8"
      );
      await projectGitService.commitAll(
        project,
        sprintBranch,
        `chore(${llm.first_task.task_id}): stage sprint artifacts`
      );
      context.notify(`📋 Sprint artifacts committed to \`active/\` on \`${sprintBranch}\``);
    }

    return {
      phase_id: llm.sprint_plan.phase_id,
      artifact_path: sprintPlanPath,
    };
  }

  private formatSprintMarkdown(
    plan: { sprint_id: string; phase_id: string; name: string; goals: string[]; tasks: string[]; status: string },
    firstTask: { task_id: string; title: string; description: string; estimated_effort: string; files_likely_affected: string[]; acceptance_criteria: string[] }
  ): string {
    const goals = plan.goals.map((g) => `- ${g}`).join("\n");
    const tasks = plan.tasks.map((t) => `- ${t}`).join("\n");
    return `# Sprint Plan: ${plan.sprint_id}

**Phase:** ${plan.phase_id}
**Name:** ${plan.name}
**Status:** ${plan.status}

## Goals
${goals}

## Tasks
${tasks}

---

## First Task Detail: ${firstTask.task_id}

**${firstTask.title}** [${firstTask.estimated_effort}]

${firstTask.description}

**Files likely affected:**
${firstTask.files_likely_affected.map((f) => `- \`${f}\``).join("\n")}

**Acceptance criteria:**
${firstTask.acceptance_criteria.map((c) => `- ${c}`).join("\n")}
`;
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
