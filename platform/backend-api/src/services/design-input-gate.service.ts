import fs from "fs/promises";
import path from "path";
import { pipelineService } from "./pipeline.service";
import { projectService } from "./project.service";
import { HttpError } from "../utils/http-error";

// Roots searched in priority order — FRs and PRD first, then design artifacts
const FR_ROOTS = ["docs/functional_requirements", "docs/prd"];
const DESIGN_ROOTS = ["docs/functional_requirements", "docs/prd", "docs/design", "docs/architecture"];

const DESIGN_FILE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

// Maximum characters per file loaded into LLM context (prevents token overflow)
const MAX_FILE_CHARS = 6000;
// Maximum number of files to load as context
const MAX_CONTEXT_FILES = 6;

export interface DesignFile {
  path: string;
  content: string;
}

export interface DesignInputGateResult {
  project_id: string;
  project_name: string;
  clone_path: string;
  /** File paths found (without content — for logging/notification) */
  sample_files: string[];
  /** FR/PRD files loaded with truncated content for LLM context injection */
  fr_context: DesignFile[];
}

export class DesignInputGateService {
  /**
   * Validates that design inputs exist AND loads FR/PRD content for LLM injection.
   * Throws HTTP 422 DESIGN_INPUT_MISSING if the project is not mapped or no design
   * files are found. The returned fr_context is ready to inject into the LLM user message.
   */
  async requireRelevantDesignInputs(pipelineId: string, role: string): Promise<DesignInputGateResult> {
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

    // Load FR/PRD content for LLM context injection
    const frContext = await this.loadFrContext(repoRoot);

    return {
      project_id: project.project_id,
      project_name: project.name,
      clone_path: repoRoot,
      sample_files: sampleFiles,
      fr_context: frContext,
    };
  }

  /**
   * Loads content of FR/PRD files (truncated) for injection into LLM user messages.
   * Prioritises docs/functional_requirements then docs/prd.
   */
  private async loadFrContext(repoRoot: string): Promise<DesignFile[]> {
    const loaded: DesignFile[] = [];

    for (const root of FR_ROOTS) {
      const absRoot = path.join(repoRoot, root);
      const filePaths = await this.collectFiles(absRoot, repoRoot, 0, 3, MAX_CONTEXT_FILES - loaded.length);

      for (const relPath of filePaths) {
        if (loaded.length >= MAX_CONTEXT_FILES) break;
        try {
          const raw = await fs.readFile(path.join(repoRoot, relPath), "utf-8");
          const content = raw.length > MAX_FILE_CHARS
            ? raw.slice(0, MAX_FILE_CHARS) + `\n\n[...truncated at ${MAX_FILE_CHARS} chars — see ${relPath} for full content]`
            : raw;
          loaded.push({ path: relPath, content });
        } catch {
          // File unreadable — skip
        }
      }

      if (loaded.length >= MAX_CONTEXT_FILES) break;
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

    let entries: fs.Dirent[];
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
        const nested = await this.collectFiles(abs, repoRoot, depth + 1, maxDepth, limit - out.length);
        out.push(...nested);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!DESIGN_FILE_EXTENSIONS.has(ext)) continue;

      const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
      out.push(rel);
    }

    return out;
  }
}

export const designInputGateService = new DesignInputGateService();
