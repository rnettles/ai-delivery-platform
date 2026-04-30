import { logger } from "../logger.service";

/**
 * Aggregates per-run LLM token usage across multiple chat calls.
 *
 * Phase 11 (ADR-033): emit `llm_call` per call and `llm_run_total` when the
 * caller finalises a run. Aggregations are keyed by `pipeline_id + run_id`.
 */

export interface TokenMeterRecord {
  role?: string;
  pipeline_id?: string;
  run_id?: string;
  call_type?: string;
  iteration?: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  provider: string;
  deployment?: string;
}

interface RunTotals {
  pipeline_id?: string;
  run_id?: string;
  role?: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

class TokenMeter {
  private runs = new Map<string, RunTotals>();

  /** Record a single LLM call. */
  record(rec: TokenMeterRecord): void {
    const key = this.runKey(rec.pipeline_id, rec.run_id);

    logger.info("llm_call", {
      role: rec.role,
      pipeline_id: rec.pipeline_id,
      run_id: rec.run_id,
      call_type: rec.call_type,
      iteration: rec.iteration,
      prompt_tokens: rec.prompt_tokens,
      completion_tokens: rec.completion_tokens,
      total_tokens: rec.total_tokens,
      provider: rec.provider,
      deployment: rec.deployment,
    });

    if (!key) return; // no aggregation key — skip per-run totals

    const cur = this.runs.get(key) ?? {
      pipeline_id: rec.pipeline_id,
      run_id: rec.run_id,
      role: rec.role,
      calls: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    cur.calls += 1;
    cur.prompt_tokens += rec.prompt_tokens;
    cur.completion_tokens += rec.completion_tokens;
    cur.total_tokens += rec.total_tokens;
    this.runs.set(key, cur);
  }

  /** Get current totals for a run (does not clear). */
  getTotals(pipelineId?: string, runId?: string): RunTotals | undefined {
    const key = this.runKey(pipelineId, runId);
    if (!key) return undefined;
    return this.runs.get(key);
  }

  /** Emit `llm_run_total` and clear the run aggregate. Call after a role finishes. */
  finalize(pipelineId?: string, runId?: string): RunTotals | undefined {
    const key = this.runKey(pipelineId, runId);
    if (!key) return undefined;
    const totals = this.runs.get(key);
    if (!totals) return undefined;
    logger.info("llm_run_total", { ...totals });
    this.runs.delete(key);
    return totals;
  }

  private runKey(pipelineId?: string, runId?: string): string | null {
    if (!pipelineId && !runId) return null;
    return `${pipelineId ?? ""}::${runId ?? ""}`;
  }
}

export const tokenMeter = new TokenMeter();
