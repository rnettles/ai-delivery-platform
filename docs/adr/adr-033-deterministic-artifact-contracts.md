# ADR-033: Deterministic Artifact Contracts and Script-Side Housekeeping

## Status
Accepted

## Date
2026-04-30

## Deciders
- Platform Architecture
- Product Engineering

---

## Context

The implementer role runs an agentic LLM loop (up to 30 iterations) to implement a task, run
quality gates, and call `finish`. When the loop hits MAX_ITERATIONS or fails gates repeatedly,
subsequent retries restart from scratch — the LLM re-reads the implementation brief cold and
produces the same incorrect output again.

Root-cause analysis of the PHKS S01-001 tailwind token loop identified three systemic failures:

**RC-1: Prior-run context is gate-only, not file-state-aware.**
`loadPriorRunContext` reported gate exit codes and up to 600 chars of stderr. It did not surface
what files were already written to the branch. The LLM had no ground truth about what existed
and repeatedly regenerated the same wrong values.

**RC-2: Verifier corrections were never loaded by the implementer.**
The verifier writes `verification_result.json` to the repo including `required_corrections[]`
and per-check `failure_detail`. The implementer's context assembly did not read this file.
On retry after a verifier FAIL the implementer had no signal about which checks failed or why.

**RC-3: Referenced design documents were not auto-injected.**
The implementation brief referenced ADR-007 for canonical brand-token hex values. The
implementer's staged-retrieval rules only load an ADR when `architecture_contract_change=true`.
Since that flag was false for a Tailwind task, the ADR was never read and the LLM hallucinated
plausible-sounding but incorrect hex values from training data on every cold start.

Beyond the retry loop problem, a broader design asymmetry was identified:

- **The verifier** already follows the correct pattern: deterministic script-side evaluation for
  checks 1, 7, 8, 9 (filesystem + CI commands); LLM judgment for checks 2–6, 10 (governance).
  State fields are written exclusively by the script; the LLM writes narrative.

- **The implementer** does not follow this pattern. It hands the LLM a pile of raw documents
  and relies on LLM interpretation for inputs that a parser can handle reliably: checking what
  files are already on the branch, parsing which verifier corrections are required, reading the
  canonical values from design references, and writing commit messages.

This asymmetry wastes approximately 5–7k tokens per retry iteration and makes implementer
behaviour non-reproducible across runs. It also means the system is incapable of structured
cross-session recovery: when an agent hits MAX_ITERATIONS mid-task, the next run has no
structured record of what the prior run was trying to do or where it stopped.

---

## Decision

All implementer-facing artifacts SHALL have a **hybrid schema**: deterministic state fields
owned exclusively by the script; tagged narrative sections written by the LLM. Scripts SHALL
pre-compute all facts that can be derived without LLM judgment and inject them as structured
inputs rather than raw documents. The LLM SHALL receive pre-parsed directives, not documents
to interpret.

The verifier's `verification_result.json` is the reference pattern and SHALL NOT be changed.

---

## Core Principle

> The script is the only writer for state fields.
> The LLM writes narrative.
> Every artifact has a stable schema with deterministic and flexible regions.

---

## Artifact Schema Contracts

### `AI_IMPLEMENTATION_BRIEF.md`

**Current state**: mostly freeform markdown; only `## Task Flags` is structurally parsed.

**Required change**: define stable tagged sections that script parsers can locate reliably.
The brief template SHALL contain exactly these sections (additional sections permitted):

| Section header | Content | Writer | Parser |
|---|---|---|---|
| `## Task Flags` | key:value pairs | Sprint Controller (script) | Both scripts |
| `## Acceptance Criteria` | checkbox list `- [ ] <text>` | Sprint Controller (script) | Implementer script |
| `## Design References` | relative file paths, one per line | Sprint Controller (script) | Implementer script |
| `## Canonical Values` | verbatim block from referenced ADR/TDN | Sprint Controller (script, copied verbatim) | Implementer script |
| `## Deliverables Checklist` | checkbox list with file paths | Sprint Controller (script) | Verifier script |

