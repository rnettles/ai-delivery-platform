import { logger } from "../logger.service";
import {
  ChatMessage,
  ChatOptions,
  LlmCallMeta,
  LlmProvider,
  ToolCall,
  ToolChatOptions,
  ToolCallResult,
  ToolDefinition,
  ToolExecutor,
} from "./llm-provider.interface";
import { tokenMeter } from "./token-meter.service";

interface OpenAiCompletionResponse {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

/**
 * OpenAI-compatible LLM provider.
 * Works with: Azure OpenAI, OpenAI, GitHub Models, and Ollama.
 * Credentials sourced from: LLM_OPENAI_COMPAT_ENDPOINT, LLM_OPENAI_COMPAT_API_KEY,
 * LLM_OPENAI_COMPAT_DEPLOYMENT.
 */
export class OpenAiCompatProvider implements LlmProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly deployment: string;
  private readonly telemetryEnabled = (process.env.LLM_TELEMETRY_ENABLED ?? "true") !== "false";
  private readonly traceEnabled = (process.env.LLM_TRACE_ENABLED ?? "false") === "true";
  private readonly traceMaxChars = Number(process.env.LLM_TRACE_MAX_CHARS ?? 6000);

  constructor(endpoint: string, apiKey: string, deployment: string) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.deployment = deployment;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens ?? 4096,
    };
    const data = await this.post(body);
    this.logTelemetry("chat", body, data, options.meta);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI-compat provider returned an empty response");
    logger.info("LLM chat complete", { provider: "openai-compat", deployment: this.deployment, messages_count: messages.length });
    return content;
  }

  async chatJson<T = Record<string, unknown>>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const body: Record<string, unknown> = {
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens ?? 4096,
      response_format: options.output_schema
        ? {
            type: "json_schema",
            json_schema: { strict: true, name: "response", schema: options.output_schema },
          }
        : { type: "json_object" },
    };
    const data = await this.post(body);
    this.logTelemetry("chatJson", body, data, options.meta);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI-compat provider returned an empty response");
    logger.info("LLM chatJson complete", { provider: "openai-compat", deployment: this.deployment });
    return JSON.parse(content) as T;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    options: ToolChatOptions = {}
  ): Promise<ToolCallResult> {
    const maxIterations = options.maxIterations ?? 10;
    const allToolCalls: ToolCall[] = [];
    const history: ChatMessage[] = [...messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const body: Record<string, unknown> = {
        messages: history,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.max_tokens ?? 4096,
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
      };

      const data = await this.post(body);
      this.logTelemetry("chatWithTools", body, data, options.meta, iterations);
      const choice = data.choices?.[0];
      if (!choice) throw new Error("OpenAI-compat provider returned no choices");

      const assistantMsg = choice.message;

      // Push assistant message into history
      history.push({
        role: "assistant",
        content: assistantMsg.content ?? "",
        ...(assistantMsg.tool_calls ? { tool_calls: assistantMsg.tool_calls } as unknown as object : {}),
      });

      // No tool calls — LLM is done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        return {
          content: assistantMsg.content ?? "",
          tool_calls: allToolCalls,
          iterations,
        };
      }

      // Execute all tool calls from this turn
      for (const tc of assistantMsg.tool_calls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        const toolCall: ToolCall = { id: tc.id, name: tc.function.name, arguments: args };
        allToolCalls.push(toolCall);

        logger.info("LLM tool call", { provider: "openai-compat", tool: tc.function.name, iteration: iterations });

        const result = await toolExecutor(toolCall);

        history.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result,
        });
      }
    }

    throw new Error(`LLM tool-call loop exceeded max iterations (${maxIterations})`);
  }

  private async post(body: Record<string, unknown>): Promise<OpenAiCompletionResponse> {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=2024-08-01-preview`;
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 2000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (response.ok) {
        return response.json() as Promise<OpenAiCompletionResponse>;
      }

      const text = await response.text();

      // Retry on 429 (rate limit) and 5xx (transient server errors) with exponential backoff + jitter
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        // Honour Retry-After header if present (value is seconds)
        const retryAfterSec = Number(response.headers.get("retry-after") ?? 0);
        const backoff = retryAfterSec > 0
          ? retryAfterSec * 1000
          : BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
        logger.warn(`OpenAI-compat ${response.status} — retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`, {
          provider: "openai-compat",
          status: response.status,
          attempt: attempt + 1,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw new Error(`OpenAI-compat error ${response.status}: ${text.slice(0, 500)}`);
    }

    throw new Error(`OpenAI-compat error: exceeded ${MAX_RETRIES} retries`);
  }

  private logTelemetry(
    kind: "chat" | "chatJson" | "chatWithTools",
    requestBody: Record<string, unknown>,
    responseBody: OpenAiCompletionResponse,
    meta?: LlmCallMeta,
    iteration?: number
  ): void {
    if (!this.telemetryEnabled) return;

    const usage = responseBody.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

    logger.info("LLM usage", {
      provider: "openai-compat",
      deployment: this.deployment,
      kind,
      input_tokens: promptTokens,
      output_tokens: completionTokens,
      total_tokens: totalTokens,
      role: meta?.role,
      pipeline_id: meta?.pipeline_id,
      run_id: meta?.run_id,
      call_type: meta?.call_type ?? kind,
      iteration,
    });

    // Phase 11: aggregate per-run usage. tokenMeter.record() will silently skip
    // aggregation if neither pipeline_id nor run_id is provided.
    tokenMeter.record({
      provider: "openai-compat",
      deployment: this.deployment,
      role: meta?.role,
      pipeline_id: meta?.pipeline_id,
      run_id: meta?.run_id,
      call_type: meta?.call_type ?? kind,
      iteration,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    });

    if (!this.traceEnabled) return;

    logger.info("LLM trace", {
      provider: "openai-compat",
      deployment: this.deployment,
      kind,
      request_preview: this.truncate(JSON.stringify(requestBody)),
      response_preview: this.truncate(JSON.stringify(responseBody)),
    });
  }

  private truncate(value: string): string {
    if (value.length <= this.traceMaxChars) return value;
    return `${value.slice(0, this.traceMaxChars)}...[truncated]`;
  }
}
