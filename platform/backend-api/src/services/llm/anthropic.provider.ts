import { setTimeout as delay } from "timers/promises";
import { logger } from "../logger.service";
import {
  ChatMessage,
  ChatOptions,
  LlmProvider,
  ToolCall,
  ToolChatOptions,
  ToolCallResult,
  ToolDefinition,
  ToolExecutor,
} from "./llm-provider.interface";

// ─── Anthropic wire types ─────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic (Claude) LLM provider.
 * Uses the Anthropic Messages API.
 * Credentials sourced from: LLM_ANTHROPIC_API_KEY.
 */
export class AnthropicProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiVersion = "2023-06-01";
  private readonly telemetryEnabled = (process.env.LLM_TELEMETRY_ENABLED ?? "true") !== "false";
  private readonly traceEnabled = (process.env.LLM_TRACE_ENABLED ?? "false") === "true";
  private readonly traceMaxChars = Number(process.env.LLM_TRACE_MAX_CHARS ?? 6000);

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const { system, anthropicMessages } = this.convertMessages(messages);
    const body = this.buildBody(anthropicMessages, { system, options });
    const data = await this.post(body);
    this.logTelemetry("chat", body, data);
    const textBlock = data.content.find((b) => b.type === "text");
    const content = textBlock?.text ?? "";
    if (!content) throw new Error("Anthropic provider returned an empty response");
    logger.info("LLM chat complete", { provider: "anthropic", model: this.model, messages_count: messages.length });
    return content;
  }

  async chatJson<T = Record<string, unknown>>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    // Anthropic doesn't have a json_object mode — instruct via system prompt addition
    const augmented: ChatMessage[] = [
      ...messages.slice(0, 1).map((m) =>
        m.role === "system" ? { ...m, content: m.content + "\n\nIMPORTANT: Respond with valid JSON only. No markdown fences." } : m
      ),
      ...messages.slice(1),
    ];
    const content = await this.chat(augmented, options);
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    logger.info("LLM chatJson complete", { provider: "anthropic", model: this.model });
    return JSON.parse(cleaned) as T;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    options: ToolChatOptions = {}
  ): Promise<ToolCallResult> {
    const maxIterations = options.maxIterations ?? 10;
    const allToolCalls: ToolCall[] = [];
    const { system, anthropicMessages } = this.convertMessages(messages);
    const history: AnthropicMessage[] = [...anthropicMessages];
    let iterations = 0;

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    while (iterations < maxIterations) {
      iterations++;

      const body = this.buildBody(history, { system, options, tools: anthropicTools });
      const data = await this.post(body);
      this.logTelemetry("chatWithTools", body, data);

      // Collect tool-use blocks and text blocks
      const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
      const textBlock = data.content.find((b) => b.type === "text");

      // Push assistant turn into history
      history.push({ role: "assistant", content: data.content });

      // No tool calls — done
      if (data.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
        return {
          content: textBlock?.text ?? "",
          tool_calls: allToolCalls,
          iterations,
        };
      }

      // Execute tool calls and build user tool-result turn
      const toolResults: AnthropicContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const toolCall: ToolCall = {
          id: block.id!,
          name: block.name!,
          arguments: block.input ?? {},
        };
        allToolCalls.push(toolCall);

        logger.info("LLM tool call", { provider: "anthropic", tool: block.name, iteration: iterations });

        const result = await toolExecutor(toolCall);

        toolResults.push({
          type: "tool_result" as "text", // cast: Anthropic tool_result is valid but not in our minimal type
          tool_use_id: block.id,
          content: result,
        } as unknown as AnthropicContentBlock);
      }

      history.push({ role: "user", content: toolResults });
    }

    throw new Error(`LLM tool-call loop exceeded max iterations (${maxIterations})`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private convertMessages(messages: ChatMessage[]): {
    system: string | undefined;
    anthropicMessages: AnthropicMessage[];
  } {
    let system: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        system = m.content;
      } else if (m.role === "user" || m.role === "assistant") {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
      // tool messages are handled inline during chatWithTools
    }

    return { system, anthropicMessages };
  }

  private buildBody(
    messages: AnthropicMessage[],
    opts: { system?: string; options?: ChatOptions; tools?: unknown[] }
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.options?.max_tokens ?? 4096,
      temperature: opts.options?.temperature ?? 0.2,
      messages,
    };
    if (opts.system) body.system = opts.system;
    if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;
    return body;
  }

  private async post(body: Record<string, unknown>): Promise<AnthropicResponse> {
    const maxAttempts = Number(process.env.LLM_ANTHROPIC_MAX_ATTEMPTS ?? 3);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": this.apiVersion,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });

      if (response.ok) {
        return response.json() as Promise<AnthropicResponse>;
      }

      const text = await response.text();
      if (response.status === 429 && attempt < maxAttempts) {
        const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "0");
        // Reset headers are ISO 8601 timestamps, not seconds — parse as Date
        const now = Date.now();
        const inputResetHeader = response.headers.get("anthropic-ratelimit-input-tokens-reset");
        const outputResetHeader = response.headers.get("anthropic-ratelimit-output-tokens-reset");
        const inputResetMs = inputResetHeader ? Math.max(0, new Date(inputResetHeader).getTime() - now) : 0;
        const outputResetMs = outputResetHeader ? Math.max(0, new Date(outputResetHeader).getTime() - now) : 0;
        const resetMs = Math.max(retryAfterSeconds * 1000, inputResetMs, outputResetMs, 5_000);

        logger.info("Anthropic rate limited, retrying", {
          model: this.model,
          attempt,
          next_attempt_in_ms: resetMs,
        });

        await delay(resetMs);
        continue;
      }

      throw new Error(`Anthropic error ${response.status}: ${text.slice(0, 500)}`);
    }

    throw new Error(`Anthropic retry loop exhausted for model ${this.model}`);
  }

  private logTelemetry(kind: "chat" | "chatWithTools", requestBody: Record<string, unknown>, responseBody: AnthropicResponse): void {
    if (!this.telemetryEnabled) return;

    const usage = responseBody.usage;
    logger.info("LLM usage", {
      provider: "anthropic",
      model: this.model,
      kind,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      total_tokens:
        (usage?.input_tokens ?? 0) +
        (usage?.output_tokens ?? 0) +
        (usage?.cache_creation_input_tokens ?? 0) +
        (usage?.cache_read_input_tokens ?? 0),
      cache_creation_input_tokens: usage?.cache_creation_input_tokens,
      cache_read_input_tokens: usage?.cache_read_input_tokens,
    });

    if (!this.traceEnabled) return;

    logger.info("LLM trace", {
      provider: "anthropic",
      model: this.model,
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
