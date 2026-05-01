import fs from "fs";
import path from "path";
import { logger } from "../logger.service";
import { DryRunScenario, DryRunStep, DryRunStepMatch } from "./dry-run-scenario.types";

const DEFAULT_SCENARIO: DryRunScenario = {
  name: "happy-path-default",
  description: "Built-in fallback when no DRY_RUN_SCENARIO_PATH is set. All roles PASS.",
  default_outcome: "pass",
  steps: [],
};

/**
 * Loads the active dry-run scenario from disk and resolves which step (if any)
 * applies to a given LLM invocation. Tracks per-(pipeline_id, role, call_type)
 * occurrence counters so a scenario can target "verifier 2nd run = FAIL"
 * across the implementer-retry loop without confusing different pipelines.
 *
 * Per-execution overrides supplied via ExecutionRequestEnvelope.metadata.dry_run_directives
 * are merged onto the loaded scenario for the lifetime of that execution_id.
 */
class DryRunScenarioService {
  private scenario: DryRunScenario = DEFAULT_SCENARIO;
  private occurrences = new Map<string, number>();
  private pipelineOverrides = new Map<string, DryRunStep[]>();

  load(filePath?: string): void {
    if (!filePath) {
      this.scenario = DEFAULT_SCENARIO;
      logger.info("dry-run scenario: using built-in happy-path-default");
      return;
    }
    try {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
      const raw = fs.readFileSync(abs, "utf-8");
      const parsed = JSON.parse(raw) as DryRunScenario;
      if (!parsed.name) throw new Error("scenario missing required 'name' field");
      this.scenario = parsed;
      logger.info("dry-run scenario loaded", { path: abs, name: parsed.name, steps: parsed.steps?.length ?? 0 });
    } catch (err) {
      logger.error("dry-run scenario load failed — falling back to happy-path-default", {
        path: filePath,
        error: String(err),
      });
      this.scenario = DEFAULT_SCENARIO;
    }
  }

  current(): DryRunScenario {
    return this.scenario;
  }

  /** Register per-pipeline directive overrides; merged on top of the loaded scenario for matches. */
  registerPipelineDirectives(pipelineId: string, directives: unknown): void {
    if (!pipelineId || !directives || typeof directives !== "object") return;
    const steps = (directives as { steps?: DryRunStep[] }).steps;
    if (Array.isArray(steps) && steps.length > 0) {
      this.pipelineOverrides.set(pipelineId, steps);
      logger.info("dry-run: per-pipeline directives registered", { pipeline_id: pipelineId, steps: steps.length });
    }
  }

  clearPipeline(pipelineId: string): void {
    this.pipelineOverrides.delete(pipelineId);
  }

  /**
   * Resolve the matching step for an invocation. Returns null if no step matches.
   *
   * Override precedence: per-pipeline directives → scenario.steps. First match wins.
   */
  resolve(args: {
    pipelineId: string;
    role: string;
    callType?: string;
  }): { step: DryRunStep | null; occurrence: number } {
    const key = `${args.pipelineId}::${args.role}::${args.callType ?? ""}`;
    const occurrence = (this.occurrences.get(key) ?? 0) + 1;
    this.occurrences.set(key, occurrence);

    const target: DryRunStepMatch = { role: args.role, call_type: args.callType, occurrence };
    const overrideSteps = this.pipelineOverrides.get(args.pipelineId) ?? [];

    const match = (step: DryRunStep): boolean => {
      const m = step.match;
      if (m.role !== target.role) return false;
      if (m.call_type !== undefined && m.call_type !== target.call_type) return false;
      if (m.occurrence !== undefined && m.occurrence !== target.occurrence) return false;
      return true;
    };

    const found = overrideSteps.find(match) ?? this.scenario.steps?.find(match) ?? null;
    return { step: found, occurrence };
  }

  /** For diagnostics endpoint. */
  snapshot(): { name: string; default_outcome: string; occurrence_counts: Record<string, number> } {
    return {
      name: this.scenario.name,
      default_outcome: this.scenario.default_outcome ?? "pass",
      occurrence_counts: Object.fromEntries(this.occurrences),
    };
  }
}

export const dryRunScenarioService = new DryRunScenarioService();
