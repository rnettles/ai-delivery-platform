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

interface OpenAiCompletionResponse {
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
      response_format: { type: "json_object" },
    };
    const data = await this.post(body);
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

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI-compat error ${response.status}: ${text.slice(0, 500)}`);
    }

    return response.json() as Promise<OpenAiCompletionResponse>;
  }
}
