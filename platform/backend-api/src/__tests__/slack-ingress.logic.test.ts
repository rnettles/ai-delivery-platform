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
    it("maps /plan to planner entry_point with default mode 'next'", () => {
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
        execution_mode: "next",
        description: "Build the authentication module",
        channel_id: "C123",
        user_id: "U456",
        user_name: "alice",
        response_url: "https://hooks.slack.com/resp/001",
      });
    });

    it("handles /plan with no description (empty text)", () => {
      const result = parseSlackCommand({ command: "/plan", text: "" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "planner", execution_mode: "next", description: "" });
    });

    it("maps /adp-plan to planner entry_point", () => {
      const result = parseSlackCommand({ command: "/adp-plan", text: "Build the authentication module" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "planner" });
    });

    it("maps nested n8n body payloads to planner entry_point", () => {
      const result = parseSlackCommand({
        body: {
          command: "/adp-plan",
          text: "Build the authentication module",
          channel_id: "C123",
          user_id: "U456",
          user_name: "alice",
          response_url: "https://hooks.slack.com/resp/001",
        },
      });
      expect(result).toMatchObject({
        type: "create_pipeline",
        entry_point: "planner",
        description: "Build the authentication module",
        channel_id: "C123",
      });
    });

    it("maps urlencoded nested body strings to planner entry_point", () => {
      const result = parseSlackCommand({
        body: "command=%2Fadp-plan&text=Build+the+authentication+module&channel_id=C123&user_id=U456&user_name=alice&response_url=https%3A%2F%2Fhooks.slack.com%2Fresp%2F001",
      });
      expect(result).toMatchObject({
        type: "create_pipeline",
        entry_point: "planner",
        description: "Build the authentication module",
        channel_id: "C123",
      });
    });

    // ── Execution mode parsing ─────────────────────────────────────────

    it("defaults execution_mode to 'next' when no mode keyword is given", () => {
      const result = parseSlackCommand({ command: "/plan", text: "Build auth" });
      expect(result).toMatchObject({ execution_mode: "next", description: "Build auth" });
    });

    it("parses bare 'next' keyword", () => {
      const result = parseSlackCommand({ command: "/plan", text: "next" });
      expect(result).toMatchObject({ execution_mode: "next", description: "" });
    });

    it("parses 'next-flow' keyword and strips it from description", () => {
      const result = parseSlackCommand({ command: "/plan", text: "next-flow Build auth module" });
      expect(result).toMatchObject({ execution_mode: "next-flow", description: "Build auth module" });
    });

    it("/plan next-flow with no trailing description gives empty description", () => {
      const result = parseSlackCommand({ command: "/plan", text: "next-flow" });
      expect(result).toMatchObject({ execution_mode: "next-flow", description: "" });
    });

    it("non-mode first word is treated as part of description", () => {
      const result = parseSlackCommand({ command: "/plan", text: "Build the feature" });
      expect(result).toMatchObject({ execution_mode: "next", description: "Build the feature" });
    });
  });

  describe("/sprint", () => {
    it("maps /sprint to sprint-controller with default mode 'next'", () => {
      const result = parseSlackCommand({ command: "/sprint", text: "PH-AUTH-1" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "sprint-controller", execution_mode: "next", description: "PH-AUTH-1" });
    });

    it("parses 'next-flow' mode for /sprint", () => {
      const result = parseSlackCommand({ command: "/sprint", text: "next-flow" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "sprint-controller", execution_mode: "next-flow", description: "" });
    });

    it("parses 'full-sprint' mode for /sprint", () => {
      const result = parseSlackCommand({ command: "/sprint", text: "full-sprint" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "sprint-controller", execution_mode: "full-sprint", description: "" });
    });
  });

  describe("/implement", () => {
    it("maps /implement to implementer with default mode 'next'", () => {
      const result = parseSlackCommand({ command: "/implement", text: "TASK-001" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "implementer", execution_mode: "next", description: "TASK-001" });
    });

    it("parses 'next-flow' mode for /implement", () => {
      const result = parseSlackCommand({ command: "/implement", text: "next-flow" });
      expect(result).toMatchObject({ execution_mode: "next-flow", description: "" });
    });
  });

  describe("/verify", () => {
    it("maps /verify to verifier with default mode 'next'", () => {
      const result = parseSlackCommand({ command: "/verify", text: "TASK-001" });
      expect(result).toMatchObject({ type: "create_pipeline", entry_point: "verifier", execution_mode: "next", description: "TASK-001" });
    });

    it("parses 'next-flow' mode for /verify", () => {
      const result = parseSlackCommand({ command: "/verify", text: "next-flow" });
      expect(result).toMatchObject({ execution_mode: "next-flow", description: "" });
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

  describe("/cancel", () => {
    it("returns pipeline_action with cancel action", () => {
      const result = parseSlackCommand({ command: "/cancel", text: "pipe-2026-04-19-abc12345" });
      expect(result).toMatchObject({ type: "pipeline_action", action: "cancel" });
    });

    it("maps /adp-cancel to cancel action", () => {
      const result = parseSlackCommand({ command: "/adp-cancel", text: "pipe-2026-04-19-abc12345" });
      expect(result).toMatchObject({ type: "pipeline_action", action: "cancel" });
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

  describe("/adp-project", () => {
    it("parses register action with name, repo URL, and optional branch", () => {
      const result = parseSlackCommand({
        command: "/adp-project",
        text: "register sample https://github.com/acme/sample.git main",
        channel_id: "C123",
      });
      expect(result).toMatchObject({
        type: "pipeline_action",
        action: "project-register",
        project_name: "sample",
        repo_url: "https://github.com/acme/sample.git",
        default_branch: "main",
        channel_id: "C123",
      });
    });

    it("parses assign action and defaults target channel to current channel", () => {
      const result = parseSlackCommand({
        command: "/adp-project",
        text: "assign 11111111-1111-1111-1111-111111111111",
        channel_id: "C999",
      });
      expect(result).toMatchObject({
        type: "pipeline_action",
        action: "project-assign",
        project_id: "11111111-1111-1111-1111-111111111111",
        target_channel_id: "C999",
      });
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
