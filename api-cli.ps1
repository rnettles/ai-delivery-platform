[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "help",

  [string]$BaseUrl = "",
  [string]$ApiKey = "",
  [string]$EnvFile = "platform/backend-api/.env.local",

  # Generic request mode
  [string]$Method = "GET",
  [string]$Path = "",
  [string]$BodyJson = "",

  # Common identifiers
  [string]$PipelineId = "",
  [string]$OperationId = "",
  [string]$ExecutionId = "",
  [string]$ProjectId = "",
  [string]$CoordinationId = "",

  # Pipeline create and actions
  [string]$EntryPoint = "planner",
  [string]$ExecutionMode = "",
  [string]$Description = "local test feature",
  [string]$SlackChannel = "",
  [string]$Actor = "operator",
  [string]$OpsAction = "diagnose",
  [string]$ArtifactPath = "",
  [string]$Justification = "skip via api-cli",
  [string]$Branch = "",
  [string]$BaseBranch = "",
  [string]$HeadBranch = "",

  # Execute endpoint
  [string]$TargetType = "script",
  [string]$ScriptName = "test.echo",
  [string]$ScriptVersion = "2026.04.18",
  [string]$Message = "hello-local",

  # Query params
  [string]$CorrelationId = "",
  [string]$TargetName = "",
  [string]$ExecutionStatus = "",
  [string]$Status = "",
  [int]$Limit = 20,
  [switch]$IncludeChannels,
  [switch]$ExcludeChannels,

  # Project endpoints
  [string]$ProjectName = "",
  [string]$RepoUrl = "",
  [string]$DefaultBranch = "main",
  [string]$ChannelId = "",

  # Dry-run reset
  [string]$RepoName = "",

  [switch]$Raw,
  [Alias("h", "?")]
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:StateFile = Join-Path $PSScriptRoot ".api-cli.state.json"

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
  active-set
  active-show
  active-clear
  health
  scripts
  execute
  executions
  execution
  replay

Pipeline commands:
  pipeline-create
  pipeline
  pipeline-list
  staged-phases
  staged-sprints
  staged-tasks
  pipeline-summary
  pipeline-current
  pipeline-approve
  pipeline-cancel
  pipeline-takeover
  pipeline-retry
  pipeline-retry-op
  pipeline-op-status
  pipeline-handoff
  pipeline-skip
  admin-op-create
  admin-op-status
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
  dryrun-reset

Quick examples:
  ./api-cli.ps1 health
  ./api-cli.ps1 active-set -ChannelId C12345678 -PipelineId pipe-2026-04-22-abc12345
  ./api-cli.ps1 active-show
  ./api-cli.ps1 execute -ScriptName test.echo -Message "hello-local"
  ./api-cli.ps1 pipeline-list -ChannelId C12345678
  ./api-cli.ps1 pipeline-create -Description "Add health endpoint" -EntryPoint planner -ExecutionMode next-flow
  ./api-cli.ps1 admin-op-create -OpsAction diagnose -ProjectId <project-id>
  ./api-cli.ps1 pipeline-retry-op -PipelineId <pipeline-id>
  ./api-cli.ps1 pipeline-op-status -PipelineId <pipeline-id> -OperationId <operation-id>
  ./api-cli.ps1 projects
  ./api-cli.ps1 projects -ExcludeChannels
  ./api-cli.ps1 env-load
  ./api-cli.ps1 env-load -EnvFile .env.dev
  ./api-cli.ps1 project-create -ProjectName my-service -RepoUrl https://github.com/org/repo -DefaultBranch main -ChannelId C12345678
  ./api-cli.ps1 request -Method GET -Path /pipeline/status-summary/current

Details by command:
  active-set:
    Set active defaults used by other commands.
    Optional: -ChannelId, -PipelineId (provide at least one)

  active-show:
    Display active ChannelId and PipelineId (if set)

  active-clear:
    Clear active defaults

  execute:
    Optional: -TargetType script|role, -ScriptName, -ScriptVersion, -Message, -BodyJson

  executions:
    Optional filters: -CorrelationId, -TargetName, -ExecutionStatus completed|failed, -Limit

  pipeline-create:
    Optional: -EntryPoint planner|sprint-controller|implementer|verifier, -ExecutionMode next|next-flow|full-sprint,
              -Description, -SlackChannel, -BodyJson

  pipeline-list:
    Lists pipelines for a channel from newest to oldest.
    Optional: -ChannelId (falls back to active channel), -Limit

  staged-phases:
    Refreshes git, then lists staged phases from repo artifacts.
    Optional: -ChannelId (falls back to active channel), -ProjectId, -Limit

  staged-sprints:
    Refreshes git, then lists staged sprints from repo artifacts.
    Optional: -ChannelId (falls back to active channel), -ProjectId, -Limit

  staged-tasks:
    Refreshes git, then lists staged tasks from staged sprint plans.
    Optional: -ChannelId (falls back to active channel), -ProjectId, -Limit

  pipeline-create:
    Require: -EntryPoint, -Description
    Optional: -ExecutionMode (next-flow|full-sprint)

  pipeline-summary:
    Includes latest admin recovery operation telemetry and blocked-operation checklist when present.

  admin-op-create:
    Queue an async admin operation.
    Require: -OpsAction diagnose|reconcile|reset-workspace|retry
    Optional: -ProjectId, -PipelineId, -Actor, -Branch, -BaseBranch, -HeadBranch

  admin-op-status:
    Require: -OperationId

  pipeline-retry-op:
    Queue the gated async retry flow for a failed pipeline.
    Require: -PipelineId
    Optional: -Actor

  pipeline-op-status:
    Require: -PipelineId, -OperationId

  pipeline-approve/pipeline-cancel/pipeline-approve/pipeline-takeover/pipeline-retry/pipeline-handoff/pipeline-skip:
    Require: -PipelineId
    Optional: -Actor, -ArtifactPath (handoff), -Justification (skip)
    Note: takeover pauses pipeline in takeover mode; retry resumes failed step

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
    Optional: -EnvFile (default platform/backend-api/.env.local)
    Note: dot-source to persist in your current shell:
          . ./api-cli.ps1 env-load

  coordination commands:
    coord-create, coord-patch, coord-query expect -BodyJson
    coord-get, coord-archive require -CoordinationId

  request:
    Require: -Method, -Path
    Optional: -BodyJson

  dryrun-reset:
    Remove all pipeline-generated artifacts from a dry-run sandbox repo and push
    a clean reset commit so the next run starts from a known good state.
    Require: -RepoName (e.g. adp-dryrun)
    Optional: -BaseClonePath (default: runtime/git-clones relative to repo root)
    Clears: staged_phases/, active/, history/ — preserves .gitkeep placeholders and docs/
    Example: ./api-cli.ps1 dryrun-reset -RepoName adp-dryrun
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

function Get-StringOrEmpty {
  param([object]$Value)

  if ($null -ne $Value) {
    return [string]$Value
  }

  return ""
}

function Load-ActiveState {
  if (-not (Test-Path -Path $script:StateFile -PathType Leaf)) {
    return @{}
  }

  try {
    $raw = Get-Content -Path $script:StateFile -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return @{}
    }
    $obj = $raw | ConvertFrom-Json
    $channelId = Get-StringOrEmpty $obj.channel_id
    $pipelineId = Get-StringOrEmpty $obj.pipeline_id
    return @{
      channel_id = $channelId
      pipeline_id = $pipelineId
    }
  } catch {
    return @{}
  }
}

