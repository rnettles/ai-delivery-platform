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
 * GitHub Models LLM provider.
 *
 * GitHub Models uses the OpenAI chat completions wire format but at a different
 * endpoint and with the model name in the request body (not the URL path).
 *
 * Endpoint: https://models.inference.ai.azure.com/chat/completions
 * Auth:     Bearer <GitHub PAT with models:read scope>
 * Credentials: LLM_GITHUB_MODELS_API_KEY (falls back to GIT_PAT)
 *
 * Available models (via GitHub Copilot subscription, subject to change):
 *   claude-sonnet-4-5, gpt-4o, gpt-4o-mini, meta-llama-3.1-405b-instruct, etc.
 */
export class GitHubModelsProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint = "https://models.inference.ai.azure.com/chat/completions";

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body = this.buildBody(messages, { options });
    const data = await this.post(body);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("GitHub Models provider returned an empty response");
    logger.info("LLM chat complete", { provider: "github-models", model: this.model, messages_count: messages.length });
    return content;
  }

  async chatJson<T = Record<string, unknown>>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const body = this.buildBody(messages, { options, responseFormat: "json_object" });
    const data = await this.post(body);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("GitHub Models provider returned an empty response");
    logger.info("LLM chatJson complete", { provider: "github-models", model: this.model });
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

      const body = this.buildBody(history, {
        options,
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      });

      const data = await this.post(body);
      const choice = data.choices?.[0];
      if (!choice) throw new Error("GitHub Models provider returned no choices");

      const assistantMsg = choice.message;

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

        logger.info("LLM tool call", { provider: "github-models", tool: tc.function.name, iteration: iterations });

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

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private buildBody(
    messages: ChatMessage[],
    opts: { options?: ChatOptions; responseFormat?: string; tools?: unknown[] }
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.options?.temperature ?? 0.2,
      max_tokens: opts.options?.max_tokens ?? 4096,
    };
    if (opts.responseFormat) {
      body.response_format = { type: opts.responseFormat };
    }
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }
    return body;
  }

  private async post(body: Record<string, unknown>): Promise<OpenAiCompletionResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub Models error ${response.status}: ${text.slice(0, 500)}`);
    }

    return response.json() as Promise<OpenAiCompletionResponse>;
  }
}
