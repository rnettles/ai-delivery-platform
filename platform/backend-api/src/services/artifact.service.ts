import fs from "fs/promises";
import path from "path";
import { config } from "../config";
import { logger } from "./logger.service";

/**
 * Reads and writes pipeline artifacts to the local filesystem.
 * In production, ARTIFACT_BASE_PATH points to the Azure Files mount.
 * Artifacts are organised under {basePath}/{pipelineId}/{filename}.
 */
export class ArtifactService {
  private get basePath(): string {
    return config.artifactBasePath;
  }

  async write(pipelineId: string, filename: string, content: string): Promise<string> {
    const dir = path.join(this.basePath, pipelineId);
    await fs.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, filename);
    await fs.writeFile(absPath, content, "utf-8");
    const relPath = path.relative(process.cwd(), absPath).replace(/\\/g, "/");
    logger.info("Artifact written", { pipeline_id: pipelineId, path: relPath });
    return relPath;
  }

  async read(artifactPath: string): Promise<string> {
    const resolved = path.isAbsolute(artifactPath)
      ? artifactPath
      : path.join(process.cwd(), artifactPath);
    return fs.readFile(resolved, "utf-8");
  }

  async tryRead(artifactPath: string): Promise<string | null> {
    try {
      return await this.read(artifactPath);
    } catch {
      return null;
    }
  }

  /** Returns the first readable artifact from a list of paths, or null. */
  async findFirst(paths: string[]): Promise<{ path: string; content: string } | null> {
    for (const p of paths) {
      const content = await this.tryRead(p);
      if (content !== null) {
        return { path: p, content };
      }
    }
    return null;
  }
}

export const artifactService = new ArtifactService();

