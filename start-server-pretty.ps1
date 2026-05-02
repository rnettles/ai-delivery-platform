# start-server-pretty.ps1
# Starts the backend API with human-readable (colorized) log output.
# Set LOG_FORMAT=pretty so the logger emits ANSI-colored lines instead of JSON.
#
# Usage:
#   .\start-server-pretty.ps1
#   .\start-server-pretty.ps1 -EnvFile .env.local   # default
#   .\start-server-pretty.ps1 -EnvFile .env          # use base env

param(
    [string]$EnvFile = ".env.local"
)

# ─── Load env vars from backend-api ──────────────────────────────────────────
$envPath = Join-Path "platform\backend-api" $EnvFile
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $name, $value = $_ -split '=', 2
        if (-not $name -or $null -eq $value) { return }
        $cleanName  = $name.Trim()
        $cleanValue = ($value.Trim() -replace '\s+#.*$', '').Trim()
        [Environment]::SetEnvironmentVariable($cleanName, $cleanValue, 'Process')
    }
    Write-Host "[start-server-pretty] Loaded env from $envPath" -ForegroundColor DarkGray
} else {
    Write-Host "[start-server-pretty] No $envPath found — using existing env" -ForegroundColor Yellow
}

# ─── Enable pretty log format in the logger service ──────────────────────────
$env:LOG_FORMAT = "pretty"

# ─── Run server ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  AI Delivery Platform — Backend API (pretty logs)" -ForegroundColor DarkCyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

Push-Location "platform\backend-api"
try {
    npm run dev
} finally {
    Pop-Location
}
