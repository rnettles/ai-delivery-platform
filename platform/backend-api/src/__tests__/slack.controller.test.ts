import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Mock all dependencies before importing app ────────────────────────────────

vi.mock("../services/pipeline.service", () => ({
  pipelineService: {
    create: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
    takeover: vi.fn(),
    handoff: vi.fn(),
    skip: vi.fn(),
    getCurrentStatusSummary: vi.fn(),
  },
}));

vi.mock("../services/project.service", () => ({
  projectService: {
    create: vi.fn(),
    registerChannel: vi.fn(),
  },
}));

vi.mock("../services/slack.service", () => ({
  slackService: {
    ack: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

// Skip Slack signature verification in tests
vi.mock("../config", () => ({
  config: {
    slackSigningSecret: "",
    slackBotToken: "",
    dryRun: false,
  },
}));

vi.mock("../db/client", () => ({ db: {} }));
vi.mock("../services/execution.service", () => ({
  executionService: { execute: vi.fn().mockResolvedValue({ execution_id: "exec-001" }) },
}));
vi.mock("../services/git-sync.service", () => ({
  gitSyncService: { sync: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../services/pipeline-notifier.service", () => ({
  pipelineNotifierService: { notify: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../services/admin-ops.service", () => ({
  adminOpsService: { createJob: vi.fn(), getPipelineJob: vi.fn() },
}));
vi.mock("../services/llm/dry-run-scenario.service", () => ({
  dryRunScenarioService: { snapshot: vi.fn() },
}));

import { app } from "../app";
import { pipelineService } from "../services/pipeline.service";
import { projectService } from "../services/project.service";
import { slackService } from "../services/slack.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function urlEncoded(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

const mockRun = {
  pipeline_id: "pipe-2026-05-01-test1234",
  entry_point: "planner",
  current_step: "planner",
  status: "running",
  steps: [],
  metadata: { source: "slack", slack_channel: "C123" },
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
  implementer_attempts: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /slack/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responds to URL verification challenge", async () => {
    const res = await request(app)
      .post("/slack/events")
      .set("content-type", "application/json")
      .send(JSON.stringify({ type: "url_verification", challenge: "abc123" }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: "abc123" });
  });

  it("accepts slash command and returns 200 immediately", async () => {
    vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

    const res = await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/plan",
          text: "Build the auth module",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "https://hooks.slack.com/resp/001",
        })
      );

    expect(res.status).toBe(200);
  });

  it("creates a pipeline with correct metadata from slash command", async () => {
    vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

    await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/plan",
          text: "Build the auth module",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "https://hooks.slack.com/resp/001",
        })
      );

    // Pipeline creation is fire-and-forget — give it a tick to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(pipelineService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_point: "planner",
        execution_mode: "next",
        input: { description: "Build the auth module" },
        metadata: expect.objectContaining({
          source: "slack",
          slack_channel: "C123",
          slack_user: "U456",
        }),
      })
    );
  });

  it("sends an acknowledgement ack for /plan commands", async () => {
    vi.mocked(pipelineService.create).mockResolvedValueOnce(mockRun as never);

    await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/plan",
          text: "Build feature X",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "https://hooks.slack.com/resp/001",
        })
      );

    await new Promise((r) => setTimeout(r, 10));

    expect(slackService.ack).toHaveBeenCalledWith(
      "https://hooks.slack.com/resp/001",
      expect.stringContaining("⏳"),
      true
    );
  });

  it("returns pipeline status for /status command", async () => {
    vi.mocked(pipelineService.getCurrentStatusSummary).mockResolvedValueOnce({
      kind: "single",
      run: { ...mockRun, steps: [], implementer_attempts: 0 } as never,
    });

    const res = await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/status",
          text: "",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "",
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.text).toContain("pipe-2026-05-01-test1234");
  });

  it("returns 'none' message when no active pipeline for /status", async () => {
    vi.mocked(pipelineService.getCurrentStatusSummary).mockResolvedValueOnce({
      kind: "none",
      message: "No active pipeline",
    });

    const res = await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/status",
          text: "",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "",
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.text).toContain("No active pipeline");
  });

  it("handles unknown commands gracefully", async () => {
    const res = await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/unknown-command",
          text: "",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "https://hooks.slack.com/resp/001",
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.response_type).toBe("ephemeral");
  });

  it("approves a pipeline via /approve command", async () => {
    vi.mocked(pipelineService.approve).mockResolvedValueOnce(mockRun as never);

    await request(app)
      .post("/slack/events")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(
        urlEncoded({
          command: "/approve",
          text: "pipe-2026-05-01-test1234",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "https://hooks.slack.com/resp/001",
        })
      );

    await new Promise((r) => setTimeout(r, 10));

    expect(pipelineService.approve).toHaveBeenCalledWith("pipe-2026-05-01-test1234", "alice");
  });
});

describe("POST /slack/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function slackActionPayload(actionId: string, pipelineId: string, value = pipelineId): string {
    const payload = JSON.stringify({
      type: "block_actions",
      actions: [{ action_id: actionId, value }],
      user: { id: "U456", username: "alice" },
      channel: { id: "C123" },
      message: { ts: "1234567890.123" },
      response_url: "https://hooks.slack.com/actions/001",
    });
    return urlEncoded({ payload });
  }

  it("returns 200 immediately for approve action", async () => {
    vi.mocked(pipelineService.approve).mockResolvedValueOnce(mockRun as never);

    const res = await request(app)
      .post("/slack/actions")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(slackActionPayload("approve_pipeline", "pipe-2026-05-01-test1234"));

    expect(res.status).toBe(200);
  });

  it("calls pipelineService.approve with correct id for approve action", async () => {
    vi.mocked(pipelineService.approve).mockResolvedValueOnce(mockRun as never);

    await request(app)
      .post("/slack/actions")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(slackActionPayload("approve_pipeline", "pipe-2026-05-01-test1234"));

    await new Promise((r) => setTimeout(r, 10));

    expect(pipelineService.approve).toHaveBeenCalledWith("pipe-2026-05-01-test1234", "alice");
  });

  it("calls pipelineService.takeover for takeover action", async () => {
    vi.mocked(pipelineService.takeover).mockResolvedValueOnce(mockRun as never);

    await request(app)
      .post("/slack/actions")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(slackActionPayload("takeover_pipeline", "pipe-2026-05-01-test1234"));

    await new Promise((r) => setTimeout(r, 10));

    expect(pipelineService.takeover).toHaveBeenCalledWith("pipe-2026-05-01-test1234", "alice");
  });

  it("calls pipelineService.skip with justification for skip action", async () => {
    vi.mocked(pipelineService.skip).mockResolvedValueOnce(mockRun as never);
    const value = "pipe-2026-05-01-test1234::Skipping broken step";

    await request(app)
      .post("/slack/actions")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(slackActionPayload("skip_pipeline", "pipe-2026-05-01-test1234", value));

    await new Promise((r) => setTimeout(r, 10));

    expect(pipelineService.skip).toHaveBeenCalledWith(
      "pipe-2026-05-01-test1234",
      expect.objectContaining({ justification: "Skipping broken step" })
    );
  });

  it("returns 400 for an invalid action payload", async () => {
    const res = await request(app)
      .post("/slack/actions")
      .set("content-type", "application/x-www-form-urlencoded")
      .send(urlEncoded({ payload: "{}" }));

    expect(res.status).toBe(400);
  });
});
