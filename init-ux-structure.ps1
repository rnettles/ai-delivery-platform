# init-docs-structure.ps1
# Initializes UX + frontend design documentation structure

param(
    [string]$BasePath = "docs"
)

function Ensure-Dir($path) {
    if (!(Test-Path $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
    }
}

function Ensure-File($path, $content) {
    if (!(Test-Path $path)) {
        $content | Out-File -FilePath $path -Encoding utf8
    }
}

Write-Host "Initializing documentation structure in '$BasePath'..."

# -------------------------
# Root folders
# -------------------------
$paths = @(
    "$BasePath/ux/views",
    "$BasePath/ux/flows",
    "$BasePath/ux/states",
    "$BasePath/ux/components",
    "$BasePath/ux/concepts",
    "$BasePath/ux/decisions",
    "$BasePath/frontend",
    "$BasePath/execution-spec",
    "$BasePath/system-mapping",
    "$BasePath/roadmap"
)

foreach ($p in $paths) {
    Ensure-Dir $p
}

# -------------------------
# UX README
# -------------------------
Ensure-File "$BasePath/ux/README.md" @"
# UX System

Defines the user experience for the AI orchestration control plane.

Focus:
- Pipeline execution visibility
- Control surface for human-in-the-loop workflows
- Artifact-driven UI

This folder is the source of truth for UX behavior and structure.
"@

# -------------------------
# Views
# -------------------------
Ensure-File "$BasePath/ux/views/pipeline-detail.md" @"
# View: Pipeline Detail

## Purpose
Primary control surface for pipeline execution.

## Responsibilities
- Display pipeline timeline
- Show step states and artifacts
- Provide execution controls

## Notes
This is the most critical UI surface.
"@

Ensure-File "$BasePath/ux/views/pipeline-list.md" @"
# View: Pipeline List

## Purpose
Display pipelines for a selected project.

## Responsibilities
- Show pipeline status
- Enable navigation to detail view
"@

Ensure-File "$BasePath/ux/views/project-detail.md" @"
# View: Project Detail

## Purpose
Represents execution context (repo + Slack).

## Responsibilities
- Show metadata
- Entry point for pipeline creation
"@

Ensure-File "$BasePath/ux/views/global-layout.md" @"
# View: Global Layout

## Purpose
Defines overall application structure.

## Includes
- Project selector
- Navigation
- Layout regions
"@

# -------------------------
# Flows
# -------------------------
Ensure-File "$BasePath/ux/flows/pipeline-execution.md" @"
# Flow: Pipeline Execution

## Description
End-to-end lifecycle of a pipeline.

## Steps
Define execution stages and transitions.
"@

Ensure-File "$BasePath/ux/flows/pipeline-failure.md" @"
# Flow: Pipeline Failure

## Description
Behavior when a pipeline step fails.

## Focus
- Error surfacing
- Retry handling
"@

Ensure-File "$BasePath/ux/flows/pipeline-approval.md" @"
# Flow: Pipeline Approval

## Description
Human-in-the-loop approval step.

## Actions
- Approve
- Takeover
- Skip
"@

# -------------------------
# States
# -------------------------
Ensure-File "$BasePath/ux/states/pipeline-state.md" @"
# State: Pipeline

## Description
Defines pipeline lifecycle states.

## Includes
- running
- awaiting_approval
- failed
- complete
"@

Ensure-File "$BasePath/ux/states/execution-state.md" @"
# State: Execution

## Description
Represents individual step execution state.
"@

Ensure-File "$BasePath/ux/states/ui-state-mapping.md" @"
# State Mapping

## Purpose
Maps backend states to UI behavior.

## Example
running → disable actions
"@

# -------------------------
# Components
# -------------------------
Ensure-File "$BasePath/ux/components/pipeline-timeline.md" @"
# Component: Pipeline Timeline

## Purpose
Visual representation of pipeline steps.

## Notes
Core UI component.
"@

Ensure-File "$BasePath/ux/components/step-card.md" @"
# Component: Step Card

## Purpose
Represents a single pipeline step.

## Includes
- status
- artifacts
- actions
"@

Ensure-File "$BasePath/ux/components/artifact-viewer.md" @"
# Component: Artifact Viewer

## Purpose
Displays pipeline artifacts.

## Supports
- JSON
- text
"@

Ensure-File "$BasePath/ux/components/project-selector.md" @"
# Component: Project Selector

## Purpose
Switch active project context.
"@

Ensure-File "$BasePath/ux/components/action-bar.md" @"
# Component: Action Bar

## Purpose
Displays available pipeline actions.

## Actions
- approve
- retry
- skip
- takeover
"@

# -------------------------
# Concepts
# -------------------------
Ensure-File "$BasePath/ux/concepts/pipeline.md" @"
# Concept: Pipeline

Represents a governed execution workflow.
"@

Ensure-File "$BasePath/ux/concepts/project.md" @"
# Concept: Project

Defines execution context (repo + Slack).
"@

Ensure-File "$BasePath/ux/concepts/artifact.md" @"
# Concept: Artifact

Represents system output and source of truth.
"@

Ensure-File "$BasePath/ux/concepts/execution.md" @"
# Concept: Execution

Represents a single role or script run.
"@

Ensure-File "$BasePath/ux/concepts/spec-origin.md" @"
# Concept: Spec Origin

Tracks origin of pipeline execution.

## Includes
- source type
- reference
"@

# -------------------------
# Decisions
# -------------------------
Ensure-File "$BasePath/ux/decisions/ux-001-timeline-over-logs.md" @"
# UX Decision 001

## Title
Timeline over logs

## Rationale
Structured view improves clarity over raw logs.
"@

Ensure-File "$BasePath/ux/decisions/ux-002-project-as-context.md" @"
# UX Decision 002

## Title
Project as execution context

## Rationale
Pipelines must be scoped to repository + Slack context.
"@

Ensure-File "$BasePath/ux/decisions/ux-003-no-spec-authoring.md" @"
# UX Decision 003

## Title
No spec authoring in UI

## Rationale
Specs remain external (ChatGPT, Confluence).
"@

# -------------------------
# Frontend
# -------------------------
Ensure-File "$BasePath/frontend/README.md" @"
# Frontend Architecture

Defines implementation strategy for UI layer.
"@

Ensure-File "$BasePath/frontend/architecture.md" @"
# Frontend Architecture

## Stack
- Next.js
- React Query

## Structure
Feature-based organization.
"@

Ensure-File "$BasePath/frontend/data-fetching.md" @"
# Data Fetching

## Strategy
Use React Query with polling.

## Notes
Avoid direct API calls from client.
"@

Ensure-File "$BasePath/frontend/api-proxy.md" @"
# API Proxy

## Purpose
Secure backend communication.

## Pattern
Next.js route handlers.
"@

Ensure-File "$BasePath/frontend/state-management.md" @"
# State Management

## Principles
- Server state via React Query
- Minimal client state
"@

Ensure-File "$BasePath/frontend/component-architecture.md" @"
# Component Architecture

## Layers
- UI primitives
- composites
- screens
"@

# -------------------------
# Execution Spec (Future)
# -------------------------
Ensure-File "$BasePath/execution-spec/README.md" @"
# Execution Spec

Future layer for machine-readable specs.
"@

Ensure-File "$BasePath/execution-spec/schema.md" @"
# Execution Spec Schema

Defines structured format for execution inputs.
"@

Ensure-File "$BasePath/execution-spec/mapping.md" @"
# Spec Mapping

Maps PRD → execution structure.
"@

# -------------------------
# System Mapping
# -------------------------
Ensure-File "$BasePath/system-mapping/api-to-ux.md" @"
# API to UX Mapping

Maps endpoints to UI components.
"@

Ensure-File "$BasePath/system-mapping/state-to-ui.md" @"
# State to UI Mapping

Defines how backend states map to UI behavior.
"@

Ensure-File "$BasePath/system-mapping/artifact-mapping.md" @"
# Artifact Mapping

Defines how artifacts are rendered in UI.
"@

# -------------------------
# Roadmap
# -------------------------
Ensure-File "$BasePath/roadmap/ui-evolution.md" @"
# UI Evolution

## Phases
- V1: pipeline control
- V2: spec integration
"@

Ensure-File "$BasePath/roadmap/tech-debt.md" @"
# Technical Debt

Tracks known shortcuts and future improvements.
"@

Write-Host "Documentation structure initialized successfully."