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
  async ensureReady(project: Project, opts?: { forcePull?: boolean }): Promise<GitSyncContext> {
    return this.withLock(project.project_id, () => this.doEnsureReady(project, opts?.forcePull ?? false));
  }

  /**
   * Like ensureReady but assumes the per-project lock is already held by the caller.
   * Use this when calling from inside withProjectLock to avoid self-deadlock.
   */
  async ensureReadyUnderLock(project: Project, opts?: { forcePull?: boolean }): Promise<GitSyncContext> {
    return this.doEnsureReady(project, opts?.forcePull ?? false);
  }

  /**
   * Execute a custom git operation under the same per-project mutex used by built-in methods.
   * This keeps admin repair operations serialized with normal pipeline git actions.
   */
  async withProjectLock<T>(projectId: string, fn: () => T | Promise<T>): Promise<T> {
    return this.withLock(projectId, fn);
  }

  /**
   * Create and check out a new branch.
   *
   * Behavior:
   *  - If local branch exists only locally: treat as stale retry state and recreate it
   *  - If remote branch exists: fail fast
   *  - Else: create a new branch from current default-branch HEAD
   * Caller must have called ensureReady() first.
   */
  async createBranch(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: creating branch", { project: project.name, branch: branchName });
      this.checkoutWithIndexRecovery(project.clone_path, project.default_branch, project.name);
      this.git(project.clone_path, ["pull", "--ff-only"]);
      // Fetch the specific branch by name so shallow clones with a narrow refspec
      // (+refs/heads/main:refs/remotes/origin/main) still populate the remote ref
      // for branchExistsRemote() and, if the branch already exists, for --track checkout.
      // Tolerate failure (the branch may not exist yet on origin).
      try {
        this.git(project.clone_path, ["fetch", "origin", branchName]);
      } catch {
        // branch doesn't exist on origin yet — that's the expected path for a new branch
      }

      if (this.branchExistsRemote(project.clone_path, branchName)) {
        // Branch already exists on origin — adopt it so re-runs are idempotent.
        logger.warn("git: branch already exists on origin; checking out existing remote branch", {
          project: project.name,
          branch: branchName,
          clonePath: project.clone_path,
        });
        if (this.branchExistsLocal(project.clone_path, branchName)) {
          this.deleteLocalBranch(project.clone_path, branchName);
        }
        this.git(project.clone_path, ["checkout", "--track", `origin/${branchName}`]);
        return;
      }

      if (this.branchExistsLocal(project.clone_path, branchName)) {
        logger.warn("git: removing stale local branch before recreate", {
          project: project.name,
          branch: branchName,
          clonePath: project.clone_path,
        });
        this.deleteLocalBranch(project.clone_path, branchName);
      }

      this.git(project.clone_path, ["checkout", "-b", branchName]);
    });
  }

  /**
   * Check out an existing local or remote branch without creating a new one.
   * Caller must have called ensureReady() first.
   *
   * Uses an explicit `git fetch origin <branch>` so that shallow clones with a
   * narrow refspec (fetch = +refs/heads/main:refs/remotes/origin/main) still
   * retrieve the sprint branch. `git fetch origin` without a refspec argument
   * only fetches what the config's fetch line covers, which for a --depth 1 clone
   * is main only.
   *
   * Then `git checkout -B <branch> FETCH_HEAD` creates the local branch (or resets
   * it if it already exists) to exactly the remote commit, so re-runs are idempotent.
   */
  async checkoutBranch(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: checking out existing branch", { project: project.name, branch: branchName });
      this.git(project.clone_path, ["fetch", "origin", branchName]);
      this.git(project.clone_path, ["checkout", "-B", branchName, "FETCH_HEAD"]);
    });
  }

  /**
   * Ensure a branch exists on the remote, handling three cases:
   *  1. Branch already on remote: fetch and check it out locally (idempotent).
   *  2. Branch exists only locally (e.g. remote was deleted after PR merge):
   *     push the local branch to re-establish it on the remote.
   *  3. Branch absent everywhere: create from current default-branch HEAD and push.
   *
   * Uses `git ls-remote` to query the actual remote rather than the local cached
   * refs — stale `refs/remotes/origin/<branch>` entries can persist after a remote
   * branch is deleted if the last `git fetch` used a narrow refspec or lacked --prune.
   *
   * Called by the sprint-controller reuse path (publishExistingTaskPackage) so the
   * implementer can always find the feature branch via `git fetch origin <branch>`.
   * Caller must have called ensureReady() first so the clone is on the default branch.
   */
  async ensureBranchOnRemote(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: ensuring branch on remote", { project: project.name, branch: branchName });

      // Query the actual remote — do not rely on cached refs/remotes/origin/* which can
      // be stale when the remote branch was deleted without a prune.
      const remoteHasRef = this.branchExistsOnActualRemote(project.clone_path, branchName);

      if (remoteHasRef) {
        // Case 1: branch is on the actual remote — fetch then check it out locally.
        this.git(project.clone_path, ["fetch", "origin", branchName]);
        if (this.branchExistsLocal(project.clone_path, branchName)) {
          this.deleteLocalBranch(project.clone_path, branchName);
        }
        this.git(project.clone_path, ["checkout", "--track", `origin/${branchName}`]);
        return;
      }

      if (this.branchExistsLocal(project.clone_path, branchName)) {
        // Case 2: branch exists locally only (remote was deleted, e.g. after a PR merge
        // that was not followed by a proper closeout).  Push the local branch to restore
        // the remote ref so the implementer can fetch it.
        logger.warn("git: branch is local-only; pushing to remote to re-establish remote ref", {
          project: project.name,
          branch: branchName,
        });
        this.git(project.clone_path, ["checkout", branchName]);
        this.git(project.clone_path, ["push", "--set-upstream", "origin", branchName]);
        return;
      }

      // Case 3: branch does not exist anywhere — create from current HEAD (default branch
      // after ensureReady) and push so the implementer has a clean starting point.
      logger.warn("git: branch absent locally and remotely; creating from default branch", {
        project: project.name,
        branch: branchName,
      });
      this.git(project.clone_path, ["checkout", "-b", branchName]);
      this.git(project.clone_path, ["push", "--set-upstream", "origin", branchName]);
    });
  }

  /**
   * Stage all changes and commit. Returns the new HEAD commit SHA.
   */
  async commitAll(project: Project, branchName: string, message: string): Promise<string> {
    return this.withLock(project.project_id, () => {
      logger.info("git: committing", { project: project.name, branch: branchName });
      try {
        this.git(project.clone_path, ["checkout", branchName]);
      } catch (err) {
        if (!this.isCheckoutOverwriteError(err)) {
          throw err;
        }

        logger.warn("git: checkout blocked by local changes; stashing and retrying checkout", {
          project: project.name,
          branch: branchName,
          clonePath: project.clone_path,
        });

        this.git(project.clone_path, ["stash", "push", "-u", "-m", `autostash-${branchName}`]);
        this.git(project.clone_path, ["checkout", branchName]);

        try {
          this.git(project.clone_path, ["stash", "pop"]);
        } catch (stashErr) {
          // Stash pop failed due to conflicts between the stashed implementer changes
          // and the branch content.  Recovery: for each conflicted file accept the stash
          // content ("theirs"), stage the resolution, then drop the stash entry.
          // Untracked files stashed with -u (e.g. test_results.json) are already in the
          // working tree from the partial application — they are not affected by this loop.
          logger.warn("git: stash pop conflict; resolving by accepting stash content per file", {
            project: project.name,
            branch: branchName,
          });
          try {
            const unmergedRaw = this.git(project.clone_path, ["diff", "--name-only", "--diff-filter=U"]);
            const unmergedFiles = unmergedRaw.trim().split("\n").filter(Boolean);
            for (const file of unmergedFiles) {
              try {
                this.git(project.clone_path, ["checkout", "--theirs", "--", file]);
                this.git(project.clone_path, ["add", "--", file]);
              } catch { /* best-effort: skip files that cannot be resolved individually */ }
            }
            this.git(project.clone_path, ["stash", "drop"]);
          } catch (recoveryErr) {
            // Even the per-file recovery failed.  Fall back to aborting the partial
            // stash-pop with reset --merge so the clone is left in a clean state.
            try { this.git(project.clone_path, ["reset", "--merge"]); } catch { /* best-effort */ }
            try { this.git(project.clone_path, ["stash", "drop"]); } catch { /* best-effort */ }
            throw new Error(
              `git: checkout recovery failed while reapplying local changes on ${branchName}: ${String(stashErr)} / recovery: ${String(recoveryErr)}`
            );
          }
        }
      }
      this.git(project.clone_path, ["add", "-A"]);
      // --allow-empty in case the LLM made no file changes (produces a recorded attempt)
      this.git(project.clone_path, ["commit", "--allow-empty", "-m", message]);
      return this.headCommit(project.clone_path);
    });
  }

  /**
   * Push a branch to origin.
   *
   * Recovery: if the push is rejected due to non-fast-forward (the remote branch
   * diverged — e.g. a prior pipeline run already pushed commits), we fetch with
   * --update-shallow (safe for shallow clones) then rebase local onto the remote
   * tip and retry once.  If rebase exits non-zero (conflict) we abort and throw
   * a descriptive error so the pipeline step can surface it to the operator.
   */
  async push(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: pushing", { project: project.name, branch: branchName });
      try {
        this.git(project.clone_path, ["push", "--set-upstream", "origin", branchName]);
      } catch (pushErr) {
        const stderr = (pushErr as any)?.stderr ?? String(pushErr);
        if (!/non-fast-forward|rejected/.test(stderr)) throw pushErr;

        // Remote branch has diverged — rebase local onto remote then retry.
        logger.warn("git: push rejected (non-fast-forward); rebasing onto remote", {
          project: project.name,
          branch: branchName,
        });
        this.ensureRemoteBranchRef(project.clone_path, branchName, project.name);

        try {
          this.git(project.clone_path, ["rebase", `origin/${branchName}`]);
        } catch (rebaseErr) {
          try { this.git(project.clone_path, ["rebase", "--abort"]); } catch { /* best-effort */ }
          throw new Error(
            `git: push rejected and rebase failed (conflict or history mismatch) on ${branchName}: ${String(rebaseErr)}`
          );
        }
        // Retry push after successful rebase.
        this.git(project.clone_path, ["push", "--set-upstream", "origin", branchName]);
      }
    });
  }

  /**
   * After a PR merge, reattach the workspace to the default branch, sync it,
   * delete the remote feature branch, and remove the local feature branch.
   */
  async finalizeMergedBranch(project: Project, branchName: string): Promise<void> {
    return this.withLock(project.project_id, () => {
      logger.info("git: finalizing merged branch", {
        project: project.name,
        branch: branchName,
        default_branch: project.default_branch,
      });

      this.git(project.clone_path, ["fetch", "origin", "--prune"]);
      this.checkoutWithIndexRecovery(project.clone_path, project.default_branch, project.name);
      this.git(project.clone_path, ["pull", "--ff-only", "origin", project.default_branch]);

      if (this.branchExistsRemote(project.clone_path, branchName)) {
        this.git(project.clone_path, ["push", "origin", "--delete", branchName]);
      }

      if (this.branchExistsLocal(project.clone_path, branchName)) {
        this.deleteLocalBranch(project.clone_path, branchName);
      }
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

  private async doEnsureReady(project: Project, forcePull: boolean): Promise<GitSyncContext> {
    const state = this.getState(project.project_id);
    const now = Date.now();
    const needsSync = forcePull || (now - state.lastSyncAt > SYNC_TTL_MS);

    const repoUrl = this.authedUrl(project.repo_url);
    const clonePath = project.clone_path;

    if (!repoUrl) {
      logger.info("git: no repo URL configured for project", { project: project.name });
      return { repo_path: clonePath, is_repo_accessible: false };
    }

    try {
      if (existsSync(join(clonePath, ".git"))) {
        if (needsSync) {
          // fetch + reset --hard when forcePull is set so local modifications written
          // by prior executions (governance templates, planning artifacts) never block
          // the update. git pull --ff-only aborts when local changes conflict with the
          // incoming merge and that error was previously swallowed, leaving the clone
          // permanently stale. forcePull is used for pre-execution gate reads only;
          // in-progress branch work uses the TTL path and is never reset.
          if (forcePull) {
            logger.info("git: fetch + reset (force-pull)", { project: project.name, clonePath });
            this.git(clonePath, ["fetch", "origin"]);
            // Checkout the default branch before reset so an in-progress feature branch
            // left checked out by a prior sprint-controller run is never clobbered.
            // reset --hard only moves the currently checked-out branch's ref.
            this.checkoutWithIndexRecovery(clonePath, project.default_branch, project.name);
            this.git(clonePath, ["reset", "--hard", `origin/${project.default_branch}`]);
          } else {
            // Reattach a detached HEAD before pulling — detached state causes pull to fail.
            this.ensureAttachedHead(clonePath, project.default_branch);
            // Discard any uncommitted local changes that would block the pull.
            this.cleanWorkingTree(clonePath);
            logger.info("git: pulling (TTL expired)", { project: project.name, clonePath });
            try {
              this.git(clonePath, ["pull", "--ff-only"]);
            } catch (pullErr) {
              // Fall back to fetch + reset when fast-forward is not possible
              // (local branch diverged from remote — e.g. shallow clone extended).
              const currentBranch = this.git(clonePath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
              logger.warn("git: pull --ff-only failed; falling back to fetch + reset", {
                project: project.name,
                branch: currentBranch,
                error: String(pullErr),
              });
              this.git(clonePath, ["fetch", "origin"]);
              this.git(clonePath, ["reset", "--hard", `origin/${currentBranch}`]);
            }
          }
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

  /**
   * Detect and recover from a detached HEAD by checking out the default branch.
   * A detached HEAD happens when a prior git operation checked out a commit directly
   * rather than a branch ref, leaving subsequent pull/push operations in an undefined state.
   */
  private ensureAttachedHead(clonePath: string, defaultBranch: string): void {
    try {
      this.git(clonePath, ["symbolic-ref", "--quiet", "HEAD"]);
    } catch {
      logger.warn("git: detached HEAD detected; re-attaching to default branch", { clonePath, defaultBranch });
      this.git(clonePath, ["checkout", defaultBranch]);
    }
  }

  /**
   * Discard uncommitted local changes (tracked files) and untracked files/dirs
   * that would block a pull or checkout.  Only called on the TTL sync path where
   * no in-flight sprint work should be present in the working tree.
   */
  private cleanWorkingTree(clonePath: string): void {
    try {
      this.git(clonePath, ["diff", "--quiet"]);
      this.git(clonePath, ["diff", "--cached", "--quiet"]);
    } catch {
      logger.warn("git: dirty working tree detected; discarding local changes", { clonePath });
      // Drop any stash entries accumulated from prior failed checkpoint commits.
      // These are autostash entries created by commitAll's recovery path and are
      // safe to discard since they represent in-progress work that failed to commit.
      try { this.git(clonePath, ["stash", "clear"]); } catch { /* best-effort */ }
      // Clear any unresolved merge / stash-pop conflict state from the index.
      // git reset --mixed HEAD resets the index to HEAD without touching the working
      // tree, so a subsequent `checkout -- .` can proceed without
      // "error: path '...' is unmerged".
      try { this.git(clonePath, ["reset", "--mixed", "HEAD"]); } catch { /* best-effort */ }
      this.git(clonePath, ["checkout", "--", "."]);
      this.git(clonePath, ["clean", "-fd"]);
    }
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

  /**
   * Query the actual remote (via `git ls-remote`) rather than the local cached
   * refs. Used where stale refs/remotes/origin/<branch> could give a false positive
   * (e.g. when the remote branch was deleted without a subsequent --prune fetch).
   */
  private branchExistsOnActualRemote(clonePath: string, branchName: string): boolean {
    try {
      const output = this.git(clonePath, ["ls-remote", "--heads", "origin", branchName]);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  private ensureRemoteBranchRef(clonePath: string, branchName: string, projectName: string): void {
    // Ensure origin fetches all heads into refs/remotes/origin/* before rebase.
    this.git(clonePath, ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
    this.git(clonePath, ["fetch", "origin", "--prune", "--update-shallow"]);

    if (this.branchExistsRemote(clonePath, branchName)) {
      return;
    }

    logger.warn("git: upstream branch ref missing after full fetch; attempting explicit ref fetch", {
      project: projectName,
      branch: branchName,
      clonePath,
    });

    // Explicitly hydrate the single branch remote-tracking ref.
    try {
      this.git(clonePath, [
        "fetch",
        "origin",
        "--update-shallow",
        `+refs/heads/${branchName}:refs/remotes/origin/${branchName}`,
      ]);
    } catch {
      // Fall through and validate existence below.
    }

    if (!this.branchExistsRemote(clonePath, branchName)) {
      throw new Error(
        `git: push rejected but upstream branch is missing on origin/${branchName}; cannot rebase local history`
      );
    }
  }

  private deleteLocalBranch(clonePath: string, branchName: string): void {
    this.git(clonePath, ["branch", "-D", branchName]);
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

  private isCheckoutOverwriteError(err: unknown): boolean {
    const text = String((err as any)?.stderr ?? err ?? "");
    return /would be overwritten by checkout/i.test(text);
  }

  private isUnresolvedIndexError(err: unknown): boolean {
    const text = String((err as any)?.stderr ?? (err as any)?.stdout ?? err ?? "");
    return /you need to resolve your current index first/i.test(text);
  }

  /**
   * Checkout a branch with automatic recovery from an unresolved-index state.
   *
   * Git leaves the index in an unresolved state when a merge, rebase, or stash-pop
   * is interrupted by a conflict.  Subsequent checkouts fail with
   * "you need to resolve your current index first".
   *
   * Recovery: `git reset --hard HEAD` discards all staged/unstaged conflict markers
   * and aborts any in-progress merge operation, returning the working tree to a clean
   * state so the checkout can be retried.
   */
  private checkoutWithIndexRecovery(clonePath: string, branchName: string, projectName: string): void {
    try {
      this.git(clonePath, ["checkout", branchName]);
    } catch (err) {
      if (!this.isUnresolvedIndexError(err)) throw err;

      logger.warn(
        "git: checkout blocked by unresolved index (interrupted merge/rebase); resetting index and retrying",
        { project: projectName, branch: branchName, clonePath }
      );
      this.git(clonePath, ["reset", "--hard", "HEAD"]);
      this.git(clonePath, ["checkout", branchName]);
    }
  }
}

export const projectGitService = new ProjectGitService();
