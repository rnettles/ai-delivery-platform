# Clear any dry-run state that may have leaked from a previous dryrun terminal session.
[Environment]::SetEnvironmentVariable('DRY_RUN', $null, 'Process')
[Environment]::SetEnvironmentVariable('DRY_RUN_SCENARIO_PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('DRY_RUN_REPO_ALLOWLIST', $null, 'Process')

Get-Content .\platform\backend-api\.env.local | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $name, $value = $_ -split '=', 2
  if (-not $name -or $null -eq $value) { return }

  $cleanName = $name.Trim()
  $cleanValue = $value.Trim()
  # Support inline comments in .env values, e.g. VAR=value  # comment
  $cleanValue = ($cleanValue -replace '\s+#.*$', '').Trim()

  [Environment]::SetEnvironmentVariable($cleanName, $cleanValue, 'Process')
}

Set-Location .\platform\backend-api
npm run dev