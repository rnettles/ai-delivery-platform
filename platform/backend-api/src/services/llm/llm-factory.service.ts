import { config } from "../../config";
import { governanceService } from "../governance.service";
import { logger } from "../logger.service";
import { AnthropicProvider } from "./anthropic.provider";
import { LlmProvider } from "./llm-provider.interface";
import { OpenAiCompatProvider } from "./openai-compat.provider";

type ProviderName = "openai-compat" | "anthropic";

interface LlmRoleConfig {
  provider: ProviderName;
  model: string;
  temperature?: number;
}

/**
 * Resolves the correct LLM provider for a given role.
 *
 * Resolution order:
 * 1. Read llm_roles from the governance manifest (ADR-029)
 * 2. Instantiate the named provider using env-var credentials
 * 3. If the named provider is unconfigured, fall back to any available provider
 * 4. If no provider is configured, throw — no silent degradation
 */
class LlmFactory {
  // Cache instantiated providers keyed by "name:model"
  private cache = new Map<string, LlmProvider>();

  /**
   * Returns an LlmProvider configured for the given pipeline role.
   * The returned provider's chatJson/chat/chatWithTools methods already have
   * temperature baked in via the role config — callers may override via options.
   */
  async forRole(role: string): Promise<LlmProvider> {
    const roleConfig = await this.resolveRoleConfig(role);
    return this.instantiate(roleConfig);
  }

  /**
   * Returns an LlmProvider by explicit provider name + model.
   * Use when you need a provider outside the role-config system.
   */
  forProvider(name: ProviderName, model: string): LlmProvider {
    return this.instantiate({ provider: name, model });
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async resolveRoleConfig(role: string): Promise<LlmRoleConfig> {
    try {
      const manifest = await governanceService.getManifest();
      const llmRoles = (manifest as Record<string, unknown>).llm_roles as Record<string, LlmRoleConfig> | undefined;
      if (llmRoles?.[role]) {
        return llmRoles[role];
      }
    } catch (err) {
      logger.info("LLM factory: could not read llm_roles from manifest, using fallback", { role, error: String(err) });
    }

    // Fallback: pick any configured provider
    return this.fallbackConfig(role);
  }

  private fallbackConfig(role: string): LlmRoleConfig {
    if (config.llmOpenAiCompatEndpoint && config.llmOpenAiCompatApiKey) {
      logger.info("LLM factory: using openai-compat fallback", { role });
      return { provider: "openai-compat", model: config.llmOpenAiCompatDeployment || "gpt-4o" };
    }
    if (config.llmAnthropicApiKey) {
      logger.info("LLM factory: using anthropic fallback", { role });
      return { provider: "anthropic", model: "claude-opus-4-5" };
    }
    throw new Error(
      `LLM factory: no provider configured for role '${role}'. ` +
      "Set LLM_OPENAI_COMPAT_ENDPOINT + LLM_OPENAI_COMPAT_API_KEY or LLM_ANTHROPIC_API_KEY."
    );
  }

  private instantiate(roleConfig: LlmRoleConfig): LlmProvider {
    const cacheKey = `${roleConfig.provider}:${roleConfig.model}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let provider: LlmProvider;

    switch (roleConfig.provider) {
      case "openai-compat": {
        const endpoint = config.llmOpenAiCompatEndpoint;
        const apiKey = config.llmOpenAiCompatApiKey;
        const deployment = roleConfig.model || config.llmOpenAiCompatDeployment;
        if (!endpoint || !apiKey) {
          throw new Error("LLM factory: openai-compat requires LLM_OPENAI_COMPAT_ENDPOINT and LLM_OPENAI_COMPAT_API_KEY");
        }
        provider = new OpenAiCompatProvider(endpoint, apiKey, deployment);
        break;
      }
      case "anthropic": {
        const apiKey = config.llmAnthropicApiKey;
        if (!apiKey) {
          throw new Error("LLM factory: anthropic requires LLM_ANTHROPIC_API_KEY");
        }
        provider = new AnthropicProvider(apiKey, roleConfig.model);
        break;
      }
      default: {
        throw new Error(`LLM factory: unknown provider '${(roleConfig as LlmRoleConfig).provider}'`);
      }
    }

    this.cache.set(cacheKey, provider);
    return provider;
  }
}

export const llmFactory = new LlmFactory();
