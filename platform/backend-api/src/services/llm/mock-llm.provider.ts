import { logger } from "../logger.service";
import {
  ChatMessage,
  ChatOptions,
  LlmProvider,
  ToolCall,
  ToolCallResult,
  ToolChatOptions,
  ToolDefinition,
  ToolExecutor,
} from "./llm-provider.interface";
import { dryRunScenarioService } from "./dry-run-scenario.service";
import { DryRunOutcome } from "./dry-run-scenario.types";

/**
 * Deep-merge `b` onto `a`. Arrays are replaced (not concatenated) — matches typical
 * fixture-override expectations.
 */
function deepMerge<T>(a: T, b: unknown): T {
  if (b === null || b === undefined) return a;
  if (typeof a !== "object" || a === null || Array.isArray(a)) return b as T;
  if (typeof b !== "object" || Array.isArray(b)) return b as T;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    out[k] = deepMerge((a as Record<string, unknown>)[k], v);
  }
  return out as T;
}

interface FixtureContext {
  pipelineId: string;
  outcome: DryRunOutcome;
  reason?: string;
  occurrence: number;
  /** FR IDs extracted from the real project messages, used by planner fixtures. */
  frIdsFromMessages?: string[];
}

/**
 * Extract FR-x.y IDs only from the "Functional Requirements & PRD Documents" section
 * the planner injects into messages. Scoping to that section avoids picking up example
 * IDs that appear in governance/policy text elsewhere in the system prompt.
 */
function extractFrIdsFromMessages(messages: ChatMessage[]): string[] {
  const allText = messages.map((m) => m.content).join("\n");
  // Isolate only the FR section injected by the planner script.
  const sectionMatch = /# Functional Requirements & PRD Documents\n([\s\S]*?)(?=\n# |\s*$)/m.exec(allText);
  const searchText = sectionMatch ? sectionMatch[1] : "";
  const matches = searchText.match(/\bFR-\d+(?:\.\d+)?\b/g) ?? [];
  return [...new Set(matches)];
}

// ─── Per-role default fixtures ──────────────────────────────────────────────

function plannerPhasePlanFixture(ctx: FixtureContext): Record<string, unknown> {
  // Use real FR IDs extracted from the project documents injected into the messages.
  // Falls back to FR-1.1 if somehow none were found.
  const frIds = ctx.frIdsFromMessages && ctx.frIdsFromMessages.length > 0
    ? ctx.frIdsFromMessages.slice(0, 3)
    : ["FR-1.1"];
  return {
    phase_id: "P01",
    name: "Dry-run phase",
    description: "Synthetic phase plan produced by MockLlmProvider.",
    objectives: ["Exercise planner phase-plan flow under dry-run."],
    deliverables: ["Synthetic phase_plan_p01.md artifact."],
    dependencies: [],
    fr_ids_in_scope: frIds,
    required_design_artifacts: [],
    status: "Planning",
  };
}

function plannerSprintFixture(ctx: FixtureContext): Record<string, unknown> {
  return {
    sprint_plan: {
      sprint_id: "S01",
      phase_id: "P01",
      name: "Dry-run sprint",
      goals: ["Validate end-to-end pipeline state machine."],
      tasks: ["S01-001"],
      status: "staged",
    },
    first_task: {
      task_id: "S01-001",
      title: "Dry-run scaffold task",
      description: "Synthetic task produced by MockLlmProvider for workflow validation.",
      acceptance_criteria: ["Stub artifact exists.", "Pipeline state machine advances."],
      estimated_effort: "S",
      files_likely_affected: ["dry-run-stub.txt"],
      status: "pending",
    },
    task_flags: {
      fr_ids_in_scope: ["FR-DRYRUN-001"],
      architecture_contract_change: false,
      ui_evidence_required: false,
      incident_tier: "none",
    },
  };
}

function sprintControllerSetupFixture(ctx: FixtureContext): Record<string, unknown> {
  // Same shape as plannerSprintFixture — sprint-controller's LlmResponse is a superset.
  return plannerSprintFixture(ctx);
}

function verifierFixture(ctx: FixtureContext): Record<string, unknown> {
  const passed = ctx.outcome !== "fail";
  return {
    checks: [
      {
        check_number: 1,
        check_name: "dry-run synthetic gate",
        result: passed ? "PASS" : "FAIL",
        evidence: passed
          ? "Mock provider — synthetic PASS for dry-run."
          : `Mock provider — synthetic FAIL (${ctx.reason ?? "scenario-induced"}).`,
        failure_detail: passed ? null : (ctx.reason ?? "scenario-induced failure"),
      },
    ],
    summary: passed
      ? "Dry-run verifier PASS (synthetic)."
      : `Dry-run verifier FAIL (synthetic): ${ctx.reason ?? "scenario-induced"}.`,
    required_corrections: passed ? [] : [ctx.reason ?? "Address the synthetic failure."],
    handoff: {
      changed_scope: ["dry-run-stub.txt"],
      verification_state: passed ? "pass" : "fail",
      open_risks: [],
      next_role_action: passed ? "none" : "implementer_retry",
      evidence_refs: [],
    },
  };
}

