import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

function cleanEnvValue(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+#.*$/, "").trim();
}

function cleanChannelValue(value: string | undefined, key: string): string {
  const cleaned = cleanEnvValue(value);
  const prefix = `${key}=`;
  if (cleaned.startsWith(prefix)) {
    return cleaned.substring(prefix.length).trim();
  }
  return cleaned;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  slackBotToken: cleanEnvValue(process.env.SLACK_BOT_TOKEN),
  slackSigningSecret: cleanEnvValue(process.env.SLACK_SIGNING_SECRET),
  pipelineSlackChannel: cleanChannelValue(process.env.PIPELINE_SLACK_CHANNEL, "PIPELINE_SLACK_CHANNEL"),
  cliNotificationChannel: cleanChannelValue(process.env.CLI_NOTIFICATION_CHANNEL, "CLI_NOTIFICATION_CHANNEL"),
  cliVerboseMode: cleanEnvValue(process.env.CLI_VERBOSE_MODE).toLowerCase() === "true",
  azureOpenAiEndpoint: process.env.AZURE_OPENAI_ENDPOINT ?? "",
  azureOpenAiApiKey: process.env.AZURE_OPENAI_API_KEY ?? "",
  azureOpenAiDeployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4.1",
  // Local dir or Azure Files mount path for pipeline artifacts
  artifactBasePath: process.env.ARTIFACT_BASE_PATH ?? "./artifacts",
  // How long (days) to retain artifacts for failed/cancelled pipelines before GC sweep removes them
  artifactRetentionDays: Number(process.env.ARTIFACT_RETENTION_DAYS ?? "7"),
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
  // Dry-run mode (workflow validation) — when enabled, all LLM calls are routed
  // to MockLlmProvider; real git/GitHub/Slack/DB/artifact-FS remain live.
  // Path is resolved relative to backend-api process cwd.
  dryRun: ["1", "true"].includes((process.env.DRY_RUN ?? "").trim().toLowerCase()),
  dryRunScenarioPath: process.env.DRY_RUN_SCENARIO_PATH ?? "",
  dryRunRepoAllowlist: process.env.DRY_RUN_REPO_ALLOWLIST ?? "",
};
