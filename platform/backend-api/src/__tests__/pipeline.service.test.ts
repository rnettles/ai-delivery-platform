import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted DB mock ────────────────────────────────────────────────────────
// vi.hoisted ensures these are available inside vi.mock() factories
const mocks = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const insertReturning = vi.fn();
  const updateReturning = vi.fn();

  return {
    selectWhere,
    insertReturning,
    updateReturning,
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
        metadata: { source: "slack" },
      });

      expect(run.pipeline_id).toBe("pipe-2026-04-19-test1234");
      expect(run.entry_point).toBe("planner");
      expect(run.current_step).toBe("planner");
      expect(run.status).toBe("running");
      expect(mocks.db.insert).toHaveBeenCalledOnce();
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
        metadata: {},
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

    it("routes to fixer when verifier fails (verificationPassed=false)", async () => {
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
      const savedRow = makeRow({ current_step: "fixer", status: "running" });
      mocks.updateReturning.mockResolvedValueOnce([savedRow]);

      const run = await service.completeStep(
        "pipe-2026-04-19-test1234",
        "verifier",
        "exec-002",
        ["artifacts/verification_result.json"],
        false,
        false // verificationPassed
      );

      expect(run.current_step).toBe("fixer");
      expect(run.status).toBe("running");
    });

    it("cancels pipeline when fixer loop limit is reached", async () => {
      const verifierRow = makeRow({
        current_step: "verifier",
        status: "running",
        steps: [
          { role: "planner", status: "complete", gate_outcome: "approved", artifact_paths: [], actor: "user-1", started_at: "2026-04-19T00:00:00.000Z", completed_at: "2026-04-19T01:00:00.000Z" },
          { role: "sprint-controller", status: "complete", gate_outcome: "approved", artifact_paths: [], actor: "user-1", started_at: "2026-04-19T01:00:00.000Z", completed_at: "2026-04-19T02:00:00.000Z" },
          { role: "implementer", status: "complete", gate_outcome: "approved", artifact_paths: [], actor: "user-1", started_at: "2026-04-19T02:00:00.000Z", completed_at: "2026-04-19T03:00:00.000Z" },
          { role: "verifier", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T03:00:00.000Z", completed_at: "2026-04-19T03:30:00.000Z" },
          { role: "fixer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T03:30:00.000Z", completed_at: "2026-04-19T04:00:00.000Z" },
          { role: "verifier", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T04:00:00.000Z", completed_at: "2026-04-19T04:30:00.000Z" },
          { role: "fixer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T04:30:00.000Z", completed_at: "2026-04-19T05:00:00.000Z" },
          { role: "verifier", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T05:00:00.000Z", completed_at: "2026-04-19T05:30:00.000Z" },
          { role: "fixer", status: "complete", gate_outcome: "auto", artifact_paths: [], actor: "system", started_at: "2026-04-19T05:30:00.000Z", completed_at: "2026-04-19T06:00:00.000Z" },
          { role: "verifier", status: "running", gate_outcome: null, artifact_paths: [], actor: "system", started_at: "2026-04-19T06:00:00.000Z" },
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
        false // verificationPassed — but 3 fixer attempts already exhausted
      );

      expect(run.status).toBe("cancelled");
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
