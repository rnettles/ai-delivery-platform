import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { config } from "../config";
import { GitSyncContext } from "../domain/execution.types";
import { logger } from "./logger.service";

export class GitSyncService {
  private readonly clonePath: string;

  constructor() {
    this.clonePath = resolve(process.cwd(), config.gitClonePath);
  }

  /**
   * Sync the configured repository:
   * - Clones if the clone path does not exist.
   * - Pulls (fast-forward only) if it already exists.
   *
   * Credentials are injected via the PAT-embedded URL so no credential
   * store or SSH key is required (ADR-011).
   */
  async sync(): Promise<GitSyncContext> {
    const { repoUrl, clonePath } = this.resolvedArgs();

    if (!repoUrl) {
      logger.info("git-sync: GIT_REPO_URL not configured, skipping sync");
      return { repo_path: clonePath, is_repo_accessible: false };
    }

    try {
      if (existsSync(join(clonePath, ".git"))) {
        logger.info("git-sync: pulling", { clonePath });
        execFileSync("git", ["pull", "--ff-only"], {
          cwd: clonePath,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: this.gitEnv(),
        });
      } else {
        logger.info("git-sync: cloning", { repoUrl: this.redactedUrl(repoUrl), clonePath });
        execFileSync("git", ["clone", "--depth", "1", repoUrl, clonePath], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: this.gitEnv(),
        });
      }

      return this.getContext(clonePath);
    } catch (err) {
      logger.error("git-sync: failed", { error: String(err) });
      return { repo_path: clonePath, is_repo_accessible: false };
    }
  }

  /**
   * Returns the current GitSyncContext for the clone path without triggering
   * a sync. Used by the execution service to stamp each execution record.
   */
  getContext(repoPath?: string): GitSyncContext {
    const target = repoPath ?? this.clonePath;
    try {
      const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: target,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      return { repo_path: target, head_commit: headCommit, is_repo_accessible: true };
    } catch {
      return { repo_path: target, is_repo_accessible: false };
    }
  }

  private resolvedArgs(): { repoUrl: string; clonePath: string } {
    const pat = config.gitPat;
    const rawUrl = config.gitRepoUrl;

    // Embed PAT into URL: https://PAT@github.com/org/repo.git
    const repoUrl = pat && rawUrl
      ? rawUrl.replace(/^(https?:\/\/)/, `$1${encodeURIComponent(pat)}@`)
      : rawUrl;

    return { repoUrl, clonePath: this.clonePath };
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",  // never prompt for credentials
      GIT_ASKPASS: "echo",
    };
  }

  /** Log-safe URL with PAT replaced by *** */
  private redactedUrl(url: string): string {
    return url.replace(/\/\/[^@]+@/, "//***@");
  }
}

export const gitSyncService = new GitSyncService();