The `parseBrief()` helper SHALL extract all five sections and return typed structures. It SHALL
be shared between the implementer and verifier scripts.

### `test_results.json`

**Current state**: `{ task_id, sprint_id, executed_at, stop_reason, gate_results[], summary }`.

**Required additions** (all script-written):

```jsonc
{
  // existing fields unchanged
  "iteration_count": 14,         // incremented by script each iteration
  // fields populated from last set_progress call:
  "current_focus": "string",
  "open_todos": ["string"],
  "blockers": ["string"],
  "planned_next_action": "string"
}
```

The last four fields are populated by the `set_progress` tool handler (script-side write);
the LLM provides the values by calling the tool.

### `progress.json` (new artifact)

A cross-session continuity file, written to the repo at
`project_work/ai_project_tasks/active/progress.json`.

Schema:

```jsonc
{
  "pipeline_id": "string",
  "task_id": "string",
  "iteration_count": 14,
  "current_focus": "string",
  "open_todos": ["string"],
  "blockers": ["string"],
  "planned_next_action": "string",
  "last_checkpoint_at": "ISO 8601"
}
```

Written by the `set_progress` tool handler (script), also written to the stable checkpoint
path (`_checkpoints/<key>.json`) outside the git repo for recovery when a git commit fails.
Loaded by `loadProgressArtifact()` at the start of each run and injected as a structured
`## Prior Run State` section — not as a raw document.

### `verification_result.json`

No change. Already follows the correct pattern. Serves as the reference design for this ADR.

### `current_task.json`

**Current state**: `status` field is written by the implementer LLM (indirectly, via
`buildUpdatedTaskArtifact`).

**Required change**: status transitions SHALL be validated against the allowed lifecycle state
machine at the script layer before writing. Invalid transitions are rejected and logged; the
prior status is preserved.

Allowed transitions:
- `active` → `ready_for_verification`
- `ready_for_verification` → `verified` (written by sprint controller)
- `ready_for_verification` → `needs_fixes` (written by verifier on FAIL)

### Commit messages

**Current state**: LLM generates the full commit message text.

**Required change**: script templates the message from deterministic inputs:

```
feat(<task_id>): <summary>

Files changed:
- Create: <path>
- Modify: <path>
```

The LLM contributes only the `summary` string (one sentence, from the `finish` tool call).
The file list and prefix are assembled by the script.

---

## Script-Side Housekeeping Changes

### Auto-inject referenced design documents

After `parseBrief()` extracts `designRefs[]`, the script SHALL read each referenced file from
the repo and inject its content into the LLM context as `# Design Reference: <relpath>`.

Rules:
- Total injected reference content capped at 6000 chars; ADR files prioritized when truncating.
- Files that do not exist are skipped with a warning (not an error).
- Fires unconditionally — no flag required. The brief author controls inclusion by populating
  `## Design References`.

This replaces the prior approach of prompting the LLM to "read the ADR before coding."

### Structured prior-run context (replaces text-dump approach)

Three script-computed facts replace the prior text-dump approach:

**`computeChangedFiles(clonePath, sprintBranch)`**
Runs `git diff --name-only <merge-base> HEAD` and returns `{ path, status }[]`.
Injected as a fact list (`**Files already on branch**: [...]`), not as raw diff output.
Allows the LLM to skip re-implementing files already present.

**`extractCorrections(clonePath)`**
Reads `verification_result.json`. When `result === "FAIL"`, returns a numbered directive list:

```
You MUST address these N corrections before calling finish:
1. [check_name]: [failure_detail] → [required_correction]
```

Returns null when `result === "PASS"` or file is absent. This is a directive, not a document.

**`loadProgressArtifact(clonePath)`**
Reads `progress.json` and formats it as a structured `## Prior Run State` block.
Returns null on first run (file absent).

