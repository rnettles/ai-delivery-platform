[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "help",

  [string]$BaseUrl = "",
  [string]$ApiKey = "",
  [string]$EnvFile = ".env.local",

  # Generic request mode
  [string]$Method = "GET",
  [string]$Path = "",
  [string]$BodyJson = "",

  # Common identifiers
  [string]$PipelineId = "",
  [string]$ExecutionId = "",
  [string]$ProjectId = "",
  [string]$CoordinationId = "",

  # Pipeline create and actions
  [string]$EntryPoint = "planner",
  [string]$ExecutionMode = "",
  [string]$Description = "local test feature",
  [string]$SlackChannel = "",
  [string]$Actor = "operator",
  [string]$ArtifactPath = "",
  [string]$Justification = "skip via api-cli",

  # Execute endpoint
  [string]$TargetType = "script",
  [string]$ScriptName = "test.echo",
  [string]$ScriptVersion = "2026.04.18",
  [string]$Message = "hello-local",

  # Query params
  [string]$CorrelationId = "",
  [string]$TargetName = "",
  [string]$ExecutionStatus = "",
  [int]$Limit = 20,
  [switch]$IncludeChannels,
  [switch]$ExcludeChannels,

  # Project endpoints
  [string]$ProjectName = "",
  [string]$RepoUrl = "",
  [string]$DefaultBranch = "main",
  [string]$ChannelId = "",

  [switch]$Raw,
  [Alias("h", "?")]
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:ADP_API_BASE_URL)) {
    $BaseUrl = $env:ADP_API_BASE_URL
  } else {
    $BaseUrl = "http://localhost:3000"
  }
}

if ([string]::IsNullOrWhiteSpace($ApiKey) -and -not [string]::IsNullOrWhiteSpace($env:ADP_API_KEY)) {
  $ApiKey = $env:ADP_API_KEY
}

function Show-Usage {
  @"
AI Delivery Platform API CLI

Usage:
  ./api-cli.ps1 <command> [options]
  ./api-cli.ps1 -Help

Global options:
  -BaseUrl <url>          API base URL (default: env ADP_API_BASE_URL or http://localhost:3000)
  -ApiKey <key>           x-api-key header value (default: env ADP_API_KEY)
  -Raw                    Emit raw object instead of JSON string output

Core commands:
  help
  health
  scripts
  execute
  executions
  execution
  replay

Pipeline commands:
  pipeline-create
  pipeline
  pipeline-summary
  pipeline-current
  pipeline-approve
  pipeline-cancel
  pipeline-takeover
  pipeline-handoff
  pipeline-skip
  sprint                     # sprint plan + task list for a pipeline

Project commands:
  projects
  project
  project-create
  project-assign-channel

Other commands:
  env-load
  git-sync
  git-status
  coord-create
  coord-get
  coord-patch
  coord-query
  coord-archive
  request

Quick examples:
  ./api-cli.ps1 health
  ./api-cli.ps1 execute -ScriptName test.echo -Message "hello-local"
  ./api-cli.ps1 pipeline-create -Description "Add health endpoint" -EntryPoint planner -ExecutionMode next-flow
  ./api-cli.ps1 projects
  ./api-cli.ps1 projects -ExcludeChannels
  ./api-cli.ps1 env-load
  ./api-cli.ps1 env-load -EnvFile .env.dev
  ./api-cli.ps1 project-create -ProjectName my-service -RepoUrl https://github.com/org/repo -DefaultBranch main -ChannelId C12345678
  ./api-cli.ps1 request -Method GET -Path /pipeline/status-summary/current

Details by command:
  execute:
    Optional: -TargetType script|role, -ScriptName, -ScriptVersion, -Message, -BodyJson

  executions:
    Optional filters: -CorrelationId, -TargetName, -ExecutionStatus completed|failed, -Limit

  pipeline-create:
    Optional: -EntryPoint planner|sprint-controller|implementer|verifier, -ExecutionMode next|next-flow|full-sprint,
              -Description, -SlackChannel, -BodyJson

  pipeline/pipeline-summary/pipeline-approve/pipeline-cancel/pipeline-takeover/pipeline-handoff/pipeline-skip:
    Require: -PipelineId
    Optional: -Actor, -ArtifactPath (handoff), -Justification (skip)

  projects:
    Includes channel mappings by default
    Optional: -ExcludeChannels
    Note: -IncludeChannels is still accepted for backward compatibility

  project:
    Require: -ProjectId

  project-create:
    Require: -ProjectName, -RepoUrl
    Optional: -DefaultBranch (default main), -ChannelId

  project-assign-channel:
    Require: -ProjectId, -ChannelId

  env-load:
    Optional: -EnvFile (default .env.local)
    Note: dot-source to persist in your current shell:
          . ./api-cli.ps1 env-load

  coordination commands:
    coord-create, coord-patch, coord-query expect -BodyJson
    coord-get, coord-archive require -CoordinationId

  request:
    Require: -Method, -Path
    Optional: -BodyJson
"@
}

function Require-Value {
  param(
    [string]$Value,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Missing required option: -$Name"
  }
}

function Build-Headers {
  $headers = @{}
  if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
    $headers["x-api-key"] = $ApiKey
  }
  return $headers
}

