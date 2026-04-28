import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { state, stateHistory } from "../db/schema";
import {
  AdminOpsAction,
  AdminOpsGitSummary,
  AdminOpsJob,
  AdminOpsOutcome,
  AdminOpsStatus,
  AdminOpsStep,
  CreateAdminOpsJobRequest,
} from "../domain/admin-ops.types";
import { HttpError } from "../utils/http-error";
import { logger } from "./logger.service";
import { pipelineService } from "./pipeline.service";
import { projectService, Project } from "./project.service";
import { projectGitService } from "./project-git.service";
import { githubApiService } from "./github-api.service";

const OPS_STATE_TYPE = "admin_ops_job";
const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS ?? 120_000);

function toIsoNow(): string {
  return new Date().toISOString();
}

function isBranchDetached(branch: string | undefined): boolean {
  return !branch || branch === "HEAD";
}

function normalizeScope(job: Pick<AdminOpsJob, "project_id" | "pipeline_id">): string {
  if (job.project_id) return `project:${job.project_id}`;
  if (job.pipeline_id) return `pipeline:${job.pipeline_id}`;
  return "global";
}

function isGitHealthy(summary: AdminOpsGitSummary | undefined): boolean {
  if (!summary) return false;
  return Boolean(
    summary.is_repo_accessible &&
      !summary.detached_head &&
      !summary.rebase_in_progress &&
      summary.remote_refspec_broad &&
      summary.remote_ref_present &&
      summary.upstream_tracking &&
      !summary.shallow &&
      summary.merge_base_valid
  );
}

function buildHumanActionChecklist(reason: string | undefined, context?: Record<string, unknown>): string[] {
  switch (reason) {
    case "ACTIVE_REBASE":
      return [
        "Open the project workspace status view and confirm a rebase is in progress.",
        "Decide whether the rebase should be continued or aborted based on the intended branch history.",
        "After resolving the rebase, rerun diagnose or reconcile.",
      ];
    case "DETACHED_HEAD":
      return [
        "Reattach the workspace to the intended branch before retrying automation.",
        "Confirm the feature branch name matches the pipeline or task branch expectation.",
        "Rerun diagnose after the branch is reattached.",
      ];
    case "HEAD_BRANCH_MISSING_ON_ORIGIN":
      return [
        `Confirm the head branch exists remotely: ${String(context?.["branch"] ?? "unknown")}.`,
        "If the branch should exist, inspect push permissions or network reachability and push it manually or via a safe automation path.",
        "Retry PR creation or reconcile after the remote branch is present.",
      ];
    case "MERGE_BASE_INVALID":
      return [
        "Inspect branch ancestry to determine whether the local branch was created from the expected base branch.",
        "If history is corrupted, prefer reset-workspace and recreate the branch from the default branch.",
        "Rerun diagnose before retrying the pipeline.",
      ];
    case "RESET_DID_NOT_RESTORE_HEALTH":
      return [
        "Verify the repository URL, token, and clone path are correct for the target project.",
        "Check remote repository reachability from the runtime environment.",
        "Escalate with before/after diagnostics because reset did not restore a healthy clone.",
      ];
    case "RETRY_GATED_BY_GIT_HEALTH":
      return [
        "Review the latest admin operation diagnostics in pipeline status summary.",
        "Resolve the listed git health issue before retrying the failed pipeline step.",
        "Once healthy, enqueue a new retry operation instead of reusing the blocked one.",
      ];
    case "RECONCILE_INCOMPLETE":
      return [
        "Review before/after git summaries to see which health dimension remained unresolved.",
        "If the clone is still shallow or missing tracking, use reset-workspace next.",
        "Escalate if repo access, merge-base, or remote branch state is still invalid after reset.",
      ];
    case "GITHUB_PREFLIGHT_REPO_NOT_FOUND":
      return [
        "Verify the repository URL configured on the project is correct and the repo has not been renamed, deleted, or transferred.",
        "Confirm the GitHub token (GITHUB_TOKEN or GIT_PAT) has read access to the repository.",
        "Check that the token has not expired and that the organization has not restricted personal access token permissions.",
        "If the repo URL is wrong, update the project configuration and rerun diagnose.",
      ];
    case "GITHUB_PREFLIGHT_GITHUB_TOKEN_MISSING":
      return [
        "Set the GITHUB_TOKEN (or GIT_PAT fallback) environment variable in the runtime environment.",
        "Restart the backend server after adding the token.",
        "Rerun diagnose to confirm GitHub access is restored.",
      ];
    case "GITHUB_PREFLIGHT_API_UNREACHABLE":
      return [
        "Check network connectivity from the runtime host to api.github.com.",
        "Verify firewall and proxy rules are not blocking outbound HTTPS to GitHub.",
        "Retry diagnose after confirming connectivity.",
      ];
    case "GITHUB_PREFLIGHT_BASE_BRANCH_MISSING":
      return [
        "Confirm the project's default branch name is correct.",
        "Check that the base branch exists on origin and has not been deleted or renamed.",
        "Update the project's default_branch setting if it changed and rerun diagnose.",
      ];
    case "GITHUB_PREFLIGHT_HEAD_BRANCH_MISSING":
      return [
        "The current workspace branch does not yet exist on origin.",
        "Push the branch to origin before creating a PR: git push -u origin <branch>.",
        "Rerun reconcile or retry after the remote branch is present.",
      ];
    case "GITHUB_PREFLIGHT_INVALID_REPO_URL":
      return [
        "The repository URL stored on the project is not a valid GitHub URL.",
        "Update the project configuration with a valid HTTPS or SSH GitHub URL and rerun diagnose.",
      ];
    default:
      return reason
        ? [
            `Review blocked reason: ${reason}.`,
            "Inspect the latest diagnostics and attempted repair steps.",
            "Apply the minimal safe manual fix, then rerun diagnose.",
          ]
        : [];
  }
}

