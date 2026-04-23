import { describe, it, expect } from "vitest";
import { buildSlackMessage } from "../workflow-logic/pipeline-notifier.logic";

const base = {
  pipeline_id: "pipe-2026-04-19-test1234",
  step: "planner",
  gate_required: true,
  artifact_paths: [],
  metadata: { slack_channel: "C123ABC", slack_thread_ts: "1776378304.943649" },
};

describe("buildSlackMessage (pipeline-notifier Build Slack Message node)", () => {
  // ── No channel ───────────────────────────────────────────────────────────

  it("returns channel: null when metadata has no slack_channel", () => {
    const result = buildSlackMessage({ ...base, status: "awaiting_approval", metadata: {} });
    expect(result.channel).toBeNull();
    expect(result.slack_payload).toBeUndefined();
  });

  // ── awaiting_approval (gate message) ────────────────────────────────────

  describe("status: awaiting_approval", () => {
    it("posts a gate message with Approve and Take Over buttons", () => {
      const result = buildSlackMessage({ ...base, status: "awaiting_approval" });

      expect(result.channel).toBe("C123ABC");
      expect(result.slack_payload?.thread_ts).toBe("1776378304.943649");
      expect(result.slack_payload?.text).toContain("Planner completed");

      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b["type"] === "actions") as Record<string, unknown>;
      expect(actions).toBeDefined();

      const elements = actions["elements"] as Array<Record<string, unknown>>;
      const actionIds = elements.map((e) => e["action_id"]);
      expect(actionIds).toContain("approve_pipeline");
      expect(actionIds).toContain("takeover_pipeline");
    });

    it("includes artifact path in message when provided", () => {
      const result = buildSlackMessage({
        ...base,
        status: "awaiting_approval",
        artifact_paths: ["artifacts/phase_plan.md"],
      });
      const section = (result.slack_payload?.blocks as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
      const text = (section["text"] as Record<string, unknown>)["text"] as string;
      expect(text).toContain("artifacts/phase_plan.md");
    });

    it("button values carry the pipeline_id", () => {
      const result = buildSlackMessage({ ...base, status: "awaiting_approval" });
      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b["type"] === "actions") as Record<string, unknown>;
      const elements = actions["elements"] as Array<Record<string, unknown>>;
      elements.forEach((el) => expect(el["value"]).toBe("pipe-2026-04-19-test1234"));
    });
  });

  // ── failed ────────────────────────────────────────────────────────────────

  describe("status: failed", () => {
    it("posts a failure message with Take Over Fix and Skip buttons", () => {
      const result = buildSlackMessage({ ...base, status: "failed", step: "verifier" });

      expect(result.slack_payload?.text).toContain("failed");

      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b["type"] === "actions") as Record<string, unknown>;
      const elements = actions["elements"] as Array<Record<string, unknown>>;
      const actionIds = elements.map((e) => e["action_id"]);
      expect(actionIds).toContain("takeover_pipeline");
      expect(actionIds).toContain("skip_pipeline");
    });

    it("skip button value encodes pipeline_id with justification separator", () => {
      const result = buildSlackMessage({ ...base, status: "failed" });
      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b["type"] === "actions") as Record<string, unknown>;
      const elements = actions["elements"] as Array<Record<string, unknown>>;
      const skipEl = elements.find((e) => e["action_id"] === "skip_pipeline") as Record<string, unknown>;
      expect(String(skipEl["value"])).toMatch(/^pipe-2026-04-19-test1234::/);
    });
  });

  // ── complete ──────────────────────────────────────────────────────────────

  describe("status: complete", () => {
    it("posts a completion message with no action buttons", () => {
      const result = buildSlackMessage({
        ...base,
        status: "complete",
        artifact_paths: ["artifacts/plan.md", "artifacts/sprint.md"],
      });

      expect(result.slack_payload?.text).toContain("Pipeline complete");
      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b["type"] === "actions");
      expect(actions).toBeUndefined();

      const section = blocks[0] as Record<string, unknown>;
      const text = (section["text"] as Record<string, unknown>)["text"] as string;
      expect(text).toContain("artifacts/plan.md");
      expect(text).toContain("artifacts/sprint.md");
    });
  });

  // ── paused_takeover ───────────────────────────────────────────────────────

  describe("status: paused_takeover", () => {
    it("posts a takeover active message with handoff instruction", () => {
      const result = buildSlackMessage({ ...base, status: "paused_takeover" });
      expect(result.slack_payload?.text).toContain("Takeover active");
      const section = (result.slack_payload?.blocks as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
      const text = (section["text"] as Record<string, unknown>)["text"] as string;
      expect(text).toContain("/handoff");
    });
  });

  // ── cancelled (fixer loop limit) ─────────────────────────────────────────

  describe("status: cancelled", () => {
    it("posts a cancellation message mentioning fixer loop limit", () => {
      const result = buildSlackMessage({ ...base, status: "cancelled", step: "verifier" });
      expect(result.slack_payload?.text).toContain("cancelled");
      const section = (result.slack_payload?.blocks as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
      const text = (section["text"] as Record<string, unknown>)["text"] as string;
      expect(text).toContain("fixer attempts");
      expect(text).toContain("/takeover");
    });
  });

  // ── running (progress context) ────────────────────────────────────────────

  describe("status: running", () => {
    it("posts a context progress message", () => {
      const result = buildSlackMessage({ ...base, status: "running" });
      expect(result.slack_payload?.text).toContain("running");
      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      expect(blocks[0]["type"]).toBe("context");
    });
  });

  // ── event: progress ───────────────────────────────────────────────────────

  describe("event: progress", () => {
    it("posts the custom message as a context block", () => {
      const result = buildSlackMessage({
        ...base,
        status: "running",
        event: "progress",
        message: "⚙️ Implementing task-001",
      });
      expect(result.channel).toBe("C123ABC");
      expect(result.slack_payload?.text).toBe("Planner: ⚙️ Implementing task-001");
      const blocks = result.slack_payload?.blocks as Array<Record<string, unknown>>;
      expect(blocks[0]["type"]).toBe("context");
      const elements = (blocks[0]["elements"] as Array<Record<string, unknown>>);
      expect((elements[0]["text"] as string)).toBe("Planner: ⚙️ Implementing task-001");
    });

    it("falls back to generic running message when message is absent", () => {
      const result = buildSlackMessage({ ...base, status: "running", event: "progress" });
      expect(result.slack_payload?.text).toContain("running");
    });

    it("includes thread_ts when present", () => {
      const result = buildSlackMessage({
        ...base,
        status: "running",
        event: "progress",
        message: "📝 Writing src/foo.ts",
      });
      expect(result.slack_payload?.thread_ts).toBe("1776378304.943649");
    });
  });

  // ── thread_ts ─────────────────────────────────────────────────────────────

  it("omits thread_ts when not in metadata", () => {
    const result = buildSlackMessage({
      ...base,
      status: "running",
      metadata: { slack_channel: "C123ABC" },
    });
    expect(result.slack_payload?.thread_ts).toBeUndefined();
  });

  // ── step label formatting ─────────────────────────────────────────────────

  it("uses canonical caller labels in messages", () => {
    const result = buildSlackMessage({ ...base, status: "running", step: "sprint-controller" });
    expect(result.slack_payload?.text).toContain("Sprint-Controller");
  });
});
