# ADR-029: LLM Provider Abstraction

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

All role scripts currently call `azureOpenAiService` directly — a thin fetch-based client hardcoded to the Azure OpenAI REST API format. This was expedient for initial development but creates three problems as the platform matures toward autonomous sprint execution (ADR-030):

**1. Vendor lock-in without justification**
Azure OpenAI was used for testing, not by deliberate architectural choice. Different LLM providers offer meaningfully different capabilities, cost profiles, and rate limits. There is no architectural reason to fix the platform to one provider.

**2. One-size model selection**
All roles currently use the same deployment and the same temperature. The cognitive demands across roles are fundamentally different:

| Role | Cognitive demand | Optimal model profile |
|---|---|---|
| Planner | Strategic reasoning, long context | Capable reasoning model |
| Sprint Controller | Structured decomposition, strict JSON output | Reliable structured-output model |
| Implementer | Code generation, multi-file coherence, tool use | Strong code model with tool-calling |
| Verifier | Tool execution + failure analysis | Deterministic; tool execution may replace LLM entirely |
| Fixer | Code correction under constraint | Same profile as Implementer |

Using a single large model for all roles wastes cost on simple tasks and under-powers complex ones.

**3. No path to agentic tool-calling**
The current service returns raw string completions. Agentic roles (Implementer, Fixer) require tool-calling — the ability for the LLM to invoke file-read, file-write, and shell-execution tools in an iterative loop. The existing interface cannot support this pattern.

---

## Decision

The Execution Service SHALL implement a **vendor-neutral LLM Provider Abstraction**.

### Core Interface

All role scripts SHALL interact with LLMs exclusively through a provider-neutral interface:

```typescript
interface LlmProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  chatJson<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T>;
  chatWithTools(messages: ChatMessage[], tools: ToolDefinition[], options?: ChatOptions): Promise<ToolCallResult>;
}
```

The `chatWithTools` method supports agentic roles that require iterative tool execution. Each provider implementation handles the vendor-specific protocol (OpenAI function-calling format, Anthropic tool-use format, etc.) and normalizes it to the common interface.

### Provider Implementations

Concrete provider implementations SHALL be registered behind the interface. Initial implementations:

- **OpenAI-compatible** — covers OpenAI, Azure OpenAI, GitHub Models, and local Ollama; uses the `/chat/completions` REST format with parameterized endpoint, key, and deployment
- **Anthropic** — uses the Anthropic Messages API; a thin adapter translates tool-use format and message roles to the common interface

New providers are added by implementing the interface and registering with the factory. No role script changes are required.

### Per-Role Model Configuration

Each role SHALL declare its preferred provider and model in the governance manifest (`platform/governance/manifest.json`). The LLM factory resolves the concrete provider and model at execution time:

```json
{
  "llm_roles": {
    "planner":           { "provider": "openai-compat", "model": "o3",              "temperature": 0.3 },
    "sprint-controller": { "provider": "openai-compat", "model": "gpt-4o",          "temperature": 0.1 },
    "implementer":       { "provider": "anthropic",     "model": "claude-opus-4-5", "temperature": 0.2 },
    "verifier":          { "provider": "openai-compat", "model": "gpt-4o-mini",     "temperature": 0.0 },
    "fixer":             { "provider": "anthropic",     "model": "claude-opus-4-5", "temperature": 0.2 }
  }
}
```

This configuration is version-controlled in Git (ADR-001) and loaded at runtime by the governance service (ADR-025). Role scripts do not hardcode provider or model references.

Credentials are supplied via environment variables — never in the manifest:

```
LLM_OPENAI_COMPAT_ENDPOINT   — base URL for OpenAI-compatible endpoint
LLM_OPENAI_COMPAT_API_KEY    — API key for OpenAI-compatible endpoint
LLM_OPENAI_COMPAT_DEPLOYMENT — deployment/model name (Azure) or model (OpenAI)
LLM_ANTHROPIC_API_KEY        — Anthropic API key
```

If a role's preferred provider is not configured, the factory falls back to any available configured provider. If no provider is configured, the execution fails with a clear error — there is no silent degradation.

### Tool-Calling Contract

For agentic roles (Implementer, Fixer), the provider interface supports a **tool-call loop**:

1. Role script sends initial prompt plus a declared tool set to the LLM
2. LLM responds with one or more tool invocations (read file, write file, run command)
3. Execution Service executes each requested tool within governed constraints
4. Tool results are returned to the LLM as tool-response messages
5. Loop continues until the LLM emits a final non-tool response or the iteration limit is reached

The tool set available to each agentic role is defined in governance and constrained to safe, auditable operations. The LLM cannot invoke arbitrary system commands (ADR-003, ADR-018).

---

## Core Principle

> Role scripts express intent.  
> The LLM factory resolves the right intelligence for the task.  
> No role script knows which vendor is answering.

---

## Migration

The existing `azureOpenAiService` is superseded by the provider abstraction. All `azureOpenAiService` call sites in role scripts SHALL be migrated to call the LLM factory. Azure OpenAI continues to work as an `openai-compat` provider; no existing configuration is lost.

---

## Consequences

### Positive

- Provider and model selection is governed configuration, not code — swappable without deployment
- Agentic tool-calling is a first-class capability of the abstraction layer
- Cost optimization: fast cheap models for structured tasks; capable models for code generation
- Adding a new LLM provider requires no changes to role scripts

### Negative

- Migration cost: all `azureOpenAiService` call sites must be updated to the factory interface
- Tool-calling protocols differ by vendor; adapter normalization adds implementation complexity

### Neutral

- Azure OpenAI remains a valid provider via `openai-compat`; existing environment variables continue to function after remapping

---

## Related ADRs

- ADR-003: Deterministic Over LLM
- ADR-008: Structured LLM Outputs
- ADR-009: Execution Service
- ADR-017: Script Registry Execution Model
- ADR-018: Execution Determinism
- ADR-025: Two-Tier Governance Composition Model
- ADR-030: Autonomous Sprint Execution with PR-Gated Human Review
