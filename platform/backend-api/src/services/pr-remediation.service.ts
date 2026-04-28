import { execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { HttpError } from "../utils/http-error";
import { GithubApiError, githubApiService, GithubPullRequest } from "./github-api.service";
import { logger } from "./logger.service";
import { Project } from "./project.service";
import { projectGitService } from "./project-git.service";

const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS ?? 120_000);

export interface PrRemediationResult {
  pr: GithubPullRequest;
  preflight_metadata: unknown[];
  remediation_performed: boolean;
}

class PrRemediationService {
  private isDuplicatePrValidationError(error: GithubApiError): boolean {
    if (error.statusCode !== 422) return false;
    const body = (error.responseBody ?? "").toLowerCase();
    return body.includes("a pull request already exists") || body.includes("validation failed");
  }

  private resolveRepoPath(clonePath: string): string {
    return path.isAbsolute(clonePath) ? clonePath : path.join(process.cwd(), clonePath);
  }

  private git(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
      },
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  }

  private tryGit(repoPath: string, args: string[]): { ok: boolean; value?: string; error?: string } {
    try {
      return { ok: true, value: this.git(repoPath, args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async ensureReconcileAndPush(project: Project, head: string): Promise<void> {
    const repoPath = this.resolveRepoPath(project.clone_path);

    const rebaseMerge = path.join(repoPath, ".git", "rebase-merge");
    const rebaseApply = path.join(repoPath, ".git", "rebase-apply");
    const rebaseInProgress = await fs
      .access(rebaseMerge)
      .then(() => true)
      .catch(async () => {
        try {
          await fs.access(rebaseApply);
          return true;
        } catch {
          return false;
        }
      });

    if (rebaseInProgress) {
      throw new HttpError(
        409,
        "PR_CREATE_BLOCKED_REBASE_ACTIVE",
        "Cannot auto-remediate PR creation while a rebase is in progress.",
        { project_id: project.project_id, branch: head }
      );
    }

    this.git(repoPath, ["config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
    this.git(repoPath, ["fetch", "--prune", "origin"]);

    const shallow = this.tryGit(repoPath, ["rev-parse", "--is-shallow-repository"]);
    if (shallow.ok && shallow.value === "true") {
      const unshallow = this.tryGit(repoPath, ["fetch", "--unshallow", "origin"]);
      if (!unshallow.ok) {
        this.git(repoPath, ["fetch", "--depth", "2147483647", "origin"]);
      }
    }

    this.git(repoPath, ["checkout", head]);
    const upstream = this.tryGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (!upstream.ok) {
      const remoteRef = this.tryGit(repoPath, ["show-ref", "--verify", `refs/remotes/origin/${head}`]);
      if (remoteRef.ok) {
        this.git(repoPath, ["branch", "--set-upstream-to", `origin/${head}`, head]);
      }
    }

    const mergeBase = this.tryGit(repoPath, ["merge-base", "HEAD", `origin/${project.default_branch}`]);
    if (!mergeBase.ok) {
      throw new HttpError(
        409,
        "PR_CREATE_BLOCKED_MERGE_BASE",
        "Cannot auto-remediate PR creation because merge-base is invalid.",
        { project_id: project.project_id, branch: head, base: project.default_branch }
      );
    }

    await projectGitService.push(project, head);
  }

  async createPullRequestWithRecovery(project: Project, opts: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<PrRemediationResult> {
    const existingBeforeCreate = await githubApiService.findOpenPullRequestByHead({
      repoUrl: project.repo_url,
      head: opts.head,
      base: opts.base,
    });
    if (existingBeforeCreate) {
      logger.info("GitHub PR already exists for head/base; reusing existing PR", {
        project_id: project.project_id,
        head: opts.head,
        base: opts.base,
        pr_number: existingBeforeCreate.number,
      });
      return {
        pr: existingBeforeCreate,
        preflight_metadata: [],
        remediation_performed: false,
      };
    }

    const firstPreflight = await githubApiService.preflightPullRequest({
      repoUrl: project.repo_url,
      base: opts.base,
      head: opts.head,
    });

    if (!firstPreflight.ok) {
      throw new HttpError(
        422,
        "PR_PREFLIGHT_BLOCKED",
        `PR preflight blocked before create attempt: ${firstPreflight.blocked_reason}.`,
        {
          blocked_reason: firstPreflight.blocked_reason,
          owner: firstPreflight.owner,
          repo: firstPreflight.repo,
          base: opts.base,
          head: opts.head,
          request_metadata: firstPreflight.request_metadata,
        }
      );
    }

    try {
      const pr = await githubApiService.createPullRequest({
        repoUrl: project.repo_url,
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
      });

      return {
        pr,
        preflight_metadata: firstPreflight.request_metadata,
        remediation_performed: false,
      };
    } catch (error) {
      if (error instanceof GithubApiError && this.isDuplicatePrValidationError(error)) {
        const existingAfter422 = await githubApiService.findOpenPullRequestByHead({
          repoUrl: project.repo_url,
          head: opts.head,
          base: opts.base,
        });
        if (existingAfter422) {
          logger.warn("GitHub PR create returned 422 duplicate; using existing PR", {
            project_id: project.project_id,
            head: opts.head,
            base: opts.base,
            pr_number: existingAfter422.number,
            metadata: error.metadata,
          });
          return {
            pr: existingAfter422,
            preflight_metadata: firstPreflight.request_metadata,
            remediation_performed: false,
          };
        }
      }

      if (!(error instanceof GithubApiError) || error.statusCode !== 404) {
        throw error;
      }

      logger.warn("GitHub PR create returned 404; attempting autonomous remediation", {
        project_id: project.project_id,
        head: opts.head,
        base: opts.base,
        metadata: error.metadata,
      });

      await projectGitService.withProjectLock(project.project_id, async () => {
        await projectGitService.ensureReady(project);
        await this.ensureReconcileAndPush(project, opts.head);
      });

      const retryPreflight = await githubApiService.preflightPullRequest({
        repoUrl: project.repo_url,
        base: opts.base,
        head: opts.head,
      });

      if (!retryPreflight.ok) {
        throw new HttpError(
          422,
          "PR_404_RETRY_BLOCKED",
          `PR 404 remediation could not resolve issue: ${retryPreflight.blocked_reason}.`,
          {
            blocked_reason: retryPreflight.blocked_reason,
            owner: retryPreflight.owner,
            repo: retryPreflight.repo,
            base: opts.base,
            head: opts.head,
            request_metadata: retryPreflight.request_metadata,
          }
        );
      }

      try {
        const pr = await githubApiService.createPullRequest({
          repoUrl: project.repo_url,
          title: opts.title,
          body: opts.body,
          head: opts.head,
          base: opts.base,
        });

        return {
          pr,
          preflight_metadata: [
            ...firstPreflight.request_metadata,
            ...retryPreflight.request_metadata,
          ],
          remediation_performed: true,
        };
      } catch (retryError) {
        if (retryError instanceof GithubApiError) {
          throw new HttpError(
            422,
            "PR_404_RETRY_FAILED",
            "PR create retry failed after autonomous remediation.",
            {
              repo: retryError.metadata.repo,
              owner: retryError.metadata.owner,
              base: opts.base,
              head: opts.head,
              status_code: retryError.statusCode,
              request_metadata: retryError.metadata,
            }
          );
        }
        throw retryError;
      }
    }
  }
}

export const prRemediationService = new PrRemediationService();