function chatJsonFixture(
  role: string,
  callType: string | undefined,
  ctx: FixtureContext,
  messages: ChatMessage[]
): Record<string, unknown> {
  if (role === "planner" && callType === "phase-plan") {
    ctx.frIdsFromMessages = extractFrIdsFromMessages(messages);
    return plannerPhasePlanFixture(ctx);
  }
  if (role === "planner" && callType === "sprint-plan") return plannerSprintFixture(ctx);
  if (role === "sprint-controller") return sprintControllerSetupFixture(ctx);
  if (role === "verifier") return verifierFixture(ctx);
  // Fallback: empty object — script will likely throw, surfacing the gap.
  logger.warn("MockLlmProvider: no fixture for role/call_type — returning {}", { role, call_type: callType });
  return {};
}

// ─── Provider ───────────────────────────────────────────────────────────────

export class MockLlmProvider implements LlmProvider {
  constructor(private readonly role: string) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const { ctx } = this.resolve(options);
    return JSON.stringify({ mock: true, role: this.role, occurrence: ctx.occurrence });
  }

  async chatJson<T = Record<string, unknown>>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const { ctx, callType, step } = this.resolve(options);
    const base = chatJsonFixture(this.role, callType, ctx, messages);
    const merged = deepMerge(base, step?.fixture_overrides);
    logger.info("MockLlmProvider chatJson", {
      role: this.role,
      call_type: callType,
      occurrence: ctx.occurrence,
      outcome: ctx.outcome,
    });
    return merged as T;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    options: ToolChatOptions = {}
  ): Promise<ToolCallResult> {
    const { ctx, callType } = this.resolve(options);
    logger.info("MockLlmProvider chatWithTools", {
      role: this.role,
      call_type: callType,
      occurrence: ctx.occurrence,
      outcome: ctx.outcome,
    });

    const has = (name: string) => tools.some((t) => t.name === name);
    const calls: ToolCall[] = [];
    let id = 0;
    const seq: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    // Implementer agentic loop: write a stub file, record progress, then finish.
    if (has("write_file")) {
      seq.push({
        name: "write_file",
        arguments: {
          path: "dry-run-stub.txt",
          content: `Dry-run stub file written by MockLlmProvider.\nrole=${this.role}\noccurrence=${ctx.occurrence}\noutcome=${ctx.outcome}\n`,
        },
      });
    }
    if (has("set_progress")) {
      seq.push({
        name: "set_progress",
        arguments: {
          current_focus: "Dry-run synthetic implementation complete.",
          open_todos: [],
          blockers: [],
          planned_next_action: "Hand off to verifier.",
        },
      });
    }
    if (has("finish")) {
      seq.push({
        name: "finish",
        arguments: {
          task_id: "S01-001",
          sprint_id: "S01",
          summary: "Dry-run synthetic implementation by MockLlmProvider.",
          files_changed: JSON.stringify([
            { path: "dry-run-stub.txt", action: "Create", description: "Dry-run stub file." },
          ]),
        },
      });
    }

    for (const c of seq) {
      const toolCall: ToolCall = { id: `mock-${++id}`, name: c.name, arguments: c.arguments };
      calls.push(toolCall);
      try {
        await toolExecutor(toolCall);
      } catch (err) {
        logger.warn("MockLlmProvider tool call rejected by executor", {
          tool: c.name,
          error: String(err),
        });
      }
    }

    return {
      content: "Dry-run implementation complete (synthetic).",
      tool_calls: calls,
      iterations: calls.length || 1,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private resolve(options: ChatOptions | ToolChatOptions): {
    ctx: FixtureContext;
    callType?: string;
    step: ReturnType<typeof dryRunScenarioService.resolve>["step"];
  } {
    const meta = options.meta;
    const pipelineId = meta?.pipeline_id ?? "unknown";
    const callType = meta?.call_type;
    const { step, occurrence } = dryRunScenarioService.resolve({
      pipelineId,
      role: this.role,
      callType,
    });
    const outcome: DryRunOutcome = step?.outcome ?? dryRunScenarioService.current().default_outcome ?? "pass";
    if (outcome === "throw") {
      const code = step?.error?.code ?? "DRY_RUN_THROW";
      const msg = step?.error?.message ?? "Dry-run scenario forced an exception.";
      throw new Error(`[${code}] ${msg}`);
    }
    return {
      ctx: { pipelineId, outcome, reason: step?.reason, occurrence },
      callType,
      step,
    };
  }
}