function buildEscalationSummary(reason: string | undefined): string | undefined {
  switch (reason) {
    case "ACTIVE_REBASE":
      return "Automation stopped because a rebase is already in progress and requires a human decision.";
    case "DETACHED_HEAD":
      return "Automation stopped because the workspace is on a detached HEAD and branch intent is ambiguous.";
    case "HEAD_BRANCH_MISSING_ON_ORIGIN":
      return "Automation stopped because the expected head branch is not present on origin.";
    case "MERGE_BASE_INVALID":
      return "Automation stopped because branch ancestry is invalid relative to the default branch.";
    case "RESET_DID_NOT_RESTORE_HEALTH":
      return "Automation reset the workspace but the clone is still unhealthy afterward.";
    case "RETRY_GATED_BY_GIT_HEALTH":
      return "Pipeline retry was blocked because git diagnostics did not return to a healthy state.";
    case "RECONCILE_INCOMPLETE":
      return "Reconciliation completed partially but the repository still failed one or more health checks.";
    case "GITHUB_PREFLIGHT_REPO_NOT_FOUND":
      return "Diagnose detected that the repository URL is not reachable on GitHub. The repo may not exist, may have been renamed, or the token may lack access.";
    case "GITHUB_PREFLIGHT_GITHUB_TOKEN_MISSING":
      return "Diagnose detected that no GitHub token is configured. PR creation will fail until a valid token is set.";
    case "GITHUB_PREFLIGHT_API_UNREACHABLE":
      return "Diagnose could not reach the GitHub API. Network or proxy issues may be blocking outbound requests.";
    case "GITHUB_PREFLIGHT_BASE_BRANCH_MISSING":
      return "Diagnose detected that the project's default branch does not exist on GitHub.";
    case "GITHUB_PREFLIGHT_HEAD_BRANCH_MISSING":
      return "Diagnose detected that the current workspace branch is not yet pushed to origin.";
    case "GITHUB_PREFLIGHT_INVALID_REPO_URL":
      return "Diagnose detected that the project has an invalid GitHub repository URL.";
    default:
      return reason ? `Automation is blocked: ${reason}.` : undefined;
  }
}

class AdminOpsService {
  async createJob(req: CreateAdminOpsJobRequest): Promise<AdminOpsJob> {
    this.validateRequest(req);

    const now = toIsoNow();
    const jobId = randomUUID();
    const job: AdminOpsJob = {
      job_id: jobId,
      action: req.action,
      status: "queued",
      actor: req.actor?.trim() || "system",
      project_id: req.project_id,
      pipeline_id: req.pipeline_id,
      queued_at: now,
      options: req.options,
      telemetry: { attempted_steps: [] },
      updated_at: now,
      version: 1,
    };

    await this.persistNew(job);
    await this.syncPipelineOperationLink(job);

    setTimeout(() => {
      this.runJob(job.job_id).catch((error) => {
        logger.error("admin-ops: asynchronous job runner failed", {
          job_id: job.job_id,
          error: String(error),
        });
      });
    }, 0);

    return job;
  }