### `set_progress` tool

A new tool exposed to the implementer LLM:

```jsonc
{
  "name": "set_progress",
  "parameters": {
    "current_focus": "string",
    "open_todos": ["string"],
    "blockers": ["string"],
    "planned_next_action": "string"
  }
}
```

The tool handler writes `progress.json` to both the repo and the stable checkpoint path.
The tool is optional — not required to call `finish` — but the pre-MAX warning forces it.

### Pre-MAX_ITERATIONS soft warning

At iteration 25 of 30, the script SHALL inject a synthetic user message into the conversation:

> "5 iterations remaining. Call set_progress with your current focus, open todos, blockers,
> and planned next action before continuing so the next run can resume from where you left off."

This ensures the final `progress.json` state reflects the LLM's actual intent, not a
synthesized fallback.

On MAX_ITERATIONS exit, the script writes a fallback `progress.json` from the last
`set_progress` call if available; synthesizes a minimal record otherwise.

### Token optimization

Replacing raw document injection with script-computed structured facts reduces LLM context
on implementer retries. Expected savings per retry iteration:

| Change | Approx tokens saved |
|---|---|
| Pre-parsed brief sections (not re-narrated) | ~2 000 |
| Auto-injected design refs (targeted, capped) | ~1 500 |
| `computeChangedFiles` replaces directory exploration | ~1 500 |
| `extractCorrections` replaces raw JSON injection | ~500 |
| Script-templated commit messages | ~200 |
| **Total** | **~5 700 per retry** |

---

## Consequences

### Benefits

- **Reproducibility**: state transitions are deterministic; LLM judgment is contained to
  narrative sections and implementation choices.
- **Recovery**: structured `progress.json` survives MAX_ITERATIONS, retries, crashes, and
  pipeline restarts. The next run resumes from a known state instead of starting cold.
- **Debuggability**: every artifact has a stable schema that can be validated, diffed, and
  logged without parsing freeform text.
- **Token efficiency**: ~5 700 fewer context tokens per retry, compounding across retries.
- **Verifier corrections are actionable**: implementer receives explicit numbered directives,
  not a document to interpret.
- **Design references are reliable**: canonical values from ADRs/TDNs are injected verbatim
  by the script — hallucination of design token values is eliminated.

### Trade-offs

- **Brief template is now more structured**: existing briefs without the new tagged sections
  continue to work (safe defaults). New briefs must follow the template. Sprint Controller
  script must populate the new sections when staging.
- **`set_progress` is optional**: the pre-MAX warning is the forcing function. A run that
  never calls `set_progress` still checkpoint-commits gate results (existing behaviour).
- **`## Canonical Values` requires brief author to copy verbatim from ADR**: this is
  intentional — it makes the brief self-contained and eliminates the ADR-read dependency at
  implementation time.

### What is deliberately excluded

- Changing the verifier's 10-check pipeline (already follows the correct pattern).
- Changing the fixer agent's behaviour (separate execution path; benefits from shared helpers
  as a follow-on).
- Full conversation transcript capture (too noisy and expensive; `progress.json` captures
  structured intent, not raw history).

---

## Related ADRs

- **ADR-002**: Artifact-Driven State — this ADR extends the principle to implementer-facing
  artifacts with hybrid deterministic/flexible schemas.
- **ADR-003**: Deterministic Over LLM — this ADR strengthens enforcement by moving state
  writes and context computation to the script layer.
- **ADR-018**: Execution Determinism — this ADR applies the same guarantees to the
  implementer's artifact lifecycle and cross-session recovery.
- **ADR-025**: Two-Tier Governance Composition — the `parseBrief()` helper shared between
  implementer and verifier is consistent with shared governance primitives.
- **ADR-031**: Three-Layer Governance Authority — state field ownership (script only) is a
  direct application of the script-layer authority tier.
