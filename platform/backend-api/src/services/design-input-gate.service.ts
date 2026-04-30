import fs from "fs/promises";
import { Dirent } from "fs";
import path from "path";
import { pipelineService } from "./pipeline.service";
import { projectService } from "./project.service";
import { projectGitService } from "./project-git.service";
import { HttpError } from "../utils/http-error";

// Document roots by category — searched in priority order within each category
const FR_ROOTS = ["docs/functional_requirements", "docs/prd"];
const ADR_ROOTS = ["docs/adr"];
const TDN_ROOTS = ["docs/design/tdn"];  // TDNs only in tdn/ subdirectory — design_system.md, ux_principles.md etc. are reference docs
const DESIGN_ROOTS = [...FR_ROOTS, ...ADR_ROOTS, ...TDN_ROOTS];
const INTAKE_ROOT = "project_work/ai_project_tasks/intake";

export type EntryMode = "intake" | "plan";

/**
 * Phase 7 (ADR-033): role-aware loading profiles. Determines how much design
 * context the gate loads into memory for each role. The full file walk for
 * `sample_files` always runs (cheap, validates the project layout), but
 * fr/adr/tdn content loads are scoped per role.
 */
export type RoleProfile = "planner" | "sprint-controller" | "implementer" | "verifier";

interface LoadProfile {
  fr: number;
  adr: number;
  tdn: number;
}

const DEFAULT_PROFILE: LoadProfile = { fr: 4, adr: 3, tdn: 3 };

const ROLE_LOAD_PROFILES: Record<RoleProfile, LoadProfile> = {
  planner: { fr: 4, adr: 3, tdn: 3 },
  // Sprint controller: FRs only — ADR/TDN already filtered by phase plan.
  "sprint-controller": { fr: 2, adr: 0, tdn: 0 },
  // Implementer: brief carries explicit `## Design References` (Phase 2). The gate
  // only validates layout; design content is injected from brief refs at call site.
  implementer: { fr: 0, adr: 0, tdn: 0 },
  // Verifier: governed by AI_RULES.md and brief task flags only — design content not needed.
  verifier: { fr: 0, adr: 0, tdn: 0 },
};

const DESIGN_FILE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

// Files matching these patterns are scaffolding/reference only and must not be loaded
// as design inputs or counted as FRD/TDN candidates.
const EXCLUDED_FILENAME_PATTERNS = [
  /^TEMPLATE_/i,
  /^README(\..+)?$/i,
];

// Maximum characters per file loaded into LLM context (prevents token overflow)
const MAX_FILE_CHARS = 6000;

export interface DesignFile {
  path: string;
  content: string;
}

export interface DesignInputGateResult {
  project_id: string;
  project_name: string;
  clone_path: string;
  entry_mode: EntryMode;
  /** File paths found across all roots (without content — for logging/notification) */
  sample_files: string[];
  /** FR/PRD files loaded with content for LLM context injection (primary planning inputs) */
  fr_context: DesignFile[];
  /** ADR files loaded with content so the planner can evaluate compliance and congruency */
  adr_context: DesignFile[];
  /** TDN/architecture files loaded with content so the planner can consider design constraints */
  tdn_context: DesignFile[];
  /** Intake item context (intake-drafting mode only) */
  intake_context?: DesignFile[];
}

