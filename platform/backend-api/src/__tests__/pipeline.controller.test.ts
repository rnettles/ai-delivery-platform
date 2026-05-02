import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { HttpError } from "../utils/http-error";

// ─── Mock all service dependencies before importing app ──────────────────────

vi.mock("../services/pipeline.service", () => ({
  pipelineService: {
    create: vi.fn(),
    get: vi.fn(),
    getStatusSummary: vi.fn(),
    approve: vi.fn(),
    takeover: vi.fn(),
    handoff: vi.fn(),
    skip: vi.fn(),
    retry: vi.fn(),
  },
}));

vi.mock("../services/admin-ops.service", () => ({
  adminOpsService: {
    createJob: vi.fn(),
    getPipelineJob: vi.fn(),
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

vi.mock("../services/artifact.service", () => ({
  artifactService: { read: vi.fn() },
}));

import { app } from "../app";
import { pipelineService } from "../services/pipeline.service";
import { adminOpsService } from "../services/admin-ops.service";
import { artifactService } from "../services/artifact.service";

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

    it("returns 202 immediately (async ACK) without waiting for execution to finish", async () => {
      vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);
      // Execution runs async — simulate a slow execution that should NOT block the 202
      const { executionService } = await import("../services/execution.service");
      vi.mocked(executionService.execute).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ execution_id: "exec-slow" } as never), 5000))
      );

      const start = Date.now();
      const res = await request(app)
        .post("/pipeline")
        .send({ entry_point: "planner", input: { description: "Build a widget" } });
      const elapsed = Date.now() - start;

      expect(res.status).toBe(202);
      // Response should arrive well before the slow execution resolves
      expect(elapsed).toBeLessThan(3000);
    });

    it("forwards execution_mode to pipelineService.create", async () => {
      vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

      await request(app)
        .post("/pipeline")
        .send({ entry_point: "implementer", execution_mode: "next-flow", input: {} });

      expect(pipelineService.create).toHaveBeenCalledWith(
        expect.objectContaining({ entry_point: "implementer", execution_mode: "next-flow" })
      );
    });

    it("forwards full-sprint mode to pipelineService.create", async () => {
      vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

      await request(app)
        .post("/pipeline")
        .send({ entry_point: "sprint-controller", execution_mode: "full-sprint", input: {} });

      expect(pipelineService.create).toHaveBeenCalledWith(
        expect.objectContaining({ entry_point: "sprint-controller", execution_mode: "full-sprint" })
      );
    });

    it("forwards input.description unchanged to pipelineService.create", async () => {
      vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

      await request(app)
        .post("/pipeline")
        .send({
          entry_point: "sprint-controller",
          execution_mode: "next",
          input: { description: "Stage next sprint as Fast Track" },
        });

      expect(pipelineService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entry_point: "sprint-controller",
          execution_mode: "next",
          input: { description: "Stage next sprint as Fast Track" },
        })
      );
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

  describe("GET /pipeline/:pipelineId/status-summary", () => {
    it("returns latest operation telemetry when present", async () => {
      vi.mocked(pipelineService.getStatusSummary).mockResolvedValueOnce({
        ...mockRun,
        latest_operation: {
          operation_id: "op-123",
          action: "retry",
          status: "blocked",
          updated_at: "2026-04-19T01:00:00.000Z",
          escalation_summary: "Pipeline retry was blocked because git diagnostics did not return to a healthy state.",
          human_action_checklist: ["Review diagnostics", "Repair git state", "Enqueue retry again"],
        },
      } as never);

      const res = await request(app).get("/pipeline/pipe-2026-04-19-test1234/status-summary");

      expect(res.status).toBe(200);
      expect(res.body.latest_operation.operation_id).toBe("op-123");
      expect(res.body.latest_operation.human_action_checklist).toHaveLength(3);
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

  describe("POST /pipeline/:pipelineId/ops/retry", () => {
    it("returns 202 and enqueues retry operation", async () => {
      vi.mocked(adminOpsService.createJob).mockResolvedValueOnce({
        job_id: "op-123",
        action: "retry",
        status: "queued",
      } as never);

      const res = await request(app)
        .post("/pipeline/pipe-2026-04-19-test1234/ops/retry")
        .send({ actor: "user-1" });

      expect(res.status).toBe(202);
      expect(res.body.operation.job_id).toBe("op-123");
    });
  });

  describe("GET /pipeline/:pipelineId/ops/:operationId", () => {
    it("returns operation status", async () => {
      vi.mocked(adminOpsService.getPipelineJob).mockResolvedValueOnce({
        job_id: "op-123",
        action: "retry",
        status: "running",
      } as never);

      const res = await request(app)
        .get("/pipeline/pipe-2026-04-19-test1234/ops/op-123");

      expect(res.status).toBe(200);
      expect(res.body.operation.status).toBe("running");
    });
  });

  // ── GET /pipeline/:pipelineId/artifact ────────────────────────────────────

  describe("GET /pipeline/:pipelineId/artifact", () => {
    const PIPELINE_ID = "pipe-2026-05-02-f280c0b6";
    const STORED_PATH = "../../runtime/artifacts/pipe-2026-05-02-f280c0b6/AI_IMPLEMENTATION_BRIEF.md";
    const runWithArtifact = {
      ...mockRun,
      pipeline_id: PIPELINE_ID,
      steps: [
        {
          role: "sprint-controller",
          status: "complete",
          gate_outcome: null,
          artifact_paths: [STORED_PATH],
          actor: "system",
          started_at: "2026-05-02T00:00:00.000Z",
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(artifactService.read).mockReset();
      vi.mocked(pipelineService.get).mockReset();
    });

    it("returns 200 reading content via artifactService when filename matches a stored path", async () => {
      vi.mocked(pipelineService.get).mockResolvedValueOnce(runWithArtifact as never);
      vi.mocked(artifactService.read).mockResolvedValueOnce("# Brief content");

      const res = await request(app)
        .get(`/pipeline/${PIPELINE_ID}/artifact`)
        .query({ path: "AI_IMPLEMENTATION_BRIEF.md" });

      expect(res.status).toBe(200);
      expect(res.text).toBe("# Brief content");
      expect(artifactService.read).toHaveBeenCalledWith(STORED_PATH);
    });

    it("returns 404 when the filename does not match any stored artifact path", async () => {
      vi.mocked(pipelineService.get).mockResolvedValueOnce(runWithArtifact as never);

      const res = await request(app)
        .get(`/pipeline/${PIPELINE_ID}/artifact`)
        .query({ path: "unknown_file.md" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ARTIFACT_NOT_FOUND");
    });

    it("returns 400 when path query param is missing", async () => {
      const res = await request(app)
        .get(`/pipeline/${PIPELINE_ID}/artifact`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ARTIFACT_PATH_REQUIRED");
    });

    it("returns 200 parsing JSON artifacts as objects", async () => {
      const runWithJson = {
        ...runWithArtifact,
        steps: [{ ...runWithArtifact.steps[0], artifact_paths: ["../../runtime/artifacts/pipe-2026-05-02-f280c0b6/current_task.json"] }],
      };
      vi.mocked(pipelineService.get).mockResolvedValueOnce(runWithJson as never);
      vi.mocked(artifactService.read).mockResolvedValueOnce(JSON.stringify({ task_id: "S01-001" }));

      const res = await request(app)
        .get(`/pipeline/${PIPELINE_ID}/artifact`)
        .query({ path: "current_task.json" });

      expect(res.status).toBe(200);
      expect(res.body.task_id).toBe("S01-001");
    });
  });
});
