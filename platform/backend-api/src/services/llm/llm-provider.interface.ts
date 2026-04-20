export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string; // present when role = "tool"
  name?: string;         // present when role = "tool"
}

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export interface ToolParameterSchema {
  type: string;
  properties?: Record<string, { type: string; description?: string }>;
  required?: string[];
  description?: string;
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
}
