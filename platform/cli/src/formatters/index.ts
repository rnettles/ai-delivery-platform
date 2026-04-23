import type {
  PipelineRun,
  PipelineStatusSummary,
  PipelineStatusChoice,
  CurrentPipelineStatusResult,
  ChannelPipelineStatusListResult,
  StagedPhasesResult,
  StagedSprintsResult,
  StagedTasksResult,
  HealthResponse,
  GitSyncResponse,
  GitStatusResponse,
} from "../types";
import type {
  ExecutionResponseEnvelope,
  ExecutionRecord,
  ExecutionListResponse,
  ScriptsDiscoveryResponse,
  CoordinationEntry,
  CoordinationListResponse,
} from "../types";
import type { ProjectWithChannels } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(date?: string): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}

function duration(ms?: number): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export function formatHealth(r: HealthResponse): string {
  const ver = r.version ? ` v${r.version}` : "";
  const up = r.uptime_seconds !== undefined ? ` | uptime: ${duration(r.uptime_seconds * 1000)}` : "";
  return `status: ${r.status}${ver} | timestamp: ${fmt(r.timestamp)}${up}`;
}

// ─── Scripts ──────────────────────────────────────────────────────────────────

export function formatScripts(r: ScriptsDiscoveryResponse): string {
  const scripts = r.scripts.map((s) => `  script  ${s.name}@${s.version}  — ${s.description}`);
  const roles = r.roles.map((ro) => `  role    ${ro.name}@${ro.version}  → ${ro.script.name}`);
  return [...scripts, ...roles].join("\n") || "(none)";
}

// ─── Execution ────────────────────────────────────────────────────────────────

export function formatExecution(r: ExecutionResponseEnvelope): string {
  const status = r.ok ? "ok" : "failed";
  const errs = r.errors?.length
    ? ` | errors: ${r.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`
    : "";
  const artifacts = r.artifacts?.length ? ` | artifacts: ${r.artifacts.length}` : "";
  return (
    `execution_id: ${r.execution_id} | status: ${status}` +
    ` | target: ${r.target.name}@${r.target.version}${artifacts}${errs}`
  );
}

export function formatExecutionRecord(r: ExecutionRecord): string {
  const errs = r.errors?.length
    ? ` | errors: ${r.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`
    : "";
  return (
    `execution_id: ${r.execution_id} | status: ${r.status}` +
    ` | target: ${r.target.name}@${r.target.version}` +
    ` | duration: ${duration(r.duration_ms)}` +
    ` | completed: ${fmt(r.completed_at)}${errs}`
  );
}

