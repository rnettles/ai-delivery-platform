import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { HttpError } from "../utils/http-error";

// ─── Mock all service dependencies before importing app ──────────────────────

vi.mock("../services/pipeline.service", () => ({
  pipelineService: {
    create: vi.fn(),
    get: vi.fn(),
    approve: vi.fn(),
    takeover: vi.fn(),
    handoff: vi.fn(),
    skip: vi.fn(),
  },
}));

vi.mock("../services/pipeline-notifier.service", () => ({
  pipelineNotifierService: { notify: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/execution.service", () => ({
  executionService: { execute: vi.fn().mockResolvedValue({ execution_id: "exec-001" }) },
}));

// Prevent DB connection on import
vi.mock("../db/client", () => ({ db: {} }));
vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { app } from "../app";
import { pipelineService } from "../services/pipeline.service";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockRun = {
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
  created_at: "2026-04-19T00:00:00.000Z",
  updated_at: "2026-04-19T00:00:00.000Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pipeline HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /pipeline ─────────────────────────────────────────────────────────

  describe("POST /pipeline", () => {
    it("returns 202 with the new pipeline run", async () => {
      vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

      const res = await request(app)
        .post("/pipeline")
        .send({ entry_point: "planner", input: { description: "Build a widget" } });

      expect(res.status).toBe(202);
      expect(res.body.pipeline_id).toBe("pipe-2026-04-19-test1234");
      expect(res.body.status).toBe("running");
    });

    it("returns 400 for an invalid entry_point", async () => {
      const res = await request(app)
        .post("/pipeline")
        .send({ entry_point: "invalid-role" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_ENTRY_POINT");
    });

    it("returns 400 when entry_point is missing", async () => {
      const res = await request(app).post("/pipeline").send({});
      expect(res.status).toBe(400);
    });
  });

  // ── GET /pipeline/:pipelineId ──────────────────────────────────────────────

  describe("GET /pipeline/:pipelineId", () => {
    it("returns 200 with the pipeline run", async () => {
      vi.mocked(pipelineService.get).mockResolvedValueOnce(mockRun as never);

      const res = await request(app).get("/pipeline/pipe-2026-04-19-test1234");

      expect(res.status).toBe(200);
      expect(res.body.pipeline_id).toBe("pipe-2026-04-19-test1234");
    });

    it("returns 404 when pipeline is not found", async () => {
      vi.mocked(pipelineService.get).mockRejectedValueOnce(
        new HttpError(404, "PIPELINE_NOT_FOUND", "Not found")
      );

      const res = await request(app).get("/pipeline/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PIPELINE_NOT_FOUND");
    });
  });

  // ── POST /pipeline/:pipelineId/approve ─────────────────────────────────────

  describe("POST /pipeline/:pipelineId/approve", () => {
    it("returns 200 with the updated pipeline run", async () => {
      const approvedRun = { ...mockRun, current_step: "sprint-controller", status: "running" };
      vi.mocked(pipelineService.approve).mockResolvedValueOnce(approvedRun as never);

      const res = await request(app)
        .post("/pipeline/pipe-2026-04-19-test1234/approve")
        .send({ actor: "user-1" });

      expect(res.status).toBe(200);
      expect(res.body.current_step).toBe("sprint-controller");
    });

    it("returns 409 when pipeline is not awaiting_approval", async () => {
      vi.mocked(pipelineService.approve).mockRejectedValueOnce(
        new HttpError(409, "INVALID_PIPELINE_STATUS", "Not awaiting approval")
      );

      const res = await request(app)
        .post("/pipeline/pipe-2026-04-19-test1234/approve")
        .send({ actor: "user-1" });

      expect(res.status).toBe(409);
    });
  });

  // ── POST /pipeline/:pipelineId/takeover ────────────────────────────────────

  describe("POST /pipeline/:pipelineId/takeover", () => {
    it("returns 200 with status paused_takeover", async () => {
      const takeoverRun = { ...mockRun, status: "paused_takeover" };
      vi.mocked(pipelineService.takeover).mockResolvedValueOnce(takeoverRun as never);

      const res = await request(app)
        .post("/pipeline/pipe-2026-04-19-test1234/takeover")
        .set("x-actor", "user-1");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("paused_takeover");
    });
  });

  // ── POST /pipeline/:pipelineId/handoff ─────────────────────────────────────

  describe("POST /pipeline/:pipelineId/handoff", () => {
    it("returns 200 and advances to next step", async () => {
      const handoffRun = { ...mockRun, current_step: "sprint-controller", status: "running" };
      vi.mocked(pipelineService.handoff).mockResolvedValueOnce(handoffRun as never);

      const res = await request(app)
        .post("/pipeline/pipe-2026-04-19-test1234/handoff")
        .send({ actor: "user-1", artifact_path: "artifacts/plan.md" });

      expect(res.status).toBe(200);
      expect(res.body.current_step).toBe("sprint-controller");
    });
  });

  // ── POST /pipeline/:pipelineId/skip ────────────────────────────────────────

  describe("POST /pipeline/:pipelineId/skip", () => {
    it("returns 200 and skips to next step", async () => {
      const skipRun = { ...mockRun, current_step: "sprint-controller", status: "running" };
      vi.mocked(pipelineService.skip).mockResolvedValueOnce(skipRun as never);

      const res = await request(app)
        .post("/pipeline/pipe-2026-04-19-test1234/skip")
        .send({ actor: "user-1", justification: "Not needed" });

      expect(res.status).toBe(200);
      expect(res.body.current_step).toBe("sprint-controller");
    });
  });
});
