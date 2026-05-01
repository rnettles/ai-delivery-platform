$ErrorActionPreference = "Stop"

# Dry-run launcher: starts the backend-api with all LLM calls routed to MockLlmProvider.
# Real git, GitHub, Slack, DB, and artifact-FS remain LIVE — point them at sandbox values.

$repoRoot = Split-Path -Parent $PSCommandPath
$envFile = Join-Path $repoRoot "platform\backend-api\.env.local"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $name, $value = $_ -split '=', 2
    if (-not $name -or $null -eq $value) { return }
    $cleanName = $name.Trim()
    $cleanValue = ($value.Trim() -replace '\s+#.*$', '').Trim()
    [Environment]::SetEnvironmentVariable($cleanName, $cleanValue, 'Process')
  }
}

# Force dry-run mode regardless of .env.local
[Environment]::SetEnvironmentVariable('DRY_RUN', '1', 'Process')

if (-not $env:DRY_RUN_SCENARIO_PATH) {
  $defaultScenario = Join-Path $repoRoot "dry-run-scenarios\happy-path.json"
  [Environment]::SetEnvironmentVariable('DRY_RUN_SCENARIO_PATH', $defaultScenario, 'Process')
}

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Yellow
Write-Host " DRY-RUN MODE — MockLlmProvider for all LLM calls" -ForegroundColor Yellow
Write-Host " Scenario: $env:DRY_RUN_SCENARIO_PATH" -ForegroundColor Yellow
Write-Host " GIT_REPO_URL: $env:GIT_REPO_URL" -ForegroundColor Yellow
Write-Host "===========================================================" -ForegroundColor Yellow
Write-Host ""

Set-Location (Join-Path $repoRoot "platform\backend-api")
npm run dev
