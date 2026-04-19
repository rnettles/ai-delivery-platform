import { describe, it, expect } from "vitest";
import { parseSlackCommand } from "../workflow-logic/slack-ingress.logic";

describe("parseSlackCommand (slack-ingress Guard & Parse node)", () => {
  // ── URL verification ────────────────────────────────────────────────────

  describe("URL verification challenge", () => {
    it("returns challenge type for url_verification events", () => {
      const result = parseSlackCommand({ type: "url_verification", challenge: "abc123" });
      expect(result).toEqual({ type: "challenge", challenge: "abc123" });
    });
  });

  // ── Create pipeline commands ─────────────────────────────────────────────

  describe("/plan", () => {
    it("maps /plan to planner entry_point", () => {
      const result = parseSlackCommand({
        command: "/plan",
        text: "Build the authentication module",
        channel_id: "C123",
        user_id: "U456",
        user_name: "alice",
        response_url: "https://hooks.slack.com/resp/001",
      });
      expect(result).toMatchObject({
        type: "create_pipeline",
        entry_point: "planner",
        description: "Build the authentication module",
        channel_id: "C123",
        user_id: "U456",
        user_name: "alice",
        response_url: "https://hooks.slack.com/resp/001",
      });
    });

    it("handles /plan with no description (empty text)", () => {
      const result = parseSlackCommand({ command: "/plan", text: "" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "planner", description: "" });
    });

    it("maps /adp-plan to planner entry_point", () => {
      const result = parseSlackCommand({ command: "/adp-plan", text: "Build the authentication module" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "planner" });
    });
  });

  describe("/sprint", () => {
    it("maps /sprint to sprint-controller", () => {
      const result = parseSlackCommand({ command: "/sprint", text: "PH-AUTH-1" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "sprint-controller", description: "PH-AUTH-1" });
    });
  });

  describe("/implement", () => {
    it("maps /implement to implementer", () => {
      const result = parseSlackCommand({ command: "/implement", text: "TASK-001" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "implementer" });
    });
  });

  describe("/verify", () => {
    it("maps /verify to verifier", () => {
      const result = parseSlackCommand({ command: "/verify", text: "TASK-001" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "verifier" });
    });
  });

  // ── Action commands ───────────────────────────────────────────────────────

  describe("/approve", () => {
    it("returns pipeline_action with approve action and pipeline_id", () => {
      const result = parseSlackCommand({
        command: "/approve",
        text: "pipe-2026-04-19-abc12345",
        channel_id: "C123",
        user_id: "U789",
        user_name: "bob",
        response_url: "https://hooks.slack.com/resp/002",
      });
      expect(result).toMatchObject({
        type: "pipeline_action",
        action: "approve",
        pipeline_id: "pipe-2026-04-19-abc12345",
        artifact_path: "",
      });
    });

    it("returns empty pipeline_id when no text provided", () => {
      const result = parseSlackCommand({ command: "/approve", text: "" });
      expect(result).toMatchObject({ type: "pipeline_action", action: "approve", pipeline_id: "" });
    });
  });

  describe("/handoff", () => {
    it("extracts pipeline_id and optional artifact_path", () => {
      const result = parseSlackCommand({
        command: "/handoff",
        text: "pipe-2026-04-19-abc12345 artifacts/plan.md",
      });
      expect(result).toMatchObject({
        type: "pipeline_action",
        action: "handoff",
        pipeline_id: "pipe-2026-04-19-abc12345",
        artifact_path: "artifacts/plan.md",
      });
    });

    it("artifact_path is empty when not provided", () => {
      const result = parseSlackCommand({ command: "/handoff", text: "pipe-2026-04-19-abc12345" });
      expect(result).toMatchObject({ action: "handoff", artifact_path: "" });
    });
  });

  describe("/takeover", () => {
    it("returns pipeline_action with takeover action", () => {
      const result = parseSlackCommand({ command: "/takeover", text: "pipe-2026-04-19-abc12345" });
      expect(result).toMatchObject({ type: "pipeline_action", action: "takeover" });
    });
  });

  describe("/status", () => {
    it("returns pipeline_action with status action", () => {
      const result = parseSlackCommand({ command: "/status", text: "pipe-2026-04-19-abc12345" });
      expect(result).toMatchObject({ type: "pipeline_action", action: "status" });
    });

    it("maps /adp-status to status action", () => {
      const result = parseSlackCommand({ command: "/adp-status", text: "pipe-2026-04-19-abc12345" });
      expect(result).toMatchObject({ type: "pipeline_action", action: "status" });
    });
  });

  // ── Unknown / unrecognised ────────────────────────────────────────────────

  describe("unknown commands", () => {
    it("returns unknown type for unrecognised commands", () => {
      const result = parseSlackCommand({ command: "/foobar", text: "" });
      expect(result).toMatchObject({ type: "unknown", command: "/foobar" });
    });

    it("normalises command to lowercase before matching", () => {
      const result = parseSlackCommand({ command: "/PLAN", text: "something" });
      // /PLAN is normalised to /plan → should match CREATE_MAP
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "planner" });
    });
  });
});
