export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string; // present when role = "tool"
  name?: string;         // present when role = "tool"
}

export interface LlmCallMeta {
  /** Logical role making the call (e.g. "implementer", "verifier"). */
  role?: string;
  /** Pipeline run id for token aggregation. */
  pipeline_id?: string;
  /** Optional sub-run id within the pipeline (e.g. retry attempt). */
  run_id?: string;
  /** Free-form description for telemetry filtering (e.g. "governance-checks"). */
  call_type?: string;
}

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  /**
   * Phase 10 (ADR-033): when set, the provider issues
   * `response_format: { type: "json_schema", ... }` with strict mode so the
   * server rejects malformed responses at the API layer.
   */
  output_schema?: Record<string, unknown>;
  /** Phase 11 (ADR-033): metadata propagated through to telemetry. */
  meta?: LlmCallMeta;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export interface ToolParameterSchema {
  type: string;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  description?: string;
}

export interface ToolPropertySchema {
  type: string;
  description?: string;
  /** When `type === "array"`, describes the element schema. */
  items?: { type: string; description?: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

// ─── Tool call result (from LLM) ──────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  /** Final text response from LLM after all tool calls are resolved */
  content: string;
  /** All tool calls made during the loop, in order */
  tool_calls: ToolCall[];
  /** Number of iterations in the tool-call loop */
  iterations: number;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface LlmProvider {
  /**
   * Send a chat completion request and return the raw string response.
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /**
   * Send a chat completion request and parse the response as JSON.
   * The provider is responsible for requesting JSON output format.
   */
  chatJson<T = Record<string, unknown>>(messages: ChatMessage[], options?: ChatOptions): Promise<T>;

  /**
   * Run an agentic tool-call loop. The provider sends messages + tool definitions,
   * executes tool calls returned by the LLM via the provided executor, and continues
   * until the LLM produces a final non-tool response or the iteration limit is reached.
   */
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor,
    options?: ToolChatOptions
  ): Promise<ToolCallResult>;
}

export interface ToolExecutor {
  (toolCall: ToolCall): Promise<string>;
}

export interface ToolChatOptions extends ChatOptions {
  /** Maximum number of tool-call iterations before giving up. Default: 10 */
  maxIterations?: number;
  /**
   * How many times to nudge the LLM back into tool use when it produces a text
   * response instead of a tool call (end_turn with no tool calls). Each nudge
   * injects a user message reminding the model to call a tool. Default: 2.
   * Set to 0 to disable and preserve the old break-immediately behaviour.
   */
  maxTextNudges?: number;
}
