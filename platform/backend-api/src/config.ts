import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  n8nCallbackUrl: process.env.N8N_CALLBACK_URL ?? "",
  n8nWebhookPath: process.env.N8N_WEBHOOK_PATH ?? "/webhook/pipeline-notify",
  azureOpenAiEndpoint: process.env.AZURE_OPENAI_ENDPOINT ?? "",
  azureOpenAiApiKey: process.env.AZURE_OPENAI_API_KEY ?? "",
  azureOpenAiDeployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4.1",
  // Local dir or Azure Files mount path for pipeline artifacts
  artifactBasePath: process.env.ARTIFACT_BASE_PATH ?? "./artifacts",
  // Governance content directory — bundled at /app/governance/ in container (ADR-025)
  // For local development: set GOVERNANCE_PATH=../governance (relative to platform/backend-api/)
  governancePath: process.env.GOVERNANCE_PATH ?? "./governance",
  // Git sync (ADR-011) — Execution Service owns all git operations
  gitRepoUrl: process.env.GIT_REPO_URL ?? "",
  gitPat: process.env.GIT_PAT ?? "",
  // Path where repo is cloned; on Azure Files mount this is /mnt/repo
  gitClonePath: process.env.GIT_CLONE_PATH ?? "/mnt/repo",
  // API authentication — required in all non-development environments
  apiKey: process.env.API_KEY ?? "",
  // LLM providers (ADR-029) — OpenAI-compatible (Azure OpenAI, OpenAI, GitHub Models)
  llmOpenAiCompatEndpoint: process.env.LLM_OPENAI_COMPAT_ENDPOINT ?? process.env.AZURE_OPENAI_ENDPOINT ?? "",
  llmOpenAiCompatApiKey: process.env.LLM_OPENAI_COMPAT_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? "",
  llmOpenAiCompatDeployment: process.env.LLM_OPENAI_COMPAT_DEPLOYMENT ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4.1",
  // LLM providers — Anthropic (Claude)
  llmAnthropicApiKey: process.env.LLM_ANTHROPIC_API_KEY ?? "",
  // GitHub API integration (ADR-030)
  githubToken: process.env.GITHUB_TOKEN ?? process.env.GIT_PAT ?? "",
  githubApiBaseUrl: process.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
  // GitHub Models (LLM via Copilot subscription) — uses GIT_PAT by default
  llmGitHubModelsApiKey: process.env.LLM_GITHUB_MODELS_API_KEY ?? process.env.GIT_PAT ?? "",
};
