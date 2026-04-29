import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted DB mock ────────────────────────────────────────────────────────
// vi.hoisted ensures these are available inside vi.mock() factories
const mocks = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const insertReturning = vi.fn();
  const updateReturning = vi.fn();
  const artifactCleanup = vi.fn().mockResolvedValue(undefined);
  const getProjectByChannel = vi.fn();
  const getProjectById = vi.fn();
  const getProjectByName = vi.fn();

  return {
    selectWhere,
    insertReturning,
    updateReturning,
    artifactCleanup,
    getProjectByChannel,
    getProjectById,
    getProjectByName,
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturning })) })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => ({ returning: updateReturning })) })),
      })),
    },
  };
});

vi.mock("../db/client", () => ({ db: mocks.db }));
vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../services/artifact.service", () => ({
  artifactService: { cleanup: mocks.artifactCleanup },
}));
vi.mock("../services/project.service", () => ({
  projectService: {
    getByChannel: mocks.getProjectByChannel,
    getById: mocks.getProjectById,
    getByName: mocks.getProjectByName,
  },
}));

import { PipelineService } from "../services/pipeline.service";
import { HttpError } from "../utils/http-error";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pipeline_id: "pipe-2026-04-19-test1234",
    entry_point: "planner",
    current_step: "planner",
    status: "running",
    steps: [
      {
        role: "planner",
        status: "running",
        gate_outcome: null,
        artifact_paths: [],
        actor: "system",
        started_at: "2026-04-19T00:00:00.000Z",
      },
    ],
    metadata: { source: "slack" },
    input: { description: "Build a widget" },
    created_at: new Date("2026-04-19T00:00:00.000Z"),
    updated_at: new Date("2026-04-19T00:00:00.000Z"),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PipelineService", () => {
  let service: PipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectByChannel.mockResolvedValue({ project_id: "proj-1" });
    mocks.getProjectById.mockResolvedValue(null);
    mocks.getProjectByName.mockResolvedValue(null);
    service = new PipelineService();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("inserts a new pipeline run and returns it", async () => {
      const row = makeRow();
      mocks.insertReturning.mockResolvedValueOnce([row]);

      const run = await service.create({
        entry_point: "planner",
        input: { description: "Build a widget" },
        metadata: { source: "slack", slack_channel: "C123ABC" },
      });

      expect(run.pipeline_id).toBe("pipe-2026-04-19-test1234");
      expect(run.entry_point).toBe("planner");
      expect(run.current_step).toBe("planner");
      expect(run.status).toBe("running");
      expect(mocks.db.insert).toHaveBeenCalledOnce();
    });

    it("throws 400 when metadata.slack_channel is missing", async () => {
      await expect(
        service.create({
          entry_point: "planner",
          input: { description: "Build a widget" },
          metadata: { source: "api" },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "SLACK_CHANNEL_REQUIRED",
      });

      expect(mocks.db.insert).not.toHaveBeenCalled();
    });

    it("throws 400 when metadata.slack_channel is not mapped", async () => {
      mocks.getProjectByChannel.mockResolvedValueOnce(null);

      await expect(
        service.create({
          entry_point: "planner",
          input: { description: "Build a widget" },
          metadata: { source: "api", slack_channel: "C-UNKNOWN" },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_SLACK_CHANNEL",
      });

      expect(mocks.db.insert).not.toHaveBeenCalled();
    });

    it("marks earlier roles as not_applicable when entry_point is implementer", async () => {
      const row = makeRow({
        entry_point: "implementer",
        current_step: "implementer",
        steps: [
          { role: "planner", status: "not_applicable" },
          { role: "sprint-controller", status: "not_applicable" },
          { role: "implementer", status: "running" },
        ],
      });
      mocks.insertReturning.mockResolvedValueOnce([row]);

      const run = await service.create({
        entry_point: "implementer",
        input: {},
        metadata: { source: "api", slack_channel: "C123ABC" },
      });
      expect(run.steps[0].status).toBe("not_applicable");
      expect(run.steps[1].status).toBe("not_applicable");
      expect(run.steps[2].status).toBe("running");
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("returns the pipeline run when found", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow()]);

      const run = await service.get("pipe-2026-04-19-test1234");
      expect(run.pipeline_id).toBe("pipe-2026-04-19-test1234");
    });
    it("throws 404 HttpError when not found", async () => {
      mocks.selectWhere.mockResolvedValue([]);

      await expect(service.get("nonexistent")).rejects.toThrow(HttpError);
      await expect(service.get("nonexistent")).rejects.toMatchObject({
        statusCode: 404,
        code: "PIPELINE_NOT_FOUND",
      });
    });
  });

  // ── completeStep ───────────────────────────────────────────────────────────

  describe("completeStep()", () => {
    it("sets status to awaiting_approval for gated roles (planner)", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow()]);
      const savedRow = makeRow({ status: "awaiting_approval" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-001",
        ["artifacts/plan.md"],
        false
      );

      expect(run.status).toBe("awaiting_approval");
    });

    it("marks status as failed when failed=true", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow()]);
      const savedRow = makeRow({ status: "failed" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-001",
        [],
        true
      );

      expect(run.status).toBe("failed");
    });

    it("auto-advances to sprint-controller when verifier passes", async () => {
      const verifierRow = makeRow({
        current_step: "verifier",
        status: "running",
        steps: [
          { role: "planner", status: "complete", gate_outcome: "approved", artifact_paths: [], actor: "user-1", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "approved", artifact_paths: [], actor: "user-1", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "approved", artifact_paths: [], actor: "user-1", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-002",
        ["artifacts/report.md"],
        false,
        true // verificationPassed
      );

      expect(run.status).toBe("running");
      expect(run.current_step).toBe("sprint-controller");
    });

    it("routes to implementer when verifier fails (verificationPassed=false)", async () => {
      const verifierRow = makeRow({
        current_step: "verifier",
        status: "running",
        steps: [
          { role: "planner", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "implementer", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-002",
        ["artifacts/verification_result.json"],
        false,
        false // verificationPassed
      );

      expect(run.current_step).toBe("implementer");
      expect(run.status).toBe("running");
    });

    it("cancels pipeline when implementer retry limit is reached", async () => {
      const verifierRow = makeRow({
        current_step: "verifier",
        status: "running",
        implementer_attempts: 3, // already at MAX_IMPLEMENTER_ATTEMPTS
        steps: [
          { role: "planner", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "verifier", status: "cancelled" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-010",
        ["artifacts/verification_result.json"],
        false,
        false // verificationPassed — implementer_attempts already at limit
      );

      expect(run.status).toBe("cancelled");
    });

    // ── Execution mode tests ─────────────────────────────────────────────────

    it("mode=next: marks pipeline complete after entry role without advancing", async () => {
      const row = makeRow({
        entry_point: "implementer",
        current_step: "implementer",
        status: "running",
        metadata: { source: "slack", execution_mode: "next" },
        steps: [
          { role: "planner", status: "not_applicable", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          { role: "sprint-controller", status: "not_applicable", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          { role: "implementer", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([row]);
      const savedRow = makeRow({ current_step: "complete", status: "complete" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "implementer",
        "exec-003",
        ["artifacts/implementation_summary.md"],
        false
      );

      expect(run.status).toBe("complete");
      expect(run.current_step).toBe("complete");
    });

    it("mode=next: planner stops without advancing to sprint-controller", async () => {
      const row = makeRow({ metadata: { source: "slack", execution_mode: "next" } });

      mocks.selectWhere.mockResolvedValueOnce([row]);
      const savedRow = makeRow({ current_step: "complete", status: "complete" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-004",
        ["artifacts/phase_plan.md"],
        false
      );

      expect(run.status).toBe("complete");
      expect(run.current_step).toBe("complete");
    });

    it("mode=next-flow, entry=implementer: stops on verifier PASS (no sprint close-out)", async () => {
      const verifierRow = makeRow({
        entry_point: "implementer",
        current_step: "verifier",
        status: "running",
        metadata: { source: "slack", execution_mode: "next-flow" },
        steps: [
          { role: "planner", status: "not_applicable", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          { role: "sprint-controller", status: "not_applicable", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "complete", status: "complete" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-005",
        ["artifacts/verification_result.json"],
        false,
        true // verificationPassed
      );

      expect(run.status).toBe("complete");
      expect(run.current_step).toBe("complete");
    });

    it("mode=next-flow, entry=planner: advances to sprint-controller after verifier PASS", async () => {
      const verifierRow = makeRow({
        entry_point: "planner",
        current_step: "verifier",
        status: "running",
        metadata: { source: "slack", execution_mode: "next-flow" },
        steps: [
          { role: "planner", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-006",
        ["artifacts/verification_result.json"],
        false,
        true // verificationPassed
      );

      // planner entry → full pipeline → proceed to sprint close-out
      expect(run.current_step).toBe("sprint-controller");
      expect(run.status).toBe("running");
    });

    it("mode=full-sprint, entry=sprint-controller: verifier PASS routes to sprint-controller (not complete)", async () => {
      const verifierRow = makeRow({
        entry_point: "sprint-controller",
        current_step: "verifier",
        status: "running",
        metadata: { source: "slack", execution_mode: "full-sprint" },
        steps: [
          { role: "planner", status: "not_applicable", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-007",
        ["artifacts/verification_result.json"],
        false,
        true // verificationPassed
      );

      // full-sprint: routes back to sprint-controller for close-out (not complete)
      expect(run.current_step).toBe("sprint-controller");
      expect(run.status).toBe("running");
    });

    it("mode=full-sprint, entry=planner: verifier PASS routes to sprint-controller (not complete)", async () => {
      const verifierRow = makeRow({
        entry_point: "planner",
        current_step: "verifier",
        status: "running",
        metadata: { source: "slack", execution_mode: "full-sprint" },
        steps: [
          { role: "planner", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-008",
        ["artifacts/verification_result.json"],
        false,
        true // verificationPassed
      );

      expect(run.current_step).toBe("sprint-controller");
      expect(run.status).toBe("running");
    });

    it("mode=full-sprint: sprint-controller task close-out routes to planner", async () => {
      const sprintControllerRow = makeRow({
        entry_point: "sprint-controller",
        current_step: "sprint-controller",
        status: "running",
        metadata: { source: "slack", execution_mode: "full-sprint" },
        steps: [
          { role: "planner", status: "not_applicable", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "verifier", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "sprint-controller", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([sprintControllerRow]);
      const savedRow = makeRow({ current_step: "planner", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "sprint-controller",
        "exec-009",
        ["artifacts/sprint_closeout.json"],
        false
      );

      // Sprint Controller closes out task scope and hands off sprint close decision to Planner.
      expect(run.status).toBe("running");
      expect(run.current_step).toBe("planner");
    });

    it("planner sprint close-out transitions to awaiting_pr_review", async () => {
      const plannerRow = makeRow({
        entry_point: "planner",
        current_step: "planner",
        status: "running",
        metadata: { source: "slack", execution_mode: "full-sprint" },
        steps: [
          { role: "planner", status: "complete", gate_outcome: "auto", artifact_paths: ["artifacts/phase_plan.md"], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T00:30:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: ["artifacts/sprint_plan_s01.md"], actor: "system", started_at: "2026-04-19T00:30:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: ["artifacts/implementation_summary.md"], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T01:30:00.000Z" },
          { role: "verifier", status: "complete", gate_outcome: "auto", artifact_paths: ["artifacts/verification_result.json"], actor: "system", started_at: "2026-04-19T01:30:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: ["artifacts/sprint_closeout.json"], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T02:30:00.000Z" },
          { role: "planner", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T02:30:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([plannerRow]);
      const savedRow = makeRow({ current_step: "complete", status: "awaiting_pr_review" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-010",
        ["artifacts/planner_sprint_closeout.json"],
        false
      );

      expect(run.status).toBe("awaiting_pr_review");
      expect(run.current_step).toBe("complete");
    });

    it("planner next mode with pr details still transitions to complete", async () => {
      const plannerRow = makeRow({
        entry_point: "planner",
        current_step: "planner",
        status: "running",
        pr_number: 42,
        pr_url: "https://github.com/example/repo/pull/42",
        metadata: { source: "slack", execution_mode: "next" },
      });

      mocks.selectWhere.mockResolvedValueOnce([plannerRow]);
      const savedRow = makeRow({ current_step: "complete", status: "complete", pr_number: 42 });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-011",
        ["artifacts/sprint_plan_s01.md"],
        false
      );

      expect(run.status).toBe("complete");
      expect(run.current_step).toBe("complete");
    });

    it("creates pipeline with caller_context_stack initialized to entry_point", async () => {
      const row = makeRow();
      mocks.insertReturning.mockResolvedValueOnce([row]);

      await service.create({
        entry_point: "planner",
        input: {},
        metadata: { source: "slack", slack_channel: "C123ABC" },
      });

      const insertCall = mocks.db.insert.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> };
      const valuesCall = insertCall?.values?.mock?.calls?.[0]?.[0] as Record<string, unknown> | undefined;
      expect((valuesCall?.metadata as Record<string, unknown>)?.caller_context_stack).toEqual(["planner"]);
    });

    it("throws 409 if step is not in running status", async () => {
      mocks.selectWhere.mockResolvedValueOnce([
        makeRow({
          steps: [
            { role: "planner", status: "complete", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z" },
          ],
        }),
      ]);

      await expect(
        service.completeStep("pipe-2026-04-19-test1234", "planner", "exec-001", [], false)
      ).rejects.toMatchObject({ statusCode: 409, code: "STEP_NOT_RUNNING" });
    });
  });

  // ── artifact cleanup triggers ──────────────────────────────────────────────

  describe("artifact cleanup triggering", () => {
    it("triggers artifact cleanup when pipeline reaches status=complete", async () => {
      const row = makeRow({ metadata: { source: "slack", execution_mode: "next" } });
      mocks.selectWhere.mockResolvedValueOnce([row]);
      const savedRow = makeRow({ current_step: "complete", status: "complete" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-cleanup-1",
        [],
        false
      );

      // Allow the fire-and-forget cleanup promise to settle
      await new Promise((r) => setTimeout(r, 0));
      expect(mocks.artifactCleanup).toHaveBeenCalledWith("pipe-2026-04-19-test1234");
    });

    it("does NOT trigger artifact cleanup when pipeline transitions to status=failed", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow()]);
      const savedRow = makeRow({ status: "failed" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      await service.completeStep(
        "pipe-2026-04-19-test1234",
        "planner",
        "exec-cleanup-2",
        [],
        true // failed=true
      );

      await new Promise((r) => setTimeout(r, 0));
      expect(mocks.artifactCleanup).not.toHaveBeenCalled();
    });

    it("does NOT trigger artifact cleanup on verifier FAIL (implementer retry)", async () => {
      const verifierRow = makeRow({
        current_step: "verifier",
        status: "running",
        steps: [
          { role: "planner", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z" },
        ],
      });

      mocks.selectWhere.mockResolvedValueOnce([verifierRow]);
      const savedRow = makeRow({ current_step: "implementer", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-cleanup-3",
        [],
        false,
        false // verificationPassed=false → retry
      );

      await new Promise((r) => setTimeout(r, 0));
      expect(mocks.artifactCleanup).not.toHaveBeenCalled();
    });
  });

  // ── approve ────────────────────────────────────────────────────────────────

  describe("approve()", () => {
    it("advances the pipeline to the next step", async () => {
      const awaitingRow = makeRow({ status: "awaiting_approval" });
      mocks.selectWhere.mockResolvedValueOnce([awaitingRow]);
      const nextRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([nextRow]);

      const run = await service.approve("pipe-2026-04-19-test1234", "user-1");

      expect(run.current_step).toBe("sprint-controller");
      expect(run.status).toBe("running");
    });

    it("throws 409 if pipeline is not awaiting_approval", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow({ status: "running" })]);

      await expect(service.approve("pipe-2026-04-19-test1234", "user-1")).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_PIPELINE_STATUS",
      });
    });
  });

  // ── takeover ───────────────────────────────────────────────────────────────

  describe("takeover()", () => {
    it("sets status to paused_takeover", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow({ status: "awaiting_approval" })]);
      const savedRow = makeRow({ status: "paused_takeover" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.takeover("pipe-2026-04-19-test1234", "user-1");
      expect(run.status).toBe("paused_takeover");
    });
  });

  // ── handoff ────────────────────────────────────────────────────────────────

  describe("handoff()", () => {
    it("completes the current step and advances to the next", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow({ status: "paused_takeover" })]);
      const nextRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([nextRow]);

      const run = await service.handoff("pipe-2026-04-19-test1234", {
        actor: "user-1",
        artifact_path: "artifacts/plan.md",
      });

      expect(run.current_step).toBe("sprint-controller");
      expect(run.status).toBe("running");
    });

    it("throws 409 if pipeline is not in paused_takeover", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow({ status: "running" })]);

      await expect(
        service.handoff("pipe-2026-04-19-test1234", { actor: "user-1" })
      ).rejects.toMatchObject({ statusCode: 409, code: "INVALID_PIPELINE_STATUS" });
    });
  });

  // ── skip ───────────────────────────────────────────────────────────────────

  describe("skip()", () => {
    it("skips the current step and advances", async () => {
      mocks.selectWhere.mockResolvedValueOnce([makeRow({ status: "running" })]);
      const nextRow = makeRow({ current_step: "sprint-controller", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([nextRow]);

      const run = await service.skip("pipe-2026-04-19-test1234", {
        actor: "user-1",
        justification: "Not needed for this change",
      });

      expect(run.current_step).toBe("sprint-controller");
    });
  });
});
