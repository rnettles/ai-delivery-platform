import { describe, it, expect } from "vitest";
import { parseSlackActionPayload } from "../workflow-logic/slack-action.logic";

function makeRawPayload(overrides: Partial<{
  type: string;
  actions: unknown[];
  user: Record<string, string>;
  channel: Record<string, string>;
  message: Record<string, string>;
  response_url: string;
}> = {}): Record<string, unknown> {
  const inner = {
    type: overrides.type ?? "block_actions",
    actions: overrides.actions ?? [
      { action_id: "approve_pipeline", value: "pipe-2026-04-19-abc12345" },
    ],
    user: overrides.user ?? { id: "U789", username: "bob" },
    channel: overrides.channel ?? { id: "C123" },
    message: overrides.message ?? { ts: "1776378304.943649" },
    response_url: overrides.response_url ?? "https://hooks.slack.com/actions/resp",
  };
  return { payload: JSON.stringify(inner) };
}

describe("parseSlackActionPayload (slack-action-handler Parse Slack Payload node)", () => {
  // ── Valid approve action ──────────────────────────────────────────────────

  describe("approve_pipeline action", () => {
    it("parses a valid approve block_actions payload", () => {
      const result = parseSlackActionPayload(makeRawPayload());

      expect(result.valid).toBe(true);
      if (!result.valid) return;

      expect(result.action_id).toBe("approve_pipeline");
      expect(result.pipeline_id).toBe("pipe-2026-04-19-abc12345");
      expect(result.actor).toBe("bob");
      expect(result.channel_id).toBe("C123");
      expect(result.message_ts).toBe("1776378304.943649");
      expect(result.response_url).toBe("https://hooks.slack.com/actions/resp");
      expect(result.justification).toBe("Actioned via Slack button");
    });
  });

  // ── takeover_pipeline action ─────────────────────────────────────────────

  describe("takeover_pipeline action", () => {
    it("parses a valid takeover payload", () => {
      const result = parseSlackActionPayload(
        makeRawPayload({
          actions: [{ action_id: "takeover_pipeline", value: "pipe-2026-04-19-abc12345" }],
          user: { id: "U999", username: "carol" },
        })
      );

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.action_id).toBe("takeover_pipeline");
      expect(result.actor).toBe("carol");
    });
  });

  // ── skip_pipeline action (value encodes justification) ───────────────────

  describe("skip_pipeline action", () => {
    it("splits value on '::' to extract pipeline_id and justification", () => {
      const result = parseSlackActionPayload(
        makeRawPayload({
          actions: [
            { action_id: "skip_pipeline", value: "pipe-2026-04-19-abc12345::Auto-skip after failure" },
          ],
        })
      );

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.action_id).toBe("skip_pipeline");
      expect(result.pipeline_id).toBe("pipe-2026-04-19-abc12345");
      expect(result.justification).toBe("Auto-skip after failure");
    });

    it("uses default justification when value has no '::'", () => {
      const result = parseSlackActionPayload(
        makeRawPayload({
          actions: [{ action_id: "skip_pipeline", value: "pipe-2026-04-19-abc12345" }],
        })
      );

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.justification).toBe("Actioned via Slack button");
    });
  });

  // ── Invalid / malformed ───────────────────────────────────────────────────

  describe("error cases", () => {
    it("returns valid:false for unparseable payload JSON", () => {
      const result = parseSlackActionPayload({ payload: "not-json{{" });
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.error).toBe("Invalid payload JSON");
    });

    it("returns valid:false when type is not block_actions", () => {
      const result = parseSlackActionPayload(makeRawPayload({ type: "view_submission" }));
      expect(result.valid).toBe(false);
    });

    it("returns valid:false when actions array is empty", () => {
      const result = parseSlackActionPayload(makeRawPayload({ actions: [] }));
      expect(result.valid).toBe(false);
    });

    it("returns valid:false when payload field is missing", () => {
      const result = parseSlackActionPayload({});
      expect(result.valid).toBe(false);
    });
  });

  // ── Actor fallback ────────────────────────────────────────────────────────

  describe("actor resolution", () => {
    it("falls back from username to name to id", () => {
      const result = parseSlackActionPayload(
        makeRawPayload({ user: { id: "U000", name: "dave" } })
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.actor).toBe("dave");
    });

    it("uses user.id when no username or name present", () => {
      const result = parseSlackActionPayload(
        makeRawPayload({ user: { id: "U000" } })
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.actor).toBe("U000");
    });
  });
});