  /**
   * On server startup, reschedule any jobs that were `queued` or `running`
   * when the process last died. Without this, those jobs are permanently orphaned
   * because the setTimeout that drives them is lost on restart.
   */
  async recoverOrphanedJobs(): Promise<void> {
    const rows = await db
      .select()
      .from(state)
      .where(
        eq(state.type, OPS_STATE_TYPE)
      );

    const orphaned = rows.filter(
      (r) => r.status === "queued" || r.status === "running"
    );

    if (orphaned.length === 0) return;

    logger.info("admin-ops: recovering orphaned jobs on startup", {
      count: orphaned.length,
      job_ids: orphaned.map((r) => r.state_id),
    });

    for (const row of orphaned) {
      // Jobs that were mid-flight (running) need to be reset to queued
      // so runJob's status guard doesn't skip them.
      if (row.status === "running") {
        const job = this.deserializeJob(row.data, "queued", row.version);
        job.started_at = undefined;
        await this.persistUpdate(job);
      }

      setTimeout(() => {
        this.runJob(row.state_id).catch((error) => {
          logger.error("admin-ops: orphan recovery job failed", {
            job_id: row.state_id,
            error: String(error),
          });
        });
      }, 0);
    }
  }

  async getJob(jobId: string): Promise<AdminOpsJob> {
    const [row] = await db
      .select()
      .from(state)
      .where(eq(state.state_id, jobId));

    if (!row || row.type !== OPS_STATE_TYPE) {
      throw new HttpError(404, "OPS_JOB_NOT_FOUND", `Operations job not found: ${jobId}`);
    }

    return this.deserializeJob(row.data, row.status ?? "queued", row.version);
  }

  async getPipelineJob(pipelineId: string, jobId: string): Promise<AdminOpsJob> {
    const job = await this.getJob(jobId);
    if (job.pipeline_id !== pipelineId) {
      throw new HttpError(404, "OPS_JOB_NOT_FOUND", `Operations job ${jobId} is not linked to pipeline ${pipelineId}.`);
    }
    return job;
  }

  private async syncPipelineOperationLink(job: AdminOpsJob): Promise<void> {
    if (!job.pipeline_id) {
      return;
    }

    await pipelineService.linkOperation(job.pipeline_id, {
      operation_id: job.job_id,
      action: job.action,
      status: job.status,
      created_at: job.queued_at,
      details: {
        updated_at: job.updated_at,
        escalation_reason: job.outcome?.escalation_reason,
        checklist_count: job.outcome?.human_action_checklist?.length ?? 0,
      },
    });
  }

  private validateRequest(req: CreateAdminOpsJobRequest): void {
    const allowedActions: AdminOpsAction[] = ["diagnose", "reconcile", "reset-workspace", "retry"];
    if (!allowedActions.includes(req.action)) {
      throw new HttpError(400, "INVALID_OPS_ACTION", `Unsupported operation action: ${req.action}`);
    }

    if ((req.action === "diagnose" || req.action === "reconcile" || req.action === "reset-workspace") && !req.project_id && !req.pipeline_id) {
      throw new HttpError(400, "PROJECT_OR_PIPELINE_REQUIRED", "project_id or pipeline_id is required for this operation.");
    }

    if (req.action === "retry" && !req.pipeline_id) {
      throw new HttpError(400, "PIPELINE_REQUIRED", "pipeline_id is required for retry operation.");
    }
  }

  private deserializeJob(data: unknown, status: string, version: number): AdminOpsJob {
    const parsed = (data ?? {}) as Partial<AdminOpsJob>;
    return {
      job_id: parsed.job_id ?? "",
      action: (parsed.action ?? "diagnose") as AdminOpsAction,
      status: (status as AdminOpsStatus) ?? "queued",
      actor: parsed.actor ?? "system",
      project_id: parsed.project_id,
      pipeline_id: parsed.pipeline_id,
      queued_at: parsed.queued_at ?? toIsoNow(),
      started_at: parsed.started_at,
      completed_at: parsed.completed_at,
      error: parsed.error,
      outcome: parsed.outcome,
      options: parsed.options,
      telemetry: parsed.telemetry ?? { attempted_steps: [] },
      updated_at: parsed.updated_at ?? toIsoNow(),
      version,
    };
  }

