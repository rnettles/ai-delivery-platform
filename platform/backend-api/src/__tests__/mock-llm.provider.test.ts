import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { dryRunScenarioService } from "../services/llm/dry-run-scenario.service";
import { MockLlmProvider } from "../services/llm/mock-llm.provider";

beforeEach(() => {
  // Reset to a known scenario for each test.
  dryRunScenarioService.load(undefined);
});

describe("MockLlmProvider", () => {
  it("planner phase-plan returns a PlannerPhasePlan-shaped object", async () => {
    const provider = new MockLlmProvider("planner");
    const result = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "planner", pipeline_id: "pipe-1", call_type: "phase-plan" },
    });
    expect(result.phase_id).toBe("P01");
    expect(Array.isArray(result.fr_ids_in_scope)).toBe(true);
    expect((result.fr_ids_in_scope as string[]).length).toBeGreaterThan(0);
    expect(result.status).toBe("Draft");
  });

  it("planner sprint-plan returns sprint_plan + first_task + task_flags", async () => {
    const provider = new MockLlmProvider("planner");
    const result = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "planner", pipeline_id: "pipe-2", call_type: "sprint-plan" },
    });
    expect((result.sprint_plan as Record<string, unknown>).sprint_id).toBe("S01");
    expect((result.first_task as Record<string, unknown>).task_id).toBe("S01-001");
    expect((result.task_flags as Record<string, unknown>).incident_tier).toBe("none");
  });

  it("sprint-controller setup returns an LlmResponse-shaped object with required fields", async () => {
    const provider = new MockLlmProvider("sprint-controller");
    const result = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "sprint-controller", pipeline_id: "pipe-3", call_type: "setup" },
    });
    expect((result.sprint_plan as Record<string, unknown>).sprint_id).toBeDefined();
    expect((result.first_task as Record<string, unknown>).task_id).toBeDefined();
  });

  it("verifier returns PASS by default", async () => {
    const provider = new MockLlmProvider("verifier");
    const result = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "verifier", pipeline_id: "pipe-4" },
    });
    const handoff = result.handoff as Record<string, unknown>;
    expect(handoff.verification_state).toBe("pass");
    expect(handoff.next_role_action).toBe("none");
  });

  it("verifier returns FAIL when scenario step matches", async () => {
    dryRunScenarioService.load(undefined);
    // Manually inject scenario via service's pipeline override mechanism.
    dryRunScenarioService.registerPipelineDirectives("pipe-fail", {
      steps: [{ match: { role: "verifier", occurrence: 1 }, outcome: "fail", reason: "test" }],
    });
    const provider = new MockLlmProvider("verifier");
    const result = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "verifier", pipeline_id: "pipe-fail" },
    });
    const handoff = result.handoff as Record<string, unknown>;
    expect(handoff.verification_state).toBe("fail");
    expect(handoff.next_role_action).toBe("implementer_retry");
  });

  it("occurrence counter advances FAIL→PASS across calls", async () => {
    dryRunScenarioService.registerPipelineDirectives("pipe-seq", {
      steps: [{ match: { role: "verifier", occurrence: 1 }, outcome: "fail" }],
    });
    const provider = new MockLlmProvider("verifier");
    const first = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "verifier", pipeline_id: "pipe-seq" },
    });
    const second = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "verifier", pipeline_id: "pipe-seq" },
    });
    expect((first.handoff as Record<string, unknown>).verification_state).toBe("fail");
    expect((second.handoff as Record<string, unknown>).verification_state).toBe("pass");
  });

  it("throws when scenario step outcome=throw", async () => {
    dryRunScenarioService.registerPipelineDirectives("pipe-throw", {
      steps: [
        {
          match: { role: "planner", call_type: "phase-plan", occurrence: 1 },
          outcome: "throw",
          error: { code: "BOOM", message: "synthetic failure" },
        },
      ],
    });
    const provider = new MockLlmProvider("planner");
    await expect(
      provider.chatJson<Record<string, unknown>>([], {
        meta: { role: "planner", pipeline_id: "pipe-throw", call_type: "phase-plan" },
      })
    ).rejects.toThrow(/BOOM/);
  });

  it("fixture_overrides deep-merge onto defaults", async () => {
    dryRunScenarioService.registerPipelineDirectives("pipe-merge", {
      steps: [
        {
          match: { role: "planner", call_type: "phase-plan" },
          fixture_overrides: { phase_id: "P99", name: "Override" },
        },
      ],
    });
    const provider = new MockLlmProvider("planner");
    const result = await provider.chatJson<Record<string, unknown>>([], {
      meta: { role: "planner", pipeline_id: "pipe-merge", call_type: "phase-plan" },
    });
    expect(result.phase_id).toBe("P99");
    expect(result.name).toBe("Override");
    // Untouched fields preserved
    expect(result.status).toBe("Draft");
  });

  it("chatWithTools emits write_file → set_progress → finish for implementer", async () => {
    const provider = new MockLlmProvider("implementer");
    const calls: string[] = [];
    const executor = async (call: { name: string }) => {
      calls.push(call.name);
      return "ok";
    };
    const result = await provider.chatWithTools(
      [],
      [
        { name: "write_file", description: "", parameters: { type: "object" } },
        { name: "set_progress", description: "", parameters: { type: "object" } },
        { name: "finish", description: "", parameters: { type: "object" } },
      ],
      executor,
      { meta: { role: "implementer", pipeline_id: "pipe-impl" } }
    );
    expect(calls).toEqual(["write_file", "set_progress", "finish"]);
    expect(result.tool_calls.length).toBe(3);
  });
});