export class DesignInputGateService {
  /**
   * Validates that design inputs exist AND loads FR/PRD content for LLM injection.
   * Throws HTTP 422 DESIGN_INPUT_MISSING if the project is not mapped or no design
    * files are found. Throws HTTP 422 NO_APPROVED_FRDS if entry_mode is 'plan' and
    * no FRD with 'Status: Approved' exists. Throws HTTP 422 NO_APPROVED_TDNS if
    * TDN artifacts are present but none are Approved (ADR-008 authority boundary).
   * The returned fr_context is ready to inject into the LLM user message.
   */
  async requireRelevantDesignInputs(
    pipelineId: string,
    role: string,
    entryMode: EntryMode = "plan",
    roleProfile?: RoleProfile
  ): Promise<DesignInputGateResult> {
    const run = await pipelineService.get(pipelineId);
    if (!run.project_id) {
      throw new HttpError(
        422,
        "DESIGN_INPUT_MISSING",
        `Role '${role}' requires a project-mapped pipeline run so design inputs can be validated.`,
        { role, pipeline_id: pipelineId }
      );
    }

    const project = await projectService.getById(run.project_id);
    if (!project) {
      throw new HttpError(
        422,
        "DESIGN_INPUT_MISSING",
        `Role '${role}' requires a project-mapped pipeline run, but the project could not be found.`,
        { role, pipeline_id: pipelineId, project_id: run.project_id }
      );
    }

    // Phase 13 (ADR-033): throttle forcePull. Only re-pull on the first invocation
    // of this pipeline run (within 60s of creation) or when an operator forces it.
    // Cuts redundant `git fetch + reset --hard` latency on subsequent role calls.
    if (project) {
      const createdAtMs = run.created_at ? Date.parse(run.created_at) : NaN;
      const firstInvocation = Number.isFinite(createdAtMs)
        ? Date.now() - createdAtMs < 60_000
        : true;
      const operatorForcedPull = (run.metadata as Record<string, unknown> | undefined)
        ?.operator_forced_pull === true;
      const shouldForcePull = firstInvocation || operatorForcedPull;
      await projectGitService.ensureReady(project, { forcePull: shouldForcePull });
    }

    const repoRoot = path.isAbsolute(project.clone_path)
      ? project.clone_path
      : path.join(process.cwd(), project.clone_path);

    const sampleFiles = await this.findDesignInputs(repoRoot);
    if (sampleFiles.length === 0) {
      throw new HttpError(
        422,
        "DESIGN_INPUT_MISSING",
        `Role '${role}' cannot proceed: no relevant input design files were found in the project repository. ` +
          `Expected at least one file under: ${DESIGN_ROOTS.join(", ")}`,
        {
          role,
          pipeline_id: pipelineId,
          project_id: project.project_id,
          expected_roots: DESIGN_ROOTS,
        }
      );
    }
    // Phase 7 (ADR-033): resolve effective load profile. roleProfile param wins;
    // otherwise infer from `role` string. Unknown roles fall back to DEFAULT_PROFILE.
    const inferredProfile = (roleProfile
      ?? (Object.keys(ROLE_LOAD_PROFILES) as RoleProfile[]).find((r) => r === role))
      ?? null;
    const loadProfile: LoadProfile = inferredProfile
      ? ROLE_LOAD_PROFILES[inferredProfile]
      : DEFAULT_PROFILE;

    // Load design artifact content for LLM context injection (scoped to role profile)
    const frContext = loadProfile.fr > 0
      ? await this.loadContext(repoRoot, FR_ROOTS, loadProfile.fr)
      : [];
    const adrContext = loadProfile.adr > 0
      ? await this.loadContext(repoRoot, ADR_ROOTS, loadProfile.adr)
      : [];
    const tdnContext = loadProfile.tdn > 0
      ? await this.loadContext(repoRoot, TDN_ROOTS, loadProfile.tdn)
      : [];

    // Human-AI authority boundary (ADR-008): in plan mode, require at least one Approved FRD
    if (entryMode === "plan") {
      const nonApprovedFrds = this.getNonApprovedFiles(frContext, "Status: Approved", (file) =>
        file.path.includes("docs/functional_requirements") ||
        /(^|\/)FRD[-_]/i.test(file.path) ||
        file.content.includes("FR Document ID:")
      );
      const frdCandidates = frContext.filter(
        (file) =>
          file.path.includes("docs/functional_requirements") ||
          /(^|\/)FRD[-_]/i.test(file.path) ||
          file.content.includes("FR Document ID:")
      );

      if (frdCandidates.length > 0 && nonApprovedFrds.length === frdCandidates.length) {
        throw new HttpError(
          422,
          "NO_APPROVED_FRDS",
          `Role '${role}' cannot produce a phase plan: no FRDs with Status: Approved were found. ` +
            `Human approval of FRDs is required before phase planning can proceed (ADR-008).`,
          {
            role,
            pipeline_id: pipelineId,
            project_id: project.project_id,
            draft_frds: nonApprovedFrds,
          }
        );
      }
    }

    // Load intake context in intake mode
    const intakeContext =
      entryMode === "intake" ? await this.loadIntakeContext(repoRoot) : undefined;

    return {
      project_id: project.project_id,
      project_name: project.name,
      clone_path: repoRoot,
      entry_mode: entryMode,
      sample_files: sampleFiles,
      fr_context: frContext,
      adr_context: adrContext,
      tdn_context: tdnContext,
      ...(intakeContext !== undefined && { intake_context: intakeContext }),
    };
  }