function Save-ActiveState {
  param([hashtable]$State)

  $dir = Split-Path -Path $script:StateFile -Parent
  if (-not (Test-Path -Path $dir -PathType Container)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }

  $channelId = ""
  if ($State.ContainsKey("channel_id")) {
    $channelId = Get-StringOrEmpty $State["channel_id"]
  }

  $pipelineId = ""
  if ($State.ContainsKey("pipeline_id")) {
    $pipelineId = Get-StringOrEmpty $State["pipeline_id"]
  }

  $payload = @{
    channel_id = $channelId
    pipeline_id = $pipelineId
  }

  $payload | ConvertTo-Json -Depth 5 | Set-Content -Path $script:StateFile -Encoding UTF8
}

function Resolve-ChannelId {
  param([string]$ExplicitChannelId)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitChannelId)) {
    return $ExplicitChannelId
  }

  if (-not [string]::IsNullOrWhiteSpace($script:activeState["channel_id"])) {
    $script:activeUsage["channel"] = $true
    return [string]$script:activeState["channel_id"]
  }

  return ""
}

function Resolve-PipelineId {
  param(
    [string]$ExplicitPipelineId,
    [switch]$Required
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPipelineId)) {
    return $ExplicitPipelineId
  }

  if (-not [string]::IsNullOrWhiteSpace($script:activeState["pipeline_id"])) {
    $script:activeUsage["pipeline"] = $true
    return [string]$script:activeState["pipeline_id"]
  }

  if ($Required) {
    throw "Missing required option: -PipelineId (or set one via active-set)"
  }

  return ""
}

function Show-ActiveContextIfUsed {
  if ($script:activeBannerShown) {
    return
  }

  $usedChannel = [bool]($script:activeUsage["channel"])
  $usedPipeline = [bool]($script:activeUsage["pipeline"])
  if (-not ($usedChannel -or $usedPipeline)) {
    return
  }

  $parts = @()
  if ($usedChannel) {
    $parts += ("channel_id={0}" -f (Get-StringOrEmpty $script:activeState["channel_id"]))
  }
  if ($usedPipeline) {
    $parts += ("pipeline_id={0}" -f (Get-StringOrEmpty $script:activeState["pipeline_id"]))
  }

  Write-Host ("Using active context: " + ($parts -join ", ")) -ForegroundColor Cyan
  $script:activeBannerShown = $true
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
  $path = "/$RelativePath"
  if ($RelativePath.StartsWith("/")) {
    $path = $RelativePath
  }

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

function Get-BoolEnv {
  param(
    [string]$Name,
    [bool]$Default = $false
  )

  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  $raw = Get-StringOrEmpty $processValue
  if ([string]::IsNullOrWhiteSpace($raw)) {
    $userValue = [Environment]::GetEnvironmentVariable($Name, "User")
    $raw = Get-StringOrEmpty $userValue
  }
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $Default
  }

  $text = $raw.Trim().ToLowerInvariant()
  return $text -in @("1", "true", "yes", "y", "on")
}

