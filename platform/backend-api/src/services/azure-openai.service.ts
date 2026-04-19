import { config } from "../config";
import { logger } from "./logger.service";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
}

interface AzureCompletionResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

/**
 * Thin fetch-based client for Azure OpenAI.
 * No external SDK dependency — uses the REST API directly.
 */
export class AzureOpenAiService {
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const endpoint = config.azureOpenAiEndpoint.replace(/\/$/, "");
    const deployment = config.azureOpenAiDeployment;
    const apiKey = config.azureOpenAiApiKey;

    if (!endpoint || !apiKey) {
      throw new Error(
        "Azure OpenAI is not configured — set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY"
      );
    }

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;

    const body = {
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens ?? 4096,
      response_format: { type: "json_object" },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Azure OpenAI error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = (await response.json()) as AzureCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Azure OpenAI returned an empty response");
    }

    logger.info("Azure OpenAI call completed", {
      deployment,
      messages_count: messages.length,
      response_length: content.length,
    });

    return content;
  }

  async chatJson<T = Record<string, unknown>>(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<T> {
    const raw = await this.chat(messages, options);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Azure OpenAI returned invalid JSON: ${raw.slice(0, 300)}`);
    }
  }
}

export const azureOpenAiService = new AzureOpenAiService();