function Build-Uri {
  param(
    [string]$RelativePath,
    [hashtable]$Query
  )

  $base = $BaseUrl.TrimEnd("/")
  $path = if ($RelativePath.StartsWith("/")) { $RelativePath } else { "/$RelativePath" }

  $uri = "$base$path"

  if ($null -ne $Query -and $Query.Count -gt 0) {
    $parts = @()
    foreach ($key in $Query.Keys) {
      $value = $Query[$key]
      if ($null -eq $value) { continue }
      $text = "$value"
      if ([string]::IsNullOrWhiteSpace($text)) { continue }
      $parts += ("{0}={1}" -f [uri]::EscapeDataString($key), [uri]::EscapeDataString($text))
    }

    if ($parts.Count -gt 0) {
      $uri = "{0}?{1}" -f $uri, ($parts -join "&")
    }
  }

  return $uri
}

function Load-EnvFile {
  param([string]$FilePath)

  if ([string]::IsNullOrWhiteSpace($FilePath)) {
    throw "Missing env file path. Use -EnvFile <path>."
  }

  $candidatePaths = New-Object System.Collections.Generic.List[string]

  if ([System.IO.Path]::IsPathRooted($FilePath)) {
    $candidatePaths.Add($FilePath)
  } else {
    $candidatePaths.Add((Join-Path (Get-Location) $FilePath))
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
      $candidatePaths.Add((Join-Path $PSScriptRoot $FilePath))
      if ($FilePath -eq ".env.local") {
        $candidatePaths.Add((Join-Path $PSScriptRoot "platform/backend-api/.env.local"))
      }
    }
  }

  $resolvedPath = $candidatePaths | Where-Object { Test-Path -Path $_ -PathType Leaf } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
    $tried = $candidatePaths -join "; "
    throw "Env file not found: $FilePath. Tried: $tried"
  }

  $loaded = New-Object System.Collections.Generic.List[string]
  $lines = Get-Content -Path $resolvedPath

  foreach ($raw in $lines) {
    $line = $raw.Trim()
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.StartsWith("#")) { continue }

    if ($line.StartsWith("export ")) {
      $line = $line.Substring(7).Trim()
    }

    $eq = $line.IndexOf("=")
    if ($eq -le 0) { continue }

    $key = $line.Substring(0, $eq).Trim()
    if ([string]::IsNullOrWhiteSpace($key)) { continue }

    $value = $line.Substring($eq + 1).Trim()

    # Keep parsing simple and deterministic for standard dotenv files.
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$key" -Value $value
    $loaded.Add($key)
  }

  $count = $loaded.Count
  Write-Host "Loaded $count environment variable(s) from $resolvedPath"

  if ($count -gt 0) {
    $preview = $loaded | Sort-Object | Select-Object -First 10
    Write-Host ("Keys: " + ($preview -join ", "))
  }

  Write-Host "Tip: to keep variables in your current shell, dot-source this command: . ./api-cli.ps1 env-load"
}