function Test-ShouldNotifyCommand {
  param([string]$Name)

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return $false
  }

  if (Get-BoolEnv -Name "CLI_VERBOSE_MODE") {
    return $true
  }

  $notifiableCommands = @(
    "active-set",
    "active-show",
    "active-clear",
    "health",
    "scripts",
    "execute",
    "executions",
    "execution",
    "replay",
    "pipeline",
    "pipeline-list",
    "staged-phases",
    "staged-sprints",
    "staged-tasks",
    "pipeline-summary",
    "pipeline-current",
    "sprint",
    "pipeline-create",
    "pipeline-approve",
    "pipeline-cancel",
    "pipeline-takeover",
    "pipeline-retry",
    "pipeline-retry-op",
    "pipeline-op-status",
    "pipeline-handoff",
    "pipeline-skip",
    "admin-op-create",
    "admin-op-status",
    "projects",
    "project",
    "project-create",
    "project-assign-channel",
    "git-sync",
    "git-status",
    "coord-create",
    "coord-get",
    "coord-patch",
    "coord-query",
    "coord-archive",
    "request"
  )

  return $notifiableCommands -contains $Name
}

function Get-ResponsePrimaryId {
  param([object]$Response)

  if ($null -eq $Response) { return "" }

  foreach ($name in @("pipeline_id", "execution_id", "project_id", "coordination_id", "job_id", "operation_id", "id")) {
    $prop = $Response.PSObject.Properties[$name]
    if ($null -ne $prop) {
      $value = [string]$prop.Value
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
      }
    }
  }

  $operationProp = $Response.PSObject.Properties["operation"]
  if ($null -ne $operationProp -and $null -ne $operationProp.Value) {
    foreach ($name in @("job_id", "operation_id", "id")) {
      $nested = $operationProp.Value.PSObject.Properties[$name]
      if ($null -ne $nested) {
        $value = [string]$nested.Value
        if (-not [string]::IsNullOrWhiteSpace($value)) {
          return $value
        }
      }
    }
  }

  return ""
}

function Normalize-NotificationText {
  param(
    [string]$Text,
    [int]$MaxLength = 220
  )

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return ""
  }

  $flat = ($Text -replace "\r?\n", " " -replace "\s+", " ").Trim()
  if ($flat.Length -le $MaxLength) {
    return $flat
  }

  return ($flat.Substring(0, $MaxLength - 1) + "…")
}

function Build-CliNotificationMessage {
  param(
    [string]$Status,
    [string]$CommandName,
    [string]$HttpMethod,
    [string]$RelativePath,
    [string]$ResponseId = "",
    [string]$Reason = ""
  )

  $normalizedStatus = ([string]$Status).Trim().ToUpperInvariant()
  $verb = "succeeded"
  if ($normalizedStatus -eq "ERROR") {
    $verb = "failed"
  }
  $summary = "CLI command '{0}' {1}." -f $CommandName, $verb
  $endpoint = "Endpoint: {0} {1}" -f $HttpMethod, $RelativePath

  $parts = @($summary, $endpoint)

  if (-not [string]::IsNullOrWhiteSpace($ResponseId)) {
    $parts += ("Reference: {0}" -f $ResponseId)
  }

  if (-not [string]::IsNullOrWhiteSpace($Reason)) {
    $parts += ("Reason: {0}" -f (Normalize-NotificationText -Text $Reason))
  }

  return ($parts -join "`n")
}

