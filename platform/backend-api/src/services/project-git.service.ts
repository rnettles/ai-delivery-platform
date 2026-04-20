import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { GitSyncContext } from "../domain/execution.types";
import { config } from "../config";
import { logger } from "./logger.service";
import { Project } from "./project.service";

const SYNC_TTL_MS = Number(process.env.GIT_SYNC_TTL_MS ?? 120_000); // 120s default

interface ProjectSyncState {
  lastSyncAt: number;
  // Serialised mutex: each op chains onto the previous promise
  lock: Promise<void>;
}

/**
 * Project-keyed git service (ADR-028).
 *
 * Responsibilities:
 *  - Clone-once per project to its dedicated path on Azure Files
 *  - TTL-guarded pull: re-pull only when the last sync is older than SYNC_TTL_MS
 *  - Per-project async mutex: prevents concurrent git operations on the same repo
 *  - Branch operations required for autonomous sprint execution (ADR-030):
 *    createBranch, commitAll, push
 */
class ProjectGitService {
  private syncState = new Map<string, ProjectSyncState>();

  // ─── PUBLIC API ──────────────────────────────────────────────────────────

  /**
   * Ensure the project repo is cloned and up-to-date (within TTL).
   * Serialises concurrent callers for the same project via mutex.
   */
  async ensureReady(project: Project): Promise<GitSyncContext> {
    return this.withLock(project.project_id, () => this.doEnsureReady(project));
  }

  /**
   * Ensure a branch exists and check it out.
   *
   * Behavior:
   *  - If local branch exists: checkout it
   *  - Else if remote branch exists: create local tracking branch from origin
   *  - Else: create a new branch from current default-branch HEAD
   *
   * This is intentionally non-destructive for existing branches.
   * Caller must have called ensureReady() first.
   */
  async createBranch(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: creating branch", { project: project.name, branch: branchName });
      this.git(project.clone_path, ["checkout", project.default_branch]);
      this.git(project.clone_path, ["pull", "--ff-only"]);
      this.git(project.clone_path, ["fetch", "origin"]);

      if (this.branchExistsLocal(project.clone_path, branchName)) {
        this.git(project.clone_path, ["checkout", branchName]);
        return;
      }

      if (this.branchExistsRemote(project.clone_path, branchName)) {
        this.git(project.clone_path, ["checkout", "-b", branchName, `origin/${branchName}`]);
        return;
      }

      this.git(project.clone_path, ["checkout", "-b", branchName]);
    });
  }

  /**
   * Stage all changes and commit. Returns the new HEAD commit SHA.
   */
  async commitAll(project: Project, branchName: string, message: string): Promise<string> {
    return this.withLock(project.project_id, () => {
      logger.info("git: committing", { project: project.name, branch: branchName });
      this.git(project.clone_path, ["checkout", branchName]);
      this.git(project.clone_path, ["add", "-A"]);
      // --allow-empty in case the LLM made no file changes (produces a recorded attempt)
      this.git(project.clone_path, ["commit", "--allow-empty", "-m", message]);
      return this.headCommit(project.clone_path);
    });
  }

  /**
   * Push a branch to origin.
   */
  async push(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: pushing", { project: project.name, branch: branchName });
      this.git(project.clone_path, ["push", "--set-upstream", "origin", branchName]);
    });
  }

  /**
   * Returns the current GitSyncContext for a project without triggering sync.
   */
  getContext(project: Project): GitSyncContext {
    try {
      return {
        repo_path: project.clone_path,
        head_commit: this.headCommit(project.clone_path),
        is_repo_accessible: true,
      };
    } catch {
      return { repo_path: project.clone_path, is_repo_accessible: false };
    }
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────────────

  private async doEnsureReady(project: Project): Promise<GitSyncContext> {
    const state = this.getState(project.project_id);
    const now = Date.now();
    const needsSync = now - state.lastSyncAt > SYNC_TTL_MS;

    const repoUrl = this.authedUrl(project.repo_url);
    const clonePath = project.clone_path;

    if (!repoUrl) {
      logger.info("git: no repo URL configured for project", { project: project.name });
      return { repo_path: clonePath, is_repo_accessible: false };
    }

    try {
      if (existsSync(join(clonePath, ".git"))) {
        if (needsSync) {
          logger.info("git: pulling (TTL expired)", { project: project.name, clonePath });
          this.git(clonePath, ["pull", "--ff-only"]);
          state.lastSyncAt = Date.now();
        }
      } else {
        logger.info("git: cloning", { project: project.name, clonePath });
        this.git(".", ["clone", "--depth", "1", repoUrl, clonePath]);
        state.lastSyncAt = Date.now();
      }

      return {
        repo_path: clonePath,
        head_commit: this.headCommit(clonePath),
        is_repo_accessible: true,
      };
    } catch (err) {
      logger.error("git: ensureReady failed", { project: project.name, error: String(err) });
      return { repo_path: clonePath, is_repo_accessible: false };
    }
  }

  /** Serialize operations for a project via a promise chain mutex */
  private withLock<T>(projectId: string, fn: () => T | Promise<T>): Promise<T> {
    const state = this.getState(projectId);
    const next = state.lock.then(() => fn());
    // Swallow errors on the shared lock chain so one failure doesn't deadlock all future ops
    state.lock = next.then(() => undefined, () => undefined);
    return next;
  }

  private getState(projectId: string): ProjectSyncState {
    if (!this.syncState.has(projectId)) {
      this.syncState.set(projectId, { lastSyncAt: 0, lock: Promise.resolve() });
    }
    return this.syncState.get(projectId)!;
  }

  private git(cwd: string, args: string[]): string {
    const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS ?? 120_000);
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: this.gitEnv(),
      timeout: GIT_TIMEOUT_MS,
    });
  }

  private headCommit(clonePath: string): string {
    return this.git(clonePath, ["rev-parse", "HEAD"]).trim();
  }

  private branchExistsLocal(clonePath: string, branchName: string): boolean {
    try {
      this.git(clonePath, ["show-ref", "--verify", `refs/heads/${branchName}`]);
      return true;
    } catch {
      return false;
    }
  }

  private branchExistsRemote(clonePath: string, branchName: string): boolean {
    try {
      this.git(clonePath, ["show-ref", "--verify", `refs/remotes/origin/${branchName}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Embed PAT into URL for credential-free HTTPS auth (ADR-011) */
  private authedUrl(rawUrl: string): string {
    const pat = config.gitPat;
    if (!pat || !rawUrl) return rawUrl;
    return rawUrl.replace(/^(https?:\/\/)/, `$1${encodeURIComponent(pat)}@`);
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "AI Delivery Agent",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "ai-agent@ai-delivery-platform.com",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "AI Delivery Agent",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "ai-agent@ai-delivery-platform.com",
    };
  }
}

export const projectGitService = new ProjectGitService();