function Write-Result {
  param([object]$Result)

  if ($Raw) {
    $Result
    return
  }

  $Result | ConvertTo-Json -Depth 30
}

function Invoke-Adp {
  param(
    [string]$HttpMethod,
    [string]$RelativePath,
    [object]$BodyObject = $null,
    [hashtable]$Query = $null
  )

  $uri = Build-Uri -RelativePath $RelativePath -Query $Query
  $headers = Build-Headers

  try {
    if ($null -ne $BodyObject) {
      $bodyPayload = if ($BodyObject -is [string]) {
        $BodyObject
      } else {
        $BodyObject | ConvertTo-Json -Depth 30
      }

      $response = Invoke-RestMethod -Method $HttpMethod -Uri $uri -Headers $headers -ContentType "application/json" -Body $bodyPayload
    } else {
      $response = Invoke-RestMethod -Method $HttpMethod -Uri $uri -Headers $headers
    }

    Write-Result -Result $response
  } catch {
    $errorMessage = $_.Exception.Message
    $details = $_.ErrorDetails.Message

    Write-Host "Request failed: $HttpMethod $uri" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($details)) {
      Write-Host $details -ForegroundColor Yellow
    } else {
      Write-Host $errorMessage -ForegroundColor Yellow
    }

    throw
  }
}

if ($Help -or $Command -eq "help") {
  Show-Usage
  exit 0
}

$commandName = $Command.Trim().ToLowerInvariant()