function Send-LocalCommandNotification {
  param(
    [string]$CommandName,
    [string]$Detail = ""
  )

  if (-not (Test-ShouldNotifyCommand -Name $CommandName)) {
    return
  }

  $message = Build-CliNotificationMessage `
    -Status "INFO" `
    -CommandName $CommandName `
    -HttpMethod "LOCAL" `
    -RelativePath "/cli/$CommandName" `
    -Reason $Detail

  Send-CliNotification `
    -Status "INFO" `
    -Message $message `
    -CommandName $CommandName `
    -HttpMethod "LOCAL" `
    -RelativePath "/cli/$CommandName" `
    -ForceCliChannel
}

function Resolve-NotificationChannelId {
  if (-not [string]::IsNullOrWhiteSpace($ChannelId)) {
    return $ChannelId
  }

  if (-not [string]::IsNullOrWhiteSpace($SlackChannel)) {
    return $SlackChannel
  }

  if ($null -ne $script:activeState -and -not [string]::IsNullOrWhiteSpace((Get-StringOrEmpty $script:activeState["channel_id"]))) {
    return [string]$script:activeState["channel_id"]
  }

  return ""
}

function Send-CliNotification {
  param(
    [string]$Status,
    [string]$Message,
    [string]$CommandName,
    [string]$HttpMethod,
    [string]$RelativePath,
    [switch]$ForceCliChannel
  )

  if ([string]::IsNullOrWhiteSpace($Message)) {
    return
  }

  # Prevent accidental recursion if users call the notification endpoint directly.
  if ($CommandName -eq "request" -and $RelativePath -match "^/pipeline/cli-notify(\?.*)?$") {
    return
  }

  $payload = @{
    status = $Status
    command = $CommandName
    message = $Message
    metadata = @{
      method = $HttpMethod
      path = $RelativePath
      cli_source = "api-cli.ps1"
    }
  }

  if (-not $ForceCliChannel) {
    $targetChannel = Resolve-NotificationChannelId
    if (-not [string]::IsNullOrWhiteSpace($targetChannel)) {
      $payload.channel_id = $targetChannel
    }
  }

  try {
    $headers = Build-Headers
    $uri = Build-Uri -RelativePath "/pipeline/cli-notify" -Query $null
    $body = $payload | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method "POST" -Uri $uri -Headers $headers -ContentType "application/json" -Body $body | Out-Null
  } catch {
    # Non-blocking by design: notifications should never fail a CLI command.
  }
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
  Show-ActiveContextIfUsed

  try {
    if ($null -ne $BodyObject) {
      $bodyPayload = $BodyObject
      if (-not ($BodyObject -is [string])) {
        $bodyPayload = $BodyObject | ConvertTo-Json -Depth 30
      }

      $response = Invoke-RestMethod -Method $HttpMethod -Uri $uri -Headers $headers -ContentType "application/json" -Body $bodyPayload
    } else {
      $response = Invoke-RestMethod -Method $HttpMethod -Uri $uri -Headers $headers
    }

    Write-Result -Result $response
    $script:lastAdpResponse = $response

    if (Test-ShouldNotifyCommand -Name $script:commandName) {
      $id = Get-ResponsePrimaryId -Response $response
      $message = Build-CliNotificationMessage `
        -Status "INFO" `
        -CommandName $script:commandName `
        -HttpMethod $HttpMethod `
        -RelativePath $RelativePath `
        -ResponseId $id
      Send-CliNotification `
        -Status "INFO" `
        -Message $message `
        -CommandName $script:commandName `
        -HttpMethod $HttpMethod `
        -RelativePath $RelativePath
    }

    return $response
  } catch {
    $errorMessage = $_.Exception.Message
    $details = $_.ErrorDetails.Message

    Write-Host "Request failed: $HttpMethod $uri" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($details)) {
      Write-Host $details -ForegroundColor Yellow
    } else {
      Write-Host $errorMessage -ForegroundColor Yellow
    }

    if (Test-ShouldNotifyCommand -Name $script:commandName) {
      $detailText = $errorMessage
      if (-not [string]::IsNullOrWhiteSpace($details)) {
        $detailText = $details
      }
      $message = Build-CliNotificationMessage `
        -Status "ERROR" `
        -CommandName $script:commandName `
        -HttpMethod $HttpMethod `
        -RelativePath $RelativePath `
        -Reason $detailText
      Send-CliNotification `
        -Status "ERROR" `
        -Message $message `
        -CommandName $script:commandName `
        -HttpMethod $HttpMethod `
        -RelativePath $RelativePath
    }

    throw
  }
}

function Get-ContextPipelineId {
  param(
    [string]$ExplicitPipelineId,
    [string]$ExplicitChannelId,
    [switch]$Required
  )

  $pipelineId = Resolve-PipelineId -ExplicitPipelineId $ExplicitPipelineId
  if (-not [string]::IsNullOrWhiteSpace($pipelineId)) {
    return $pipelineId
  }

  $currentQuery = @{}
  $channelId = Resolve-ChannelId -ExplicitChannelId $ExplicitChannelId
  if (-not [string]::IsNullOrWhiteSpace($channelId)) {
    $currentQuery.channel_id = $channelId
  }

  try {
    Show-ActiveContextIfUsed
    $current = Invoke-RestMethod `
      -Method GET `
      -Uri (Build-Uri "/pipeline/status-summary/current" $currentQuery) `
      -Headers (Build-Headers) `
      -UseBasicParsing

    if ($null -ne $current -and $current.kind -ne "none" -and -not [string]::IsNullOrWhiteSpace([string]$current.pipeline_id)) {
      return [string]$current.pipeline_id
    }
  } catch {
    if ($Required) {
      throw
    }
  }

  if ($Required) {
    throw "Missing required option: -PipelineId (or set one via active-set, or provide -ChannelId with an active pipeline)"
  }

  return ""
}

function Get-ExecutionSortTime {
  param([object]$Record)

  $candidate = @(
    [string]$Record.completed_at,
    [string]$Record.updated_at,
    [string]$Record.created_at,
    [string]$Record.started_at
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1

  if ([string]::IsNullOrWhiteSpace($candidate)) {
    return [datetime]::MinValue
  }

  try {
    return [datetime]$candidate
  } catch {
    return [datetime]::MinValue
  }
}

function Get-PipelineExecutions {
  param(
    [string]$PipelineId,
    [int]$Max = 100
  )

  $effectiveLimit = [Math]::Min([Math]::Max($Max, 1), 100)
  $resp = Invoke-RestMethod `
    -Method GET `
    -Uri (Build-Uri "/executions" @{ limit = $effectiveLimit }) `
    -Headers (Build-Headers) `
    -UseBasicParsing

  return @(
    $resp.records |
    Where-Object {
      if ($null -eq $_.metadata) {
        return $false
      }

      $pipelineIdProp = $_.metadata.PSObject.Properties["pipeline_id"]
      if ($null -eq $pipelineIdProp) {
        return $false
      }

      $recordPipelineId = [string]$pipelineIdProp.Value
      if ([string]::IsNullOrWhiteSpace($recordPipelineId)) {
        return $false
      }

      return $recordPipelineId -eq $PipelineId
    }
  )
}

function Read-PipelineArtifactText {
  param(
    [string]$PipelineId,
    [string]$ArtifactPath
  )

  if ([string]::IsNullOrWhiteSpace($ArtifactPath)) {
    return ""
  }

  return Invoke-RestMethod `
    -Method GET `
    -Uri (Build-Uri "/pipeline/$PipelineId/artifact" @{ path = $ArtifactPath }) `
    -Headers (Build-Headers) `
    -UseBasicParsing
}

function Parse-SprintTasksFromMarkdown {
  param([string]$Markdown)

  if ([string]::IsNullOrWhiteSpace($Markdown)) {
    return @()
  }

  $lines = $Markdown -split "`r?`n"
  $inTasks = $false
  $tasks = New-Object System.Collections.Generic.List[object]

  foreach ($line in $lines) {
    if (-not $inTasks -and $line -match "^##\s+Tasks\b") {
      $inTasks = $true
      continue
    }

    if ($inTasks -and $line -match "^##\s+") {
      break
    }

    if ($inTasks -and $line -match "^\s*-\s+(.+?)\s*$") {
      $raw = $Matches[1].Trim()
      $taskIdMatch = [regex]::Match($raw, "[A-Z]{2,}-\d+")
      $taskId = $raw
      if ($taskIdMatch.Success) {
        $taskId = $taskIdMatch.Value
      }
      $tasks.Add([PSCustomObject]@{
        task_id = $taskId
        label = $raw
        status = "staged"
      })
    }
  }

  return @($tasks)
}

function Get-MarkdownFieldValue {
  param(
    [string]$Markdown,
    [string]$FieldName
  )

  if ([string]::IsNullOrWhiteSpace($Markdown) -or [string]::IsNullOrWhiteSpace($FieldName)) {
    return ""
  }

  $escaped = [regex]::Escape($FieldName)
  $match = [regex]::Match($Markdown, ("(?im)^\*\*{0}:\*\*\s*(.+?)\s*$" -f $escaped))
  if ($match.Success) {
    return $match.Groups[1].Value.Trim()
  }

  return ""
}

function Parse-PhasePlanFromMarkdown {
  param(
    [string]$Markdown,
    [string]$ArtifactPath
  )

  $phaseId = ""
  $name = Get-MarkdownFieldValue -Markdown $Markdown -FieldName "Name"
  $status = Get-MarkdownFieldValue -Markdown $Markdown -FieldName "Status"

  $title = [regex]::Match($Markdown, "(?im)^#\s*Phase\s*Plan:\s*(.+?)\s*$")
  if ($title.Success) {
    $phaseId = $title.Groups[1].Value.Trim()
  }

  if ([string]::IsNullOrWhiteSpace($phaseId)) {
    $pathMatch = [regex]::Match($ArtifactPath, "phase_plan_([^/]+)\.md$", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($pathMatch.Success) {
      $phaseId = $pathMatch.Groups[1].Value
    }
  }

  if ([string]::IsNullOrWhiteSpace($status)) {
    $status = "staged"
  }

  return [PSCustomObject]@{
    phase_id = $phaseId
    name = $name
    status = $status
  }
}

function Parse-SprintPlanFromMarkdown {
  param(
    [string]$Markdown,
    [string]$ArtifactPath
  )

  $sprintId = ""
  $phaseId = Get-MarkdownFieldValue -Markdown $Markdown -FieldName "Phase"
  $name = Get-MarkdownFieldValue -Markdown $Markdown -FieldName "Name"
  $status = Get-MarkdownFieldValue -Markdown $Markdown -FieldName "Status"

  $title = [regex]::Match($Markdown, "(?im)^#\s*Sprint\s*Plan:\s*(.+?)\s*$")
  if ($title.Success) {
    $sprintId = $title.Groups[1].Value.Trim()
  }

  if ([string]::IsNullOrWhiteSpace($sprintId)) {
    $pathMatch = [regex]::Match($ArtifactPath, "sprint_plan_([^/]+)\.md$", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($pathMatch.Success) {
      $sprintId = $pathMatch.Groups[1].Value
    }
  }

  if ([string]::IsNullOrWhiteSpace($status)) {
    $status = "staged"
  }

  return [PSCustomObject]@{
    sprint_id = $sprintId
    phase_id = $phaseId
    name = $name
    status = $status
  }
}

function Refresh-GitBeforeStagedEvaluation {
  Show-ActiveContextIfUsed
  Write-Host "Refreshing git repositories before staged artifact evaluation..." -ForegroundColor DarkCyan
  Invoke-RestMethod `
    -Method POST `
    -Uri (Build-Uri "/git/sync" $null) `
    -Headers (Build-Headers) `
    -ContentType "application/json" `
    -Body "{}" `
    -UseBasicParsing | Out-Null
}

function Get-PipelineArtifactPaths {
  param(
    [object]$Run,
    [string]$Pattern
  )

  $results = New-Object System.Collections.Generic.List[object]
  $seen = New-Object System.Collections.Generic.HashSet[string]
  $steps = @($Run.steps)

  for ($i = $steps.Count - 1; $i -ge 0; $i--) {
    $step = $steps[$i]
    $paths = @($step.artifact_paths)
    foreach ($path in $paths) {
      if ([string]::IsNullOrWhiteSpace([string]$path)) {
        continue
      }

      $artifactPath = [string]$path
      if ($artifactPath -notmatch $Pattern) {
        continue
      }

      if (-not $seen.Add($artifactPath)) {
        continue
      }

      $results.Add([PSCustomObject]@{
        artifact_path = $artifactPath
        role = [string]$step.role
        completed_at = [string]$step.completed_at
        started_at = [string]$step.started_at
      })
    }
  }

  return @($results.ToArray())
}

function Get-PipelineRunAfterGitRefresh {
  param(
    [string]$ExplicitPipelineId,
    [string]$ExplicitChannelId
  )

  $effectivePipelineId = Get-ContextPipelineId -ExplicitPipelineId $ExplicitPipelineId -ExplicitChannelId $ExplicitChannelId -Required
  Refresh-GitBeforeStagedEvaluation
  $run = Invoke-RestMethod `
    -Method GET `
    -Uri (Build-Uri "/pipeline/$effectivePipelineId" $null) `
    -Headers (Build-Headers) `
    -UseBasicParsing

  return [PSCustomObject]@{
    pipeline_id = $effectivePipelineId
    run = $run
  }
}

if ($Help -or $Command -eq "help") {
  Show-Usage
  exit 0
}

$commandName = $Command.Trim().ToLowerInvariant()
$script:activeState = Load-ActiveState
$script:activeUsage = @{ channel = $false; pipeline = $false }
$script:activeBannerShown = $false

switch ($commandName) {
  "active-set" {
    if ([string]::IsNullOrWhiteSpace($ChannelId) -and [string]::IsNullOrWhiteSpace($PipelineId)) {
      throw "active-set requires -ChannelId and/or -PipelineId"
    }

    $next = @{
      channel_id = Get-StringOrEmpty $script:activeState["channel_id"]
      pipeline_id = Get-StringOrEmpty $script:activeState["pipeline_id"]
    }

    if (-not [string]::IsNullOrWhiteSpace($ChannelId)) {
      $next["channel_id"] = $ChannelId
    }
    if (-not [string]::IsNullOrWhiteSpace($PipelineId)) {
      $next["pipeline_id"] = $PipelineId
    }

    Save-ActiveState -State $next
    $script:activeState = $next
    Write-Result -Result @{ ok = $true; active = $next }
    Send-LocalCommandNotification -CommandName $script:commandName -Detail "Active context updated."
    break
  }

  "active-show" {
    $channelId = Get-StringOrEmpty $script:activeState["channel_id"]
    $pipelineId = Get-StringOrEmpty $script:activeState["pipeline_id"]
    
    $result = @{
      ok = $true
      active = @{
        channel_id = $channelId
        pipeline_id = $pipelineId
      }
    }

    # If channel_id is set, fetch the projects linked to this channel
    if ($channelId) {
      try {
        $uri = Build-Uri -RelativePath "/projects/by-channel" -Query @{ channel_id = $channelId }
        $headers = Build-Headers
        $projects = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers
        $result.projects = $projects
      } catch {
        # If fetching projects fails, still show the active context
        Write-Warning "Failed to fetch projects for channel: $_"
      }
    }

    Write-Result -Result $result
    Send-LocalCommandNotification -CommandName $script:commandName -Detail "Active context retrieved."
    break
  }

  "active-clear" {
    if (Test-Path -Path $script:StateFile -PathType Leaf) {
      Remove-Item -Path $script:StateFile -Force
    }
    $script:activeState = @{}
    Write-Result -Result @{ ok = $true; message = "Active defaults cleared." }
    Send-LocalCommandNotification -CommandName $script:commandName -Detail "Active context cleared."
    break
  }

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
    $payload = $null
    if (-not [string]::IsNullOrWhiteSpace($BodyJson)) {
      $payload = $BodyJson
    } else {
      $payload = @{
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
    $payload = $null
    if (-not [string]::IsNullOrWhiteSpace($BodyJson)) {
      $payload = $BodyJson
    } else {
      $metadata = @{ source = "api" }
      $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $SlackChannel
      if (-not [string]::IsNullOrWhiteSpace($effectiveChannelId)) {
        $metadata.slack_channel = $effectiveChannelId
      }

  $obj = @{
        entry_point = $EntryPoint
        input = @{ description = $Description }
        metadata = $metadata
      }

      if (-not [string]::IsNullOrWhiteSpace($ExecutionMode)) {
        $obj.execution_mode = $ExecutionMode
      }

      $payload = $obj
    }

    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline" -BodyObject $payload
    break
  }

  "pipeline" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/$effectivePipelineId"
    break
  }

  "pipeline-list" {
    $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
    if ([string]::IsNullOrWhiteSpace($effectiveChannelId)) {
      throw "Missing required option: -ChannelId (or set one via active-set)"
    }

    $query = @{ channel_id = $effectiveChannelId; limit = $Limit }
    if (-not [string]::IsNullOrWhiteSpace($Status)) {
      $query.status = if ($Status -eq "all") {
        "running,awaiting_approval,paused_takeover,failed,complete,cancelled,awaiting_pr_review"
      } else { $Status }
    }
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/status-summary/by-channel" -Query $query
    break
  }

  "staged-phases" {
    $query = @{ limit = $Limit }
    $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
    if (-not [string]::IsNullOrWhiteSpace($effectiveChannelId)) {
      $query.channel_id = $effectiveChannelId
    }
    if (-not [string]::IsNullOrWhiteSpace($ProjectId)) {
      $query.project_id = $ProjectId
    }
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/staged/phases" -Query $query
    break
  }

  "staged-sprints" {
    $query = @{ limit = $Limit }
    $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
    if (-not [string]::IsNullOrWhiteSpace($effectiveChannelId)) {
      $query.channel_id = $effectiveChannelId
    }
    if (-not [string]::IsNullOrWhiteSpace($ProjectId)) {
      $query.project_id = $ProjectId
    }
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/staged/sprints" -Query $query
    break
  }

  "staged-tasks" {
    $query = @{ limit = $Limit }
    $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
    if (-not [string]::IsNullOrWhiteSpace($effectiveChannelId)) {
      $query.channel_id = $effectiveChannelId
    }
    if (-not [string]::IsNullOrWhiteSpace($ProjectId)) {
      $query.project_id = $ProjectId
    }
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/staged/tasks" -Query $query
    break
  }

  "pipeline-summary" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/$effectivePipelineId/status-summary"
    break
  }

  "pipeline-current" {
    $query = @{}
    $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
    if (-not [string]::IsNullOrWhiteSpace($effectiveChannelId)) {
      $query.channel_id = $effectiveChannelId
    }
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/status-summary/current" -Query $query
    break
  }

  "sprint" {
    # Resolve pipeline: explicit -PipelineId or fall back to the current active pipeline
    $resolvedPipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId
    if ([string]::IsNullOrWhiteSpace($resolvedPipelineId)) {
      $currentQuery = @{}
      $currentChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
      if (-not [string]::IsNullOrWhiteSpace($currentChannelId)) {
        $currentQuery.channel_id = $currentChannelId
      }
      Show-ActiveContextIfUsed
      $current = Invoke-RestMethod `
        -Method GET `
        -Uri (Build-Uri "/pipeline/status-summary/current" $currentQuery) `
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
        # Artifact not accessible (container restart or remote env) - fall back to first_task only
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
      Write-Host "Tasks (first task only - full plan artifact not accessible):"
      $ft     = $out.first_task
      $ftStat = $ft.status
      if ($completedTaskIds -contains $ft.task_id) {
        $ftStat = "completed"
      }
      Write-Host "  $($ft.task_id)  $($ft.title)  [$ftStat]"
    }

    Write-Host ""
    break
  }

  "pipeline-approve" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/approve" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-cancel" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/cancel" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-takeover" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/takeover" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-retry" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/retry" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-retry-op" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/ops/retry" -BodyObject @{ actor = $Actor }
    break
  }

  "pipeline-op-status" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Require-Value -Value $OperationId -Name "OperationId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/pipeline/$effectivePipelineId/ops/$OperationId"
    break
  }

  "pipeline-handoff" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    $payload = @{ actor = $Actor }
    if (-not [string]::IsNullOrWhiteSpace($ArtifactPath)) {
      $payload.artifact_path = $ArtifactPath
    }

    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/handoff" -BodyObject $payload
    break
  }

  "pipeline-skip" {
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId -Required
    Invoke-Adp -HttpMethod "POST" -RelativePath "/pipeline/$effectivePipelineId/skip" -BodyObject @{
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

  "admin-op-create" {
    $payload = @{
      action = $OpsAction
      actor = $Actor
    }

    $effectiveProjectId = $ProjectId
    $effectivePipelineId = Resolve-PipelineId -ExplicitPipelineId $PipelineId

    if (-not [string]::IsNullOrWhiteSpace($effectiveProjectId)) {
      $payload.project_id = $effectiveProjectId
    }

    if (-not [string]::IsNullOrWhiteSpace($effectivePipelineId)) {
      $payload.pipeline_id = $effectivePipelineId
    }

    $options = @{}
    if (-not [string]::IsNullOrWhiteSpace($Branch)) {
      $options.branch = $Branch
    }
    if (-not [string]::IsNullOrWhiteSpace($BaseBranch)) {
      $options.base_branch = $BaseBranch
    }
    if (-not [string]::IsNullOrWhiteSpace($HeadBranch)) {
      $options.head_branch = $HeadBranch
    }
    if ($options.Count -gt 0) {
      $payload.options = $options
    }

    $script:lastAdpResponse = $null
    Invoke-Adp -HttpMethod "POST" -RelativePath "/admin/ops" -BodyObject $payload
    $lastJobId = ""
    if ($null -ne $script:lastAdpResponse) {
      $opProp = $script:lastAdpResponse.PSObject.Properties["operation"]
      if ($null -ne $opProp -and $null -ne $opProp.Value) {
        $jobIdProp = $opProp.Value.PSObject.Properties["job_id"]
        $lastJobId = if ($null -ne $jobIdProp) { [string]$jobIdProp.Value } else { "" }
      }
    }
    if (-not [string]::IsNullOrWhiteSpace($lastJobId)) {
      Write-Host ""
      Write-Host "Operation queued. Poll for results:" -ForegroundColor Cyan
      Write-Host "  .\api-cli.bat admin-op-status -OperationId $lastJobId" -ForegroundColor Cyan
    }
    break
  }

  "admin-op-status" {
    Require-Value -Value $OperationId -Name "OperationId"
    Invoke-Adp -HttpMethod "GET" -RelativePath "/admin/ops/$OperationId"
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
    $payload = "{}"
    if (-not [string]::IsNullOrWhiteSpace($BodyJson)) {
      $payload = $BodyJson
    }
    Invoke-Adp -HttpMethod "POST" -RelativePath "/coordination/query" -BodyObject $payload
    break
  }

  "coord-archive" {
    Require-Value -Value $CoordinationId -Name "CoordinationId"
    Invoke-Adp -HttpMethod "DELETE" -RelativePath "/coordination/$CoordinationId"
    break
  }

  "dryrun-reset" {
    Require-Value -Value $RepoName -Name "RepoName"

    $repoRoot = $PSScriptRoot
    $cloneBase = Join-Path $repoRoot "runtime\git-clones"
    $repoPath = Join-Path $cloneBase $RepoName

    if (-not (Test-Path (Join-Path $repoPath ".git"))) {
      throw "No git repo found at '$repoPath'. Check -RepoName and ensure the repo is cloned under runtime/git-clones/."
    }

    Write-Host "Resetting dry-run sandbox repo: $RepoName" -ForegroundColor Cyan
    Write-Host "  Path: $repoPath"

    Push-Location $repoPath
    try {
      # Always operate on main so cleanup commits land on the canonical baseline
      git fetch origin | Out-Null
      git checkout main | Out-Null
      git reset --hard origin/main | Out-Null

      # Dirs that accumulate pipeline artifacts between runs
      $resetDirs = @(
        "project_work/ai_project_tasks/staged_phases",
        "project_work/ai_project_tasks/active",
        "project_work/ai_project_tasks/history"
      )

      $anyRemoved = $false

      foreach ($dir in $resetDirs) {
        $dirPath = Join-Path $repoPath $dir
        if (-not (Test-Path $dirPath)) { continue }

        # Find non-.gitkeep files tracked by git in this dir
        $tracked = @(git ls-files $dir 2>&1 | Where-Object { $_ -notmatch '\.gitkeep$' })
        if ($tracked.Count -gt 0) {
          Write-Host "  Removing from $dir`: $($tracked.Count) file(s)" -ForegroundColor Yellow
          foreach ($f in $tracked) {
            git rm -f $f | Out-Null
          }
          $anyRemoved = $true
        } else {
          Write-Host "  $dir - already clean"
        }

        # Restore .gitkeep if missing
        $gitkeep = Join-Path $dirPath ".gitkeep"
        if (-not (Test-Path $gitkeep)) {
          New-Item -ItemType File -Force -Path $gitkeep | Out-Null
          git add $gitkeep | Out-Null
          $anyRemoved = $true
        }
      }

      if ($anyRemoved) {
        git commit -m "chore(dryrun-reset): restore sandbox to known-good baseline"
        git push
        Write-Host ""
        Write-Host "Reset complete. Sandbox is ready for the next dry run." -ForegroundColor Green
      } else {
        Write-Host ""
        Write-Host "Nothing to reset — sandbox is already clean." -ForegroundColor Green
      }

      # Delete stale feature/* branches so the next run creates them fresh from main
      $remoteBranches = @(git branch -r 2>&1 | Where-Object { $_ -match 'origin/feature/' } |
        ForEach-Object { $_.Trim() -replace '^origin/', '' })
      if ($remoteBranches.Count -gt 0) {
        Write-Host ""
        Write-Host "  Deleting $($remoteBranches.Count) stale remote feature branch(es):" -ForegroundColor Yellow
        foreach ($b in $remoteBranches) {
          Write-Host "    - $b"
          git push origin --delete $b 2>&1 | Out-Null
        }
        # Clean up local tracking refs
        git fetch --prune | Out-Null
        foreach ($b in $remoteBranches) {
          git branch -D $b 2>&1 | Out-Null
        }
      } else {
        Write-Host "  No stale feature branches to delete."
      }
    } finally {
      Pop-Location
    }

    Write-Result -Result @{ ok = $true; repo = $RepoName; path = $repoPath }
    break
  }

  "request" {
    Require-Value -Value $Method -Name "Method"
    Require-Value -Value $Path -Name "Path"

    $effectivePath = $Path
    $isCurrentSummary = $effectivePath -match "^/pipeline/status-summary/current(\?.*)?$"
    $alreadyHasChannel = $effectivePath -match "[?&]channel_id="
    if ($isCurrentSummary -and -not $alreadyHasChannel) {
      $effectiveChannelId = Resolve-ChannelId -ExplicitChannelId $ChannelId
      if (-not [string]::IsNullOrWhiteSpace($effectiveChannelId)) {
        $sep = "?"
        if ($effectivePath.Contains("?")) {
          $sep = "&"
        }
        $effectivePath = "$effectivePath${sep}channel_id=$([uri]::EscapeDataString($effectiveChannelId))"
      }
    }

    $body = $BodyJson
    if ([string]::IsNullOrWhiteSpace($BodyJson)) {
      $body = $null
    }
    Invoke-Adp -HttpMethod $Method.ToUpperInvariant() -RelativePath $effectivePath -BodyObject $body
    break
  }

  default {
    Write-Host "Unknown command: $Command" -ForegroundColor Yellow
    Show-Usage
    exit 1
  }
}