  private async persistNew(job: AdminOpsJob): Promise<void> {
    const now = new Date();
    await db.insert(state).values({
      state_id: job.job_id,
      type: OPS_STATE_TYPE,
      scope: normalizeScope(job),
      version: job.version,
      data: job as unknown as Record<string, unknown>,
      metadata: {
        action: job.action,
        pipeline_id: job.pipeline_id,
        project_id: job.project_id,
      },
      status: job.status,
      created_at: now,
      updated_at: now,
    });
  }

  private async persistUpdate(job: AdminOpsJob): Promise<void> {
    const now = new Date();
    const nextVersion = job.version + 1;

    await db
      .update(state)
      .set({
        version: nextVersion,
        data: job as unknown as Record<string, unknown>,
        status: job.status,
        metadata: {
          action: job.action,
          pipeline_id: job.pipeline_id,
          project_id: job.project_id,
          updated_at: job.updated_at,
        },
        updated_at: now,
      })
      .where(eq(state.state_id, job.job_id));

    await db.insert(stateHistory).values({
      id: randomUUID(),
      state_id: job.job_id,
      version: nextVersion,
      data: job as unknown as Record<string, unknown>,
      metadata: {
        action: job.action,
        status: job.status,
      },
      created_at: now,
    });

    job.version = nextVersion;
  }

  private startStep(job: AdminOpsJob, name: string, details?: Record<string, unknown>): AdminOpsStep {
    const step: AdminOpsStep = {
      name,
      status: "running",
      started_at: toIsoNow(),
      details,
    };

    job.telemetry.attempted_steps.push(step);
    return step;
  }

  private completeStep(step: AdminOpsStep, status: AdminOpsStep["status"], details?: Record<string, unknown>): void {
    step.status = status;
    step.completed_at = toIsoNow();
    step.details = {
      ...(step.details ?? {}),
      ...(details ?? {}),
    };
  }