  /**
   * Loads the most recent open intake item's INTAKE.md for intake-drafting mode.
   * Returns up to 1 file from the intake root.
   */
  private async loadIntakeContext(repoRoot: string): Promise<DesignFile[]> {
    return this.loadContext(repoRoot, [INTAKE_ROOT], 1);
  }

  private getNonApprovedFiles(
    files: DesignFile[],
    requiredStatusLine: string,
    predicate?: (file: DesignFile) => boolean
  ): string[] {
    return files
      .filter((file) => (predicate ? predicate(file) : true))
      .filter((file) => !file.content.includes(requiredStatusLine))
      .map((file) => file.path);
  }

  /**
   * Loads file contents (truncated to MAX_FILE_CHARS) from the given root directories.
   * Files are collected in priority order across roots up to maxFiles total.
   */
  private async loadContext(repoRoot: string, roots: string[], maxFiles: number): Promise<DesignFile[]> {
    const loaded: DesignFile[] = [];

    for (const root of roots) {
      if (loaded.length >= maxFiles) break;
      const absRoot = path.join(repoRoot, root);
      const filePaths = await this.collectFiles(absRoot, repoRoot, 0, 3, maxFiles - loaded.length);

      for (const relPath of filePaths) {
        if (loaded.length >= maxFiles) break;
        try {
          const raw = await fs.readFile(path.join(repoRoot, relPath), "utf-8");
          const content =
            raw.length > MAX_FILE_CHARS
              ? raw.slice(0, MAX_FILE_CHARS) +
                `\n\n[...truncated at ${MAX_FILE_CHARS} chars — see ${relPath} for full content]`
              : raw;
          loaded.push({ path: relPath, content });
        } catch {
          // File unreadable — skip
        }
      }
    }

    return loaded;
  }

  private async findDesignInputs(repoRoot: string): Promise<string[]> {
    const collected: string[] = [];

    for (const designRoot of DESIGN_ROOTS) {
      const absoluteRoot = path.join(repoRoot, designRoot);
      const files = await this.collectFiles(absoluteRoot, repoRoot, 0, 5, 25);
      for (const file of files) {
        collected.push(file);
        if (collected.length >= 25) return collected;
      }
    }

    return collected;
  }

  private async collectFiles(
    absoluteDir: string,
    repoRoot: string,
    depth: number,
    maxDepth: number,
    limit: number
  ): Promise<string[]> {
    if (depth > maxDepth || limit <= 0) return [];

    let entries: Dirent[];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const out: string[] = [];

    for (const entry of entries) {
      if (out.length >= limit) break;
      const abs = path.join(absoluteDir, entry.name);

      if (entry.isDirectory()) {
        // Skip archive/superseded directories — don't load old/replaced artifacts
        if (/^superseded$/i.test(entry.name)) continue;
        
        const nested = await this.collectFiles(abs, repoRoot, depth + 1, maxDepth, limit - out.length);
        out.push(...nested);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!DESIGN_FILE_EXTENSIONS.has(ext)) continue;
      if (EXCLUDED_FILENAME_PATTERNS.some((p) => p.test(entry.name))) continue;

      const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
      out.push(rel);
    }

    return out;
  }
}

export const designInputGateService = new DesignInputGateService();