switch ($commandName) {
  "env-load" {
    Load-EnvFile -FilePath $EnvFile
    break
  }

  "health" {
    Invoke-Adp -HttpMethod "GET" -RelativePath "/health"
    break
  }

  "scripts" {
    Invoke-Adp -HttpMethod "GET" -RelativePath "/scripts"
    break
  }

  "execute" {
    $payload = if (-not [string]::IsNullOrWhiteSpace($BodyJson)) {
      $BodyJson
    } else {
      @{
        target = @{
          type = $TargetType
          name = $ScriptName
          version = $ScriptVersion
        }
        input = @{ message = $Message }
      }
    }

    Invoke-Adp -HttpMethod "POST" -RelativePath "/execute" -BodyObject $payload
    break
  }

  "executions" {
    $query = @{
      correlation_id = $CorrelationId
      target_name = $TargetName
      status = $ExecutionStatus
      limit = $Limit
    }
    Invoke-Adp -HttpMethod "GET" -RelativePath "/executions" -Query $query
    break
  }

  "execution" {
    Require-Value -Value $ExecutionId -Name "ExecutionId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/executions/$ExecutionId"
    break
  }

  "replay" {
    Require-Value -Value $ExecutionId -Name "ExecutionId"
    Invoke-Adp -HttpMethod "POST" -RelativePath "/executions/$ExecutionId/replay" -BodyObject "{}"
    break
  }

  "pipeline-create" {
    $payload = if (-not [string]::IsNullOrWhiteSpace($BodyJson)) {
      $BodyJson
    } else {
      $metadata = @{ source = "api" }
      if (-not [string]::IsNullOrWhiteSpace($SlackChannel)) {
        $metadata.slack_channel = $SlackChannel
      }

      $obj = @{
        entry_point = $EntryPoint
        input = @{ description = $Description }
        metadata = $metadata
      }

      if (-not [string]::IsNullOrWhiteSpace($ExecutionMode)) {
        $obj.execution_mode = $ExecutionMode
      }

      $obj
    }

    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline" -BodyObject $payload
    break
  }

  "pipeline" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/$PipelineId"
    break
  }

  "pipeline-summary" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/$PipelineId/status-summary"
    break
  }

  "pipeline-current" {
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/status-summary/current"
    break
  }

  "sprint" {
    # Resolve pipeline: explicit -PipelineId or fall back to the current active pipeline
    $resolvedPipelineId = $PipelineId
    if ([string]::IsNullOrWhiteSpace($resolvedPipelineId)) {
      $current = Invoke-RestMethod `
        -Method GET `
        -Uri (Build-Uri "/pipeline/status-summary/current") `
        -Headers (Build-Headers) `
        -UseBasicParsing
      if ($current.kind -eq "none") {
        Write-Host "No active pipeline. Provide -PipelineId to inspect a specific pipeline."
        break
      }
      $resolvedPipelineId = $current.pipeline_id
    }

    # Fetch sprint controller execution for this pipeline
    $executions = Invoke-RestMethod `
      -Method GET `
      -Uri (Build-Uri "/executions" @{ limit = 100 }) `
      -Headers (Build-Headers) `
      -UseBasicParsing

    $sprintExec = $executions.records | Where-Object {
      $_.target.name -in @("role.sprint-controller", "sprint-controller") -and
      $_.metadata.pipeline_id -eq $resolvedPipelineId -and
      $_.status -eq "completed"
    } | Select-Object -First 1

    if (-not $sprintExec) {
      Write-Host "No completed sprint-controller execution found for pipeline: $resolvedPipelineId"
      break
    }

    $out = $sprintExec.output
    $sprintId  = $out.sprint_id
    $phaseId   = $out.phase_id

    # Try to fetch full sprint plan from artifact endpoint
    $sprintPlanPath = $out.sprint_plan_path
    $tasks = $null
    if (-not [string]::IsNullOrWhiteSpace($sprintPlanPath)) {
      try {
        $planText = Invoke-RestMethod `
          -Method GET `
          -Uri (Build-Uri "/pipeline/$resolvedPipelineId/artifact" @{ path = $sprintPlanPath }) `
          -Headers (Build-Headers) `
          -UseBasicParsing
        # Parse tasks from markdown table: | TASK-ID | description | status |
        $taskLines = $planText -split "`n" | Where-Object { $_ -match '\|\s*[A-Z0-9]+-\d+' }
        $tasks = $taskLines | ForEach-Object {
          $cols = ($_ -split '\|') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
          if ($cols.Count -ge 3) {
            [PSCustomObject]@{ task_id = $cols[0]; description = $cols[1]; status = $cols[2] }
          }
        }
      } catch {
        # Artifact not accessible (container restart or remote env) — fall back to first_task only
        $tasks = $null
      }
    }

    # Determine task statuses from implementer execution history
    $implExecs = $executions.records | Where-Object {
      $_.target.name -in @("role.implementer", "implementer") -and
      $_.metadata.pipeline_id -eq $resolvedPipelineId
    }
    $completedTaskIds = $implExecs | Where-Object { $_.status -eq "completed" } |
      ForEach-Object { $_.output.task_id } | Where-Object { $_ } | Select-Object -Unique

    Write-Host ""
    Write-Host "=== Sprint: $sprintId  (Phase: $phaseId)  Pipeline: $resolvedPipelineId ==="
    Write-Host ""

    if ($tasks) {
      Write-Host "Tasks:"
      $tasks | ForEach-Object {
        $tid    = $_.task_id
        $status = $_.status
        # Upgrade status from execution history if possible
        if ($completedTaskIds -contains $tid) { $status = "completed" }
        Write-Host "  $tid  $($_.description)  [$status]"
      }
    } else {
      # Fallback: show first_task from execution output
      Write-Host "Tasks (first task only — full plan artifact not accessible):"
      $ft     = $out.first_task
      $ftStat = if ($completedTaskIds -contains $ft.task_id) { "completed" } else { $ft.status }
      Write-Host "  $($ft.task_id)  $($ft.title)  [$ftStat]"
    }

    Write-Host ""
    break
  }

  "pipeline-approve" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$PipelineId/approve" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-cancel" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$PipelineId/cancel" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-takeover" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$PipelineId/takeover" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-handoff" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    $payload = @{ actor = $Actor }
    if (-not [string]::IsNullOrWhiteSpace($ArtifactPath)) {
      $payload.artifact_path = $ArtifactPath
    }

    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$PipelineId/handoff" -BodyObject $payload
    break
  }

  "pipeline-skip" {
    Require-Value -Value $PipelineId -Name "PipelineId"
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$PipelineId/skip" -BodyObject @{
      actor = $Actor
      justification = $Justification
    }
    break
  }

  "projects" {
    $query = @{ include_channels = "true" }

    if ($ExcludeChannels) {
      $query.remove("include_channels")
    }

    Invoke-Adp -HttpMethod "GET" -RelativePath "/projects" -Query $query
    break
  }

  "project" {
    Require-Value -Value $ProjectId -Name "ProjectId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/projects/$ProjectId"
    break
  }

  "project-create" {
    Require-Value -Value $ProjectName -Name "ProjectName"
    Require-Value -Value $RepoUrl -Name "RepoUrl"

    $payload = @{
      name = $ProjectName
      repo_url = $RepoUrl
      default_branch = $DefaultBranch
    }

    if (-not [string]::IsNullOrWhiteSpace($ChannelId)) {
      $payload.channel_id = $ChannelId
    }

    Invoke-Adp -HttpMethod "POST" -RelativePath "/projects" -BodyObject $payload
    break
  }

  "project-assign-channel" {
    Require-Value -Value $ProjectId -Name "ProjectId"
    Require-Value -Value $ChannelId -Name "ChannelId"

    Invoke-Adp -HttpMethod "POST" -RelativePath "/projects/$ProjectId/channels" -BodyObject @{ channel_id = $ChannelId }
    break
  }

  "git-sync" {
    Invoke-Adp -HttpMethod "POST" -RelativePath "/git/sync" -BodyObject "{}"
    break
  }

  "git-status" {
    Invoke-Adp -HttpMethod "GET" -RelativePath "/git/status"
    break
  }

  "coord-create" {
    Require-Value -Value $BodyJson -Name "BodyJson"
    Invoke-Adp -HttpMethod "POST" -RelativePath "/coordination" -BodyObject $BodyJson
    break
  }

  "coord-get" {
    Require-Value -Value $CoordinationId -Name "CoordinationId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/coordination/$CoordinationId"
    break
  }

  "coord-patch" {
    Require-Value -Value $CoordinationId -Name "CoordinationId"
    Require-Value -Value $BodyJson -Name "BodyJson"
    Invoke-Adp -HttpMethod "PATCH" -RelativePath "/coordination/$CoordinationId" -BodyObject $BodyJson
    break
  }

  "coord-query" {
    $payload = if (-not [string]::IsNullOrWhiteSpace($BodyJson)) { $BodyJson } else { "{}" }
    Invoke-Adp -HttpMethod "POST" -RelativePath "/coordination/query" -BodyObject $payload
    break
  }

  "coord-archive" {
    Require-Value -Value $CoordinationId -Name "CoordinationId"
    Invoke-Adp -HttpMethod "DELETE" -RelativePath "/coordination/$CoordinationId"
    break
  }

  "request" {
    Require-Value -Value $Method -Name "Method"
    Require-Value -Value $Path -Name "Path"

    $body = if ([string]::IsNullOrWhiteSpace($BodyJson)) { $null } else { $BodyJson }
    Invoke-Adp -HttpMethod $Method.ToUpperInvariant() -RelativePath $Path -BodyObject $body
    break
  }

  default {
    Write-Host "Unknown command: $Command" -ForegroundColor Yellow
    Show-Usage
    exit 1
  }
}
