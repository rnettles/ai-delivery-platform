# Governance Operator Runbook
## AI Delivery Platform - Platform Maintainer Guide

**Audience:** Platform maintainers who manage governance content, add roles, and operate the governance layer  
**Last updated:** 2026-04-19  
**See also:** [user-flow-runbook.md](user-flow-runbook.md) - developer-facing pipeline operations

---

## Overview

Governance content for automated pipeline roles lives in `platform/governance/` and is bundled into the Docker image at build time (ADR-025 Phase 1). Any change to governance content requires:

1. Edit the relevant file(s) under `platform/governance/`
2. Rebuild and push the Docker image
3. Redeploy the execution-service container
4. Verify with a test pipeline run

```
platform/governance/
  manifest.json               - governance version + content registry
  prompts/                    - role system prompts (one file per role)
  rules/                      - behavioral rules loaded by roles
  schemas/                    - JSON schemas for structured outputs
```

The `GovernanceService` resolves all content at runtime via `manifest.json`. The service caches the manifest in memory after first load, so a container restart is required to pick up changes.

---

## 1. Update a Role Prompt

**When:** Improving agent behavior, correcting output format, tightening scope of a role.

### Steps

1. **Edit the prompt file**

	```
	platform/governance/prompts/role-<rolename>.md
	```

	Prompts are plain Markdown. The entire file content is passed as the `system` message to the LLM.

2. **Bump the manifest version**

	Edit `platform/governance/manifest.json` and update the `version` field:

	```json
	{ "version": "2026.04.20" }
	```

3. **Rebuild and push the Docker image**

	From the repo root:

	```bat
	.\build-push-docker.bat
	```

	Or manually:

	```bash
	cd platform
	docker buildx build --no-cache --platform linux/amd64 \
	  -t isdevcr.azurecr.io/execution-service:phase1 \
	  --push -f backend-api/Dockerfile .
	```

4. **Redeploy the container**

	In Azure Portal or via Terraform, restart the `execution-service` Container App to pull the new image.

5. **Verify**

	Trigger a test pipeline run for the affected role. Confirm the execution record in Postgres shows the expected output format. Check the container logs for:

	```
	Governance manifest loaded { version: "2026.04.20", ... }
	```

---

## 2. Add a New Agent Role

**When:** Introducing a new capability into the pipeline (for example, a `reviewer` or `documenter` role).

### Steps

1. **Create the prompt file**

	```
	platform/governance/prompts/role-<newrole>.md
	```

	Define role purpose, input expectations, output format, behavioral rules, and handoff contract.

2. **Register the role in `manifest.json`**

	```json
	"roles": {
	  "new-role": { "prompt": "prompts/role-new-role.md" }
	}
	```

3. **Create the role script**

	```
	platform/backend-api/src/scripts/role-<newrole>.script.ts
	```

	Implement the `Script` interface. Load the system prompt via `governanceService.getPrompt("new-role")`. Write output artifacts via `artifactService`.

4. **Register the script in `ScriptRegistryService`**

	File: `platform/backend-api/src/services/script-registry.service.ts`

	```typescript
	import { NewRoleScript } from "../scripts/role-new-role.script";
	// ...
	this.register(new NewRoleScript());
	this.registerRoleBinding("new-role", "2026.04.20", "role.new-role", "2026.04.20");
	```

5. **Add to `ROLE_SEQUENCE` if it joins the default pipeline**

	File: `platform/backend-api/src/services/pipeline.service.ts`

	Insert the role in `ROLE_SEQUENCE`. Update `GATED_ROLES` if it requires approval and `NEXT_ROLE` for happy-path chaining.

	Also extend `PipelineRole` in `platform/backend-api/src/domain/pipeline.types.ts`.

6. **Add slash-command mapping (if Slack-accessible)**

	File: `platform/backend-api/src/workflow-logic/slack-ingress.logic.ts`

	Add the new command to `CREATE_MAP`, and sync the same change to the Guard and Parse node in `platform/workflow/slack-ingress.json`.

7. **Write an ADR**

	New roles are governance decisions. Add `docs/adr/adr-0NN-<role-name>-role.md` and update `docs/adr/index.md`.

8. **Rebuild, redeploy, verify**

	Follow Section 1, Steps 3-5.

---

## 3. Update a Behavioral Rule

**When:** Changing runtime loading behavior, gate conditions, handoff contract fields, or global agent constraints.

### Steps

1. **Identify the rule file**

	| Key in manifest | File | Roles that use it |
	|---|---|---|
	| `global` | `rules/global_rules.md` | All roles |
	| `runtime_loading` | `rules/runtime_loading_rules.md` | All roles |
	| `runtime_gates` | `rules/runtime_gates.md` | All roles |
	| `handoff_contract` | `rules/handoff_contract.md` | All roles (handoff JSON shape) |
	| `task_flags` | `rules/task_flags_contract.md` | Implementer, Verifier |

2. **Edit the rule file**

	Rules are plain Markdown loaded by role scripts alongside the system prompt.

3. **Assess behavioral impact**

	Identify which roles reference the rule and what behavior changes. Check downstream impacts (for example, Verifier reading Implementer outputs).

4. **Bump manifest version, rebuild, redeploy, verify**

	Follow Section 1, Steps 2-5.

---

## 4. Add or Update an Output Schema

**When:** Changing the JSON structure a role is expected to return, or adding a new governed output type.

### Steps

1. **Edit or create the schema file**

	```
	platform/governance/schemas/<name>.schema.json
	```

	Use strict JSON Schema where output determinism matters.

2. **Register schema in `manifest.json`**

	```json
	"schemas": {
	  "new_output": "schemas/new_output.schema.json"
	}
	```

3. **Update TypeScript interface**

	Update the role script interface (for example `PlannerPhasePlan` in `role-planner.script.ts`) to match.

4. **Update role prompt**

	Ensure prompt output instructions match the schema shape.

5. **Bump manifest version, rebuild, redeploy, verify**

	Follow Section 1, Steps 2-5.

---

## 5. Promote to Runtime Loading (Phase 2)

**When:** ADR-011 git-sync infrastructure is complete and governance should update without image redeploy.

This transitions from Phase 1 (bundled governance) to Phase 2 (Azure Files runtime governance).

### Prerequisites

- Azure Files mounted at `/mnt/repo` on the execution-service container
- Git sync keeps `/mnt/repo` in sync with the repository
- `GOVERNANCE_PATH=/mnt/repo/platform/governance`

### Steps

1. **Set environment variable**

	In Terraform or Azure Portal:

	```
	GOVERNANCE_PATH=/mnt/repo/platform/governance
	```

2. **Retain or remove Dockerfile `COPY`**

	Bundled governance is no longer authoritative in Phase 2. Keeping it as fallback during transition is acceptable.

3. **Implement drift detection**

	Compare running manifest version with mounted manifest version at startup and log drift.

4. **Update `GovernanceService` cache strategy**

	Replace indefinite in-memory cache with TTL or file watcher so runtime updates are picked up.

5. **Verify**

	Push a prompt change, confirm git-sync updates mount, run pipeline, confirm updated prompt behavior.

---

## Environment Setup Reference

### Execution-Service Environment Variables

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | Yes (non-dev) | Shared secret for `x-api-key` auth on execution service endpoints |
| `GOVERNANCE_PATH` | No | Defaults to `./governance`; set to `/mnt/repo/platform/governance` in Phase 2 |
| `ARTIFACT_BASE_PATH` | Yes | Path for artifact writes (Azure Files mount in production) |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_KEY` | Yes | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | No | Defaults to `gpt-4.1` |
| `GIT_REPO_URL` | Yes | Artifact repo URL for ADR-011 operations |
| `GIT_PAT` | Yes | Token for git operations |
| `GIT_CLONE_PATH` | No | Defaults to `/mnt/repo` |
| `DATABASE_URL` | Yes | Postgres connection string |
| `N8N_CALLBACK_URL` | Yes | n8n webhook URL for pipeline notifications |

---

## Slack App Setup

Yes: this operator runbook should include setup directions for slash commands and integration tasks.

### 1. Preferred: Create App From Manifest

Use Slack "Create an app" > "From a manifest" and paste the contents of:

`platform/workflow/slack-app-manifest.json` (recommended for Slack's JSON tab)

`platform/workflow/slack-app-manifest.yaml`

Ensure the manifest URLs point to your active n8n host (for example `n8n-dev.contoso.com`) before pasting.

If Slack shows a parser error at line 1 while you're on the JSON tab, do not paste YAML there. Either switch to the YAML tab or paste `slack-app-manifest.json` into the JSON tab.

The manifest configures:

- Slash commands: `/adp-plan`, `/adp-sprint`, `/adp-implement`, `/adp-verify`, `/adp-approve`, `/adp-takeover`, `/adp-handoff`, `/adp-status`
- Command request URL: `https://<n8n-host>/webhook/slack-events`
- Interactivity request URL: `https://<n8n-host>/webhook/slack-actions`
- Bot scopes: `commands`, `chat:write`

### 2. Import and Activate n8n Workflows

Import and activate:

- `platform/workflow/slack-ingress.json`
- `platform/workflow/slack-action-handler.json`
- `platform/workflow/pipeline-notifier.json`

### 3. Configure n8n API Key Header

All n8n HTTP nodes calling execution service must send:

```
x-api-key: <execution-service API_KEY>
```

Use n8n credentials or env vars, not hardcoded secrets.

### 4. Install Slack App

Install app to workspace and confirm commands are available in the target channel.

### 5. Fallback: Create From Scratch

If manifest import is unavailable, create from scratch and configure the same values:

- Slash command URL: `https://<n8n-host>/webhook/slack-events`
- Interactivity URL: `https://<n8n-host>/webhook/slack-actions`
- Scopes: `commands`, `chat:write`

---

## Quick Validation Commands

```bat
REM Build and push image from repo root
.\build-push-docker.bat
```

```powershell
# Validate manifest and referenced files
cd platform/governance
$manifest = Get-Content manifest.json | ConvertFrom-Json
$errors = @()
$manifest.roles.PSObject.Properties   | ForEach-Object { if (-not (Test-Path $_.Value.prompt)) { $errors += "MISSING: $($_.Value.prompt)" } }
$manifest.rules.PSObject.Properties   | ForEach-Object { if (-not (Test-Path $_.Value))         { $errors += "MISSING: $($_.Value)" } }
$manifest.schemas.PSObject.Properties | ForEach-Object { if (-not (Test-Path $_.Value))         { $errors += "MISSING: $($_.Value)" } }
if ($errors.Count -eq 0) { "OK: all manifest references resolve" } else { $errors }
```

After push, restart execution-service Container App to load the new image.