  private async runJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);

    if (job.status !== "queued") {
      return;
    }

    job.status = "running";
    job.started_at = toIsoNow();
    job.updated_at = toIsoNow();
    await this.persistUpdate(job);

    try {
      let outcome: AdminOpsOutcome;
      switch (job.action) {
        case "diagnose":
          outcome = await this.runDiagnoseAction(job);
          break;
        case "reconcile":
          outcome = await this.runReconcileAction(job);
          break;
        case "reset-workspace":
          outcome = await this.runResetWorkspaceAction(job);
          break;
        case "retry":
          outcome = await this.runRetryAction(job);
          break;
        default:
          throw new HttpError(400, "INVALID_OPS_ACTION", `Unsupported operation action: ${job.action}`);
      }

      job.outcome = outcome;
      if (outcome.escalation_reason) {
        outcome.escalation_summary = buildEscalationSummary(outcome.escalation_reason);
        outcome.human_action_checklist = buildHumanActionChecklist(outcome.escalation_reason, {
          branch: outcome.before_git?.current_branch ?? outcome.after_git?.current_branch,
        });
      }
      job.status = outcome.escalation_reason ? "blocked" : "succeeded";
      job.completed_at = toIsoNow();
      job.updated_at = toIsoNow();
      await this.persistUpdate(job);
      await this.syncPipelineOperationLink(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.status = "failed";
      job.completed_at = toIsoNow();
      job.updated_at = toIsoNow();
      job.error = {
        code: error instanceof HttpError ? error.code : "OPS_EXECUTION_FAILED",
        message,
        details: error instanceof HttpError ? error.details : undefined,
      };
      await this.persistUpdate(job);
      await this.syncPipelineOperationLink(job);
    }
  }

  private async resolveProjectForJob(job: AdminOpsJob): Promise<Project> {
    if (job.project_id) {
      const project = await projectService.getById(job.project_id);
      if (project) return project;
      throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${job.project_id}`);
    }

    if (job.pipeline_id) {
      const run = await pipelineService.get(job.pipeline_id);
      if (!run.project_id) {
        throw new HttpError(409, "PIPELINE_PROJECT_REQUIRED", `Pipeline ${job.pipeline_id} has no linked project.`);
      }
      const project = await projectService.getById(run.project_id);
      if (project) return project;
      throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${run.project_id}`);
    }

    throw new HttpError(400, "PROJECT_REQUIRED", "Unable to resolve project for admin operation.");
  }

  private resolveRepoPath(clonePath: string): string {
    return path.isAbsolute(clonePath) ? clonePath : path.join(process.cwd(), clonePath);
  }

  private runGit(repoPath: string, args: string[]): string {
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
      return { ok: true, value: this.runGit(repoPath, args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async collectGitDiagnostics(project: Project): Promise<AdminOpsGitSummary> {
    const repoPath = this.resolveRepoPath(project.clone_path);
    const accessible = this.tryGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    const branchResult = this.tryGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchResult.ok ? branchResult.value : undefined;

    const tracking = this.tryGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    const refspec = this.tryGit(repoPath, ["config", "--get-all", "remote.origin.fetch"]);
    const shallow = this.tryGit(repoPath, ["rev-parse", "--is-shallow-repository"]);

    const remoteRef = branch && !isBranchDetached(branch)
      ? this.tryGit(repoPath, ["show-ref", "--verify", `refs/remotes/origin/${branch}`])
      : { ok: false, error: "detached_or_missing_branch" };

    const mergeBase = branch && !isBranchDetached(branch)
      ? this.tryGit(repoPath, ["merge-base", "HEAD", `origin/${project.default_branch}`])
      : { ok: false, error: "detached_or_missing_branch" };

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

    const refspecs = refspec.ok && refspec.value
      ? refspec.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [];

    const broadRefspec = refspecs.includes("+refs/heads/*:refs/remotes/origin/*");

    return {
      repo_path: repoPath,
      is_repo_accessible: accessible.ok,
      current_branch: branch,
      detached_head: isBranchDetached(branch),
      upstream_tracking: tracking.ok ? tracking.value : undefined,
      remote_ref_present: remoteRef.ok,
      remote_refspec_broad: broadRefspec,
      remote_refspecs: refspecs,
      shallow: shallow.ok ? shallow.value === "true" : undefined,
      merge_base_valid: mergeBase.ok,
      rebase_in_progress: rebaseInProgress,
    };
  }

  private async runDiagnoseAction(job: AdminOpsJob): Promise<AdminOpsOutcome> {
    const project = await this.resolveProjectForJob(job);

    // Step 1: local git health
    const gitStep = this.startStep(job, "diagnose-git", { project_id: project.project_id });
    await this.persistUpdate(job);

    // ensureReady manages its own per-project lock internally.
    // Do NOT wrap in withProjectLock here — calling ensureReady (which acquires
    // the lock) inside withProjectLock (which also acquires the same lock) causes
    // a self-deadlock since the mutex is not reentrant.
    await projectGitService.ensureReady(project);
    const before = await this.collectGitDiagnostics(project);

    this.completeStep(gitStep, "succeeded", { healthy: isGitHealthy(before) });

    // Step 2: GitHub repo preflight
    const ghStep = this.startStep(job, "diagnose-github-preflight", {
      repo_url: project.repo_url,
    });
    await this.persistUpdate(job);

    const headBranch = before.current_branch && !before.detached_head
      ? before.current_branch
      : project.default_branch;

    const preflight = await githubApiService.preflightPullRequest({
      repoUrl: project.repo_url,
      base: project.default_branch,
      head: headBranch,
    });

    this.completeStep(ghStep, preflight.ok ? "succeeded" : "failed", {
      ok: preflight.ok,
      blocked_reason: preflight.blocked_reason,
      repo_reachable: preflight.repo_reachable,
      base_branch_exists: preflight.base_branch_exists,
      head_branch_exists: preflight.head_branch_exists,
    });

    job.updated_at = toIsoNow();
    await this.persistUpdate(job);

    const outcome: AdminOpsOutcome = {
      attempted_steps: job.telemetry.attempted_steps,
      before_git: before,
      after_git: before,
      github_requests: preflight.request_metadata,
      details: {
        github_api: githubApiService.getApiDiagnostics(),
        github_preflight: {
          ok: preflight.ok,
          blocked_reason: preflight.blocked_reason ?? null,
          repo_reachable: preflight.repo_reachable,
          base_branch_exists: preflight.base_branch_exists,
          head_branch_exists: preflight.head_branch_exists,
          base: project.default_branch,
          head: headBranch,
          owner: preflight.owner,
          repo: preflight.repo,
        },
        stop_condition: "human_escalation_if_rebase_or_detached_or_mergebase_invalid_or_github_unreachable",
      },
      correlation: {
        pipeline_id: job.pipeline_id,
        operation_id: job.job_id,
      },
    };

    if (!preflight.ok && preflight.blocked_reason) {
      outcome.escalation_reason = `GITHUB_PREFLIGHT_${preflight.blocked_reason}`;
    }

    return outcome;
  }

  private async runReconcileAction(job: AdminOpsJob): Promise<AdminOpsOutcome> {
    const project = await this.resolveProjectForJob(job);
    const outcome: AdminOpsOutcome = {
      attempted_steps: job.telemetry.attempted_steps,
      correlation: {
        pipeline_id: job.pipeline_id,
        operation_id: job.job_id,
      },
    };

    await projectGitService.withProjectLock(project.project_id, async () => {
      await this.doReconcileUnderLock(job, project, outcome);
    });

    if (!outcome.after_git) {
      outcome.after_git = outcome.before_git;
    }

    // After local reconciliation, verify the GitHub repo is still reachable.
    // If GitHub is down, local reconciliation can't help — escalate immediately.
    const ghStep = this.startStep(job, "reconcile-github-preflight", {
      repo_url: project.repo_url,
    });
    await this.persistUpdate(job);

    const headBranch = outcome.after_git?.current_branch && !outcome.after_git?.detached_head
      ? outcome.after_git.current_branch
      : project.default_branch;

    const preflight = await githubApiService.preflightPullRequest({
      repoUrl: project.repo_url,
      base: project.default_branch,
      head: headBranch,
    });

    this.completeStep(ghStep, preflight.ok ? "succeeded" : "failed", {
      repo_url: project.repo_url,
      ok: preflight.ok,
      blocked_reason: preflight.blocked_reason,
      repo_reachable: preflight.repo_reachable,
      base_branch_exists: preflight.base_branch_exists,
      head_branch_exists: preflight.head_branch_exists,
    });

    if (!preflight.ok && preflight.blocked_reason) {
      outcome.escalation_reason = `GITHUB_PREFLIGHT_${preflight.blocked_reason}`;
      outcome.details = {
        github_api: githubApiService.getApiDiagnostics(),
        github_preflight: {
          ok: preflight.ok,
          blocked_reason: preflight.blocked_reason ?? null,
          repo_reachable: preflight.repo_reachable,
          base_branch_exists: preflight.base_branch_exists,
          head_branch_exists: preflight.head_branch_exists,
          base: project.default_branch,
          head: headBranch,
          owner: preflight.owner,
          repo: preflight.repo,
        },
        stop_condition: "github_unreachable_blocks_merge_after_reconcile",
      };
    }

    job.updated_at = toIsoNow();
    await this.persistUpdate(job);

    return outcome;
  }

  private async doReconcileUnderLock(
    job: AdminOpsJob,
    project: Project,
    outcome: AdminOpsOutcome
  ): Promise<void> {
    await projectGitService.ensureReadyUnderLock(project);
    outcome.before_git = await this.collectGitDiagnostics(project);

    if (outcome.before_git.rebase_in_progress) {
      const step = this.startStep(job, "stop-active-rebase");
      this.completeStep(step, "blocked", { escalation_reason: "ACTIVE_REBASE" });
      outcome.escalation_reason = "ACTIVE_REBASE";
      return;
    }

    if (outcome.before_git.detached_head) {
      const step = this.startStep(job, "stop-detached-head");
      this.completeStep(step, "blocked", { escalation_reason: "DETACHED_HEAD" });
      outcome.escalation_reason = "DETACHED_HEAD";
      return;
    }

    const repoPath = this.resolveRepoPath(project.clone_path);

    const widen = this.startStep(job, "widen-refspec");
    this.runGit(repoPath, ["config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
    this.completeStep(widen, "succeeded");

    const fetchPrune = this.startStep(job, "fetch-prune");
    this.runGit(repoPath, ["fetch", "--prune", "origin"]);
    this.completeStep(fetchPrune, "succeeded");

    const unshallow = this.startStep(job, "unshallow-if-needed");
    const shallow = this.tryGit(repoPath, ["rev-parse", "--is-shallow-repository"]);
    if (shallow.ok && shallow.value === "true") {
      const unshallowResult = this.tryGit(repoPath, ["fetch", "--unshallow", "origin"]);
      if (!unshallowResult.ok) {
        this.runGit(repoPath, ["fetch", "--depth", "2147483647", "origin"]);
      }
    }
    this.completeStep(unshallow, "succeeded", { initial_shallow: shallow.value });

    const tracking = this.startStep(job, "ensure-branch-tracking");
    const branch = this.runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const upstream = this.tryGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);

    if (!isBranchDetached(branch) && !upstream.ok) {
      const remote = this.tryGit(repoPath, ["show-ref", "--verify", `refs/remotes/origin/${branch}`]);
      if (!remote.ok) {
        this.completeStep(tracking, "blocked", {
          escalation_reason: "HEAD_BRANCH_MISSING_ON_ORIGIN",
          branch,
        });
        outcome.escalation_reason = "HEAD_BRANCH_MISSING_ON_ORIGIN";
        return;
      }
      this.runGit(repoPath, ["branch", "--set-upstream-to", `origin/${branch}`, branch]);
    }
    this.completeStep(tracking, "succeeded", { branch });

    const mergeBase = this.startStep(job, "recompute-merge-base");
    const mergeResult = this.tryGit(repoPath, ["merge-base", "HEAD", `origin/${project.default_branch}`]);
    if (!mergeResult.ok) {
      this.completeStep(mergeBase, "blocked", { escalation_reason: "MERGE_BASE_INVALID" });
      outcome.escalation_reason = "MERGE_BASE_INVALID";
      return;
    }
    this.completeStep(mergeBase, "succeeded");

    outcome.after_git = await this.collectGitDiagnostics(project);
    if (!isGitHealthy(outcome.after_git)) {
      outcome.escalation_reason = "RECONCILE_INCOMPLETE";
    }
  }

  private async runResetWorkspaceAction(job: AdminOpsJob): Promise<AdminOpsOutcome> {
    const project = await this.resolveProjectForJob(job);
    const outcome: AdminOpsOutcome = {
      attempted_steps: job.telemetry.attempted_steps,
      correlation: {
        pipeline_id: job.pipeline_id,
        operation_id: job.job_id,
      },
    };

    await projectGitService.withProjectLock(project.project_id, async () => {
      await this.doResetUnderLock(job, project, outcome);
    });

    if (!isGitHealthy(outcome.after_git)) {
      outcome.escalation_reason = "RESET_DID_NOT_RESTORE_HEALTH";
    }

    // After local reset, verify the GitHub repo is still reachable.
    // If GitHub is down, local reset can't help — escalate immediately.
    const ghStep = this.startStep(job, "reset-github-preflight", {
      repo_url: project.repo_url,
    });
    await this.persistUpdate(job);

    const headBranch = outcome.after_git?.current_branch && !outcome.after_git?.detached_head
      ? outcome.after_git.current_branch
      : project.default_branch;

    const preflight = await githubApiService.preflightPullRequest({
      repoUrl: project.repo_url,
      base: project.default_branch,
      head: headBranch,
    });

    this.completeStep(ghStep, preflight.ok ? "succeeded" : "failed", {
      repo_url: project.repo_url,
      ok: preflight.ok,
      blocked_reason: preflight.blocked_reason,
      repo_reachable: preflight.repo_reachable,
      base_branch_exists: preflight.base_branch_exists,
      head_branch_exists: preflight.head_branch_exists,
    });

    if (!preflight.ok && preflight.blocked_reason) {
      outcome.escalation_reason = `GITHUB_PREFLIGHT_${preflight.blocked_reason}`;
      outcome.details = {
        github_api: githubApiService.getApiDiagnostics(),
        github_preflight: {
          ok: preflight.ok,
          blocked_reason: preflight.blocked_reason ?? null,
          repo_reachable: preflight.repo_reachable,
          base_branch_exists: preflight.base_branch_exists,
          head_branch_exists: preflight.head_branch_exists,
          base: project.default_branch,
          head: headBranch,
          owner: preflight.owner,
          repo: preflight.repo,
        },
        stop_condition: "github_unreachable_blocks_merge_after_reset",
      };
    }

    job.updated_at = toIsoNow();
    await this.persistUpdate(job);

    return outcome;
  }

  private async doResetUnderLock(
    job: AdminOpsJob,
    project: Project,
    outcome: AdminOpsOutcome
  ): Promise<void> {
    const beforeStep = this.startStep(job, "collect-before-diagnostics");
    outcome.before_git = await this.collectGitDiagnostics(project);
    this.completeStep(beforeStep, "succeeded");

    const resetStep = this.startStep(job, "reset-local-workspace");
    const repoPath = this.resolveRepoPath(project.clone_path);
    await fs.rm(repoPath, { recursive: true, force: true });
    this.completeStep(resetStep, "succeeded", { repo_path: repoPath });

    const rehydrateStep = this.startStep(job, "rehydrate-clone");
    await projectGitService.ensureReadyUnderLock(project, { forcePull: true });
    this.completeStep(rehydrateStep, "succeeded");

    const postStep = this.startStep(job, "post-reset-diagnostics");
    outcome.after_git = await this.collectGitDiagnostics(project);
    this.completeStep(postStep, "succeeded", { healthy: isGitHealthy(outcome.after_git) });
  }

  private async runRetryAction(job: AdminOpsJob): Promise<AdminOpsOutcome> {
    if (!job.pipeline_id) {
      throw new HttpError(400, "PIPELINE_REQUIRED", "pipeline_id is required for retry operation.");
    }

    const project = await this.resolveProjectForJob(job);
    const outcome: AdminOpsOutcome = {
      attempted_steps: job.telemetry.attempted_steps,
      correlation: {
        pipeline_id: job.pipeline_id,
        operation_id: job.job_id,
      },
    };

    let healthy = false;
    await projectGitService.withProjectLock(project.project_id, async () => {
      const diagnoseStep = this.startStep(job, "retry-preflight-diagnose");
      outcome.before_git = await this.collectGitDiagnostics(project);
      healthy = isGitHealthy(outcome.before_git);
      this.completeStep(diagnoseStep, "succeeded", { healthy });

      if (!healthy) {
        const reconcileStep = this.startStep(job, "retry-preflight-reconcile");
        const reconcileOutcome: AdminOpsOutcome = {
          attempted_steps: [],
          correlation: outcome.correlation,
        };
        await this.doReconcileUnderLock(
          { ...job, telemetry: { attempted_steps: [] } },
          project,
          reconcileOutcome
        );
        if (!reconcileOutcome.after_git) reconcileOutcome.after_git = reconcileOutcome.before_git;
        this.completeStep(reconcileStep, reconcileOutcome.escalation_reason ? "blocked" : "succeeded", {
          escalation_reason: reconcileOutcome.escalation_reason,
        });

        outcome.after_git = reconcileOutcome.after_git;
        healthy = isGitHealthy(outcome.after_git);
      }

      if (!healthy) {
        const resetStep = this.startStep(job, "retry-preflight-reset");
        const resetOutcome: AdminOpsOutcome = {
          attempted_steps: [],
          correlation: outcome.correlation,
        };
        await this.doResetUnderLock(
          { ...job, telemetry: { attempted_steps: [] } },
          project,
          resetOutcome
        );
        this.completeStep(resetStep, resetOutcome.escalation_reason ? "blocked" : "succeeded", {
          escalation_reason: resetOutcome.escalation_reason,
        });
        outcome.after_git = resetOutcome.after_git;
        healthy = isGitHealthy(outcome.after_git);
      }
    });

    if (!healthy) {
      outcome.escalation_reason = "RETRY_GATED_BY_GIT_HEALTH";
      return outcome;
    }

    const retryStep = this.startStep(job, "retry-pipeline-step", { pipeline_id: job.pipeline_id });
    const run = await pipelineService.retry(job.pipeline_id, job.actor);
    await pipelineService.linkOperation(job.pipeline_id, {
      operation_id: job.job_id,
      action: "retry",
      status: "succeeded",
      created_at: toIsoNow(),
      details: {
        current_step: run.current_step,
        pipeline_status: run.status,
      },
    });
    this.completeStep(retryStep, "succeeded", { current_step: run.current_step, status: run.status });

    return outcome;
  }
}

export const adminOpsService = new AdminOpsService();
