import fs from "fs/promises";
import path from "path";
import { Script, ScriptExecutionContext } from "./script.interface";
import { llmFactory } from "../services/llm/llm-factory.service";
import { artifactService } from "../services/artifact.service";
import { governanceService } from "../services/governance.service";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { projectGitService } from "../services/project-git.service";
import { designInputGateService } from "../services/design-input-gate.service";
import { HttpError } from "../utils/http-error";

export interface PlannerInput {
  description: string;
  project_context?: string;
  previous_artifacts?: string[];
  pipeline_id?: string;
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
  phase_id: string;
  phase_plan: PlannerPhasePlan;
  artifact_path: string;
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
      required: ["phase_id", "phase_plan", "artifact_path"],
      properties: {
        phase_id: { type: "string" },
        phase_plan: { type: "object" },
        artifact_path: { type: "string" },
      },
    },
    tags: ["role", "planner", "planning"],
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    const typed = input as Partial<PlannerInput>;
    const description = typed.description?.trim() || "Unspecified objective";
    const pipelineId = typed.pipeline_id ?? context.correlation_id ?? context.execution_id;

    context.log("Planner running", { description_length: description.length });
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

    const designInputs = await designInputGateService.requireRelevantDesignInputs(pipelineId, "planner");
    context.notify(
      `📚 Design inputs loaded: ${designInputs.fr_context.length} FR/PRD, ` +
      `${designInputs.adr_context.length} ADR, ${designInputs.tdn_context.length} TDN file(s) ` +
      `from project \`${designInputs.project_name}\``
    );

    // Read already-claimed FR IDs from existing phase plans in the project repo
    const stagedPhasesDir = path.join(
      designInputs.clone_path,
      "ai_dev_stack",
      "ai_project_tasks",
      "staged_phases"
    );
    const claimedFrIds = await this.readClaimedFrIds(stagedPhasesDir);
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

    const claimedSection = claimedFrIds.length > 0
      ? `# Already Claimed FR IDs\n\n` +
        `These FR identifiers are already covered by existing phase plans. ` +
        `DO NOT include them in fr_ids_in_scope unless this phase is explicitly superseding a prior plan. ` +
        `If all FRs in the provided documents are already claimed and there is nothing left to plan, ` +
        `return: {"error": "NO_UNMET_FRS", "message": "All known FRs are already covered by existing phases."}\n\n` +
        claimedFrIds.map((id) => `- ${id}`).join("\n")
      : "";

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
      const errorMsg =
        (planAsRecord["message"] as string | undefined) ??
        `Planner stopped with error code: ${errorCode}`;
      throw new HttpError(422, errorCode, errorMsg, {
        claimed_fr_ids: claimedFrIds,
        fr_context_files: designInputs.fr_context.map((f) => f.path),
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

    // Artifact path follows ai_dev_stack governance naming convention:
    // phase_plan_<descriptor>.md
    const descriptor = plan.phase_id.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const artifactFilename = `phase_plan_${descriptor}.md`;
    const artifactContent = this.formatMarkdown(plan);
    const artifactPath = await artifactService.write(pipelineId, artifactFilename, artifactContent);

    // Persist to project repo: ai_dev_stack/ai_project_tasks/staged_phases/ (AI_PHASE_PROCESS.md)
    const run = await pipelineService.get(pipelineId);
    const project = run.project_id ? await projectService.getById(run.project_id) : null;
    if (project) {
      const repoRelPath = path.join("ai_dev_stack", "ai_project_tasks", "staged_phases", artifactFilename);
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
}
