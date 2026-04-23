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