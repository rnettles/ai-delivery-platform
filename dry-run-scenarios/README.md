# Dry-run scenarios

Synthetic LLM responses for end-to-end workflow validation. When the backend-api
runs with `DRY_RUN=1`, every `llmFactory.forRole()` call returns the
`MockLlmProvider`, which produces deterministic role-shaped responses driven by
the active scenario. Real git, GitHub, Slack, DB, and artifact-FS writes stay
**LIVE** — point them at a sandbox repo + non-production Slack channel.

## Activation

```powershell
# From repo root — wraps start-local-server.ps1 with DRY_RUN=1
.\start-local-server.dryrun.ps1
```

By default this loads [happy-path.json](happy-path.json). Override via:

```powershell
$env:DRY_RUN_SCENARIO_PATH = "dry-run-scenarios\verifier-fail-then-pass.json"
.\start-local-server.dryrun.ps1
```

Confirm activation:

```powershell
curl http://localhost:3000/health/dry-run
# { "dry_run": true, "scenario": { "name": "happy-path", ... } }
```

### Optional: sandbox repo guard

Set `DRY_RUN_REPO_ALLOWLIST` to a regex; boot fails fast if `GIT_REPO_URL`
doesn't match. Recommended:

```powershell
$env:DRY_RUN_REPO_ALLOWLIST = "(sandbox|dry-run|test)"
```

## Bundled scenarios

| Scenario | Behavior |
|---|---|
| [happy-path.json](happy-path.json) | All roles PASS. Full sprint reaches `awaiting_pr_review`. |
| [verifier-fail-then-pass.json](verifier-fail-then-pass.json) | Verifier FAILs once → implementer retries → second verifier PASSes. |
| [verifier-fail-limit.json](verifier-fail-limit.json) | Verifier FAILs 3× → pipeline halts in `paused_takeover` at `MAX_IMPLEMENTER_ATTEMPTS`. |

## Driving a scenario through the existing CLI

The dry-run mode uses the **real** pipeline state machine — drive it with the
same commands you use in production:

```powershell
# 1. Kick off a full-sprint planner pipeline
adp pipeline-create `
  --entry-point planner `
  --execution-mode full-sprint `
  --description "dry-run smoke test"

# 2. Watch it roll forward (state transitions are real)
adp pipeline-status

# 3. For "next" mode, advance manually
adp pipeline-handoff
adp pipeline-approve
```

## Per-pipeline directive override

Override the loaded scenario for a single pipeline by passing
`--dry-run-directive`:

```powershell
adp pipeline-create `
  --entry-point planner `
  --execution-mode full-sprint `
  --description "force a thrown verifier" `
  --dry-run-directive '{ "steps": [{ "match": { "role": "verifier", "occurrence": 1 }, "outcome": "throw", "error": { "code": "BOOM", "message": "synthetic" } }] }'
```

The directive is merged on top of the loaded scenario for that pipeline only;
other pipelines on the same server continue using the loaded scenario.

## Scenario file shape

```jsonc
{
  "name": "my-scenario",
  "description": "...",
  "default_outcome": "pass",   // applied when no step matches
  "steps": [
    {
      "match": {
        "role": "verifier",          // required
        "call_type": "phase-plan",   // optional sub-call discriminator
        "occurrence": 2              // optional 1-based counter per (pipeline, role, call_type)
      },
      "outcome": "pass" | "fail" | "throw",
      "reason": "human-readable note (used in verifier FAIL summary)",
      "fixture_overrides": { "...": "deep-merged onto the default fixture" },
      "error": { "code": "...", "message": "..." }   // when outcome=throw
    }
  ]
}
```

### Known `call_type` values

| Role | `call_type` |
|---|---|
| `planner` | `phase-plan`, `sprint-plan` |
| `sprint-controller` | `setup` |
| `verifier` | _(unset)_ |
| `implementer` | `agent-loop` (uses `chatWithTools`, not `chatJson`) |

## What's NOT mocked

Live: git operations against `GIT_REPO_URL`, GitHub API (PR create/merge),
Slack notifications, the Drizzle DB (`pipeline_runs`), and artifact filesystem
writes. The implementer mock writes a real stub file (`dry-run-stub.txt`)
into the cloned repo so verifier and git see actual changes.
