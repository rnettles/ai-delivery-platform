import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  n8nCallbackUrl: process.env.N8N_CALLBACK_URL ?? "",
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
};