export function formatExecutionList(r: ExecutionListResponse): string {
  if (!r.records?.length) return "No executions found.";
  const lines = r.records.map(
    (rec) =>
      `  ${rec.execution_id}  ${rec.status.padEnd(10)}  ${rec.target.name}@${rec.target.version}  ${fmt(rec.completed_at)}`
  );
  return `${r.records.length} execution(s) (of ${r.total} total):\n${lines.join("\n")}`;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export function formatPipeline(r: PipelineRun): string {
  const pr = r.pr_url ? ` | PR: ${r.pr_url}` : r.pr_number ? ` | PR: #${r.pr_number}` : "";
  const branch = r.sprint_branch ? ` | branch: ${r.sprint_branch}` : "";
  const project = r.project_id ? ` | project: ${r.project_id}` : "";
  return (
    `pipeline_id: ${r.pipeline_id} | status: ${r.status}` +
    ` | step: ${r.current_step} | entry: ${r.entry_point}${project}${branch}${pr}` +
    ` | updated: ${fmt(r.updated_at)}`
  );
}

export function formatPipelineSummary(r: PipelineStatusSummary): string {
  let base = formatPipeline(r);

  if (r.last_error) {
    base += ` | last_error: ${r.last_error.code}: ${r.last_error.message}`;
  }
  if (r.execution_signals?.length) {
    const signals = r.execution_signals
      .map((s) => `${s.level}(${s.code})`)
      .join(", ");
    base += ` | signals: ${signals}`;
  }
  if (r.control_state?.current_task) {
    const task = r.control_state.current_task as Record<string, unknown>;
    const taskId = task.task_id ?? task.id ?? "";
    if (taskId) base += ` | current_task: ${taskId}`;
  }

  return base;
}

export function formatPipelineList(r: ChannelPipelineStatusListResult): string {
  if (!r.runs?.length) return `No pipelines found for channel ${r.channel_id}.`;
  const lines = r.runs.map((run) => {
    const project = run.project_id ? `  project=${run.project_id}` : "";
    return `  ${run.pipeline_id}  ${run.status.padEnd(20)}  step=${run.current_step.padEnd(16)}  ${fmt(run.updated_at)}${project}`;
  });
  return `${r.runs.length} pipeline(s) for channel ${r.channel_id}:\n${lines.join("\n")}`;
}

export function formatPipelineCurrent(r: CurrentPipelineStatusResult): string {
  if (r.kind === "none") return r.message;
  if (r.kind === "single") return formatPipelineSummary(r.run);
  // multiple
  const lines = r.runs.map(
    (run: PipelineStatusChoice) => {
      const project = run.project_id ? `  project=${run.project_id}` : "";
      return `  ${run.pipeline_id}  ${run.status.padEnd(20)}  step=${run.current_step}${project}`;
    }
  );
  return `Multiple active pipelines:\n${lines.join("\n")}`;
}

// ─── Staged artifacts ─────────────────────────────────────────────────────────

export function formatStagedPhases(r: StagedPhasesResult): string {
  if (!r.phases?.length) return "No staged phases found.";
  const lines = r.phases.map(
    (p) => `  ${p.phase_id.padEnd(20)}  ${(p.status ?? "staged").padEnd(10)}  ${p.name ?? ""}`
  );
  return `${r.phases.length} staged phase(s):\n${lines.join("\n")}`;
}

export function formatStagedSprints(r: StagedSprintsResult): string {
  if (!r.sprints?.length) return "No staged sprints found.";
  const lines = r.sprints.map(
    (s) =>
      `  ${s.sprint_id.padEnd(24)}  phase=${(s.phase_id ?? "—").padEnd(20)}  ${(s.status ?? "staged").padEnd(10)}  ${s.name ?? ""}`
  );
  return `${r.sprints.length} staged sprint(s):\n${lines.join("\n")}`;
}

export function formatStagedTasks(r: StagedTasksResult): string {
  if (!r.tasks?.length) return "No staged tasks found.";
  const lines = r.tasks.map(
    (t) =>
      `  ${t.task_id.padEnd(16)}  sprint=${(t.sprint_id ?? "—").padEnd(24)}  ${(t.status ?? "staged").padEnd(10)}  ${t.label ?? ""}`
  );
  return `${r.tasks.length} staged task(s):\n${lines.join("\n")}`;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export function formatProject(p: ProjectWithChannels): string {
  const channels = p.channel_ids?.length
    ? ` | channels: ${p.channel_ids.join(", ")}`
    : "";
  return (
    `project_id: ${p.project_id} | name: ${p.name}` +
    ` | repo: ${p.repo_url} | branch: ${p.default_branch}${channels}` +
    ` | created: ${fmt(p.created_at)}`
  );
}

export function formatProjectList(projects: ProjectWithChannels[]): string {
  if (!projects?.length) return "No projects found.";
  const lines = projects.map(
    (p) =>
      `  ${p.project_id.padEnd(20)}  ${p.name.padEnd(24)}  ${p.repo_url}` +
      (p.channel_ids?.length ? `  [${p.channel_ids.join(", ")}]` : "")
  );
  return `${projects.length} project(s):\n${lines.join("\n")}`;
}

// ─── Coordination ─────────────────────────────────────────────────────────────

export function formatCoordination(c: CoordinationEntry): string {
  const exp = c.expires_at ? ` | expires: ${fmt(c.expires_at)}` : "";
  return (
    `coordination_id: ${c.coordination_id} | kind: ${c.kind}` +
    ` | scope: ${c.scope} | status: ${c.status}${exp}` +
    ` | updated: ${fmt(c.updated_at)}`
  );
}

export function formatCoordinationList(r: CoordinationListResponse): string {
  if (!r.entries?.length) return "No coordination entries found.";
  const lines = r.entries.map(
    (c) =>
      `  ${c.coordination_id.padEnd(36)}  ${c.kind.padEnd(10)}  ${c.status.padEnd(8)}  ${c.scope}`
  );
  return `${r.entries.length} coordination entry/entries:\n${lines.join("\n")}`;
}

// ─── Git ──────────────────────────────────────────────────────────────────────

export function formatGitSync(r: GitSyncResponse): string {
  if (!r.repos?.length) return r.ok ? "Git sync complete." : "Git sync failed.";
  const lines = r.repos.map(
    (repo) =>
      `  ${repo.project_id.padEnd(20)}  ${repo.is_accessible ? "ok" : "UNREACHABLE"}  ` +
      `${(repo.head_commit ?? "").slice(0, 8)}  synced: ${fmt(repo.synced_at)}`
  );
  return `Git sync ${r.ok ? "complete" : "failed"} — ${r.repos.length} repo(s):\n${lines.join("\n")}`;
}

export function formatGitStatus(r: GitStatusResponse): string {
  if (!r.repos?.length) return "No repos tracked.";
  const lines = r.repos.map(
    (repo) =>
      `  ${repo.project_id.padEnd(20)}  ${repo.is_accessible ? "ok" : "UNREACHABLE"}  ` +
      `${(repo.head_commit ?? "").slice(0, 8)}  ${repo.repo_url}`
  );
  return `${r.repos.length} repo(s):\n${lines.join("\n")}`;
}
