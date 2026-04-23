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

  /**
   * Removes the artifact directory for a completed pipeline.
   * Safe to call multiple times — ENOENT is silently ignored.
   * Must only be called after a successful git push has been confirmed.
   */
  async cleanup(pipelineId: string): Promise<void> {
    const dir = path.join(this.basePath, pipelineId);
    logger.info("Artifact cleanup: removing directory", { pipeline_id: pipelineId, path: dir });
    await fs.rm(dir, { recursive: true, force: true });
  }

  /**
   * Scans all pipeline artifact directories and removes those that are stale.
   * A directory is stale if it is older than ARTIFACT_RETENTION_DAYS AND belongs to a
   * pipeline in a terminal-failure state (failed/cancelled), or has no matching DB row.
   *
   * Safe to call concurrently across multiple instances — fs.rm({ force: true }) is idempotent.
   */
  async cleanupStale(
    isTerminalFailure: (pipelineId: string) => Promise<boolean>
  ): Promise<void> {
    const retentionMs = config.artifactRetentionDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;

    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(this.basePath, { withFileTypes: true });
    } catch {
      // Base path doesn't exist yet — nothing to clean up
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pipelineId = entry.name;
      const dir = path.join(this.basePath, pipelineId);

      try {
        const stat = await fs.stat(dir);
        if (stat.mtimeMs > cutoff) continue;

        const stale = await isTerminalFailure(pipelineId);
        if (!stale) continue;

        logger.info("Artifact GC: removing stale directory", { pipeline_id: pipelineId, path: dir });
        await fs.rm(dir, { recursive: true, force: true });
      } catch (err) {
        logger.error("Artifact GC: error processing directory", { pipeline_id: pipelineId, error: String(err) });
      }
    }
  }
}

export const artifactService = new ArtifactService();

