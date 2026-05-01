# Sprint PR Review Checklist

> **This PR was opened automatically by the AI Delivery Platform sprint close-out process.**  
> Review the changes below and merge when satisfied. Merging this PR is the approval signal — the
> platform detects the merge via polling and advances the pipeline automatically.
>
> See [workflow-process-runbook.md](../docs/runbook/workflow-process-runbook.md#pr-review--approval) for full guidance.

---

## Review Checklist

### 1 — Scope and Traceability
- [ ] PR title and body reference the correct Sprint ID and Task ID(s)
- [ ] All changed files fall within the declared task scope (no unexpected files)
- [ ] Each change traces to an acceptance criterion in `AI_IMPLEMENTATION_BRIEF.md`

### 2 — Code Quality
- [ ] Code is readable and follows existing conventions in the codebase
- [ ] No hardcoded secrets, credentials, or environment-specific values
- [ ] No debugging artifacts left in (e.g., `console.log`, commented-out blocks, `TODO: remove`)
- [ ] Complexity is appropriate for the task — no over-engineering

### 3 — Test Coverage
- [ ] New or changed behaviour has corresponding tests
- [ ] Verifier PASS is confirmed (shown in PR body — "Verifier summary")
- [ ] No existing tests were deleted or disabled without explanation

### 4 — Governance
- [ ] Changes do not alter an Accepted ADR without a superseding ADR in place
- [ ] Changes do not modify human-gated approval logic or status fields
- [ ] No AI-authored artifact has its status promoted beyond `Draft` / `Proposed`

---

## Approving the Change

**To approve:** Review the diff, satisfy the checklist above, then click **Merge pull request**.  
The platform detects the merge and closes the pipeline run automatically.

**To request changes:** Add a review comment on the PR using GitHub's review interface.  
The pipeline remains in `awaiting_pr_review` until the PR is merged. A human can use
`/takeover <pipeline-id>` in Slack to take ownership, make corrections, push commits to this
branch, and then merge when ready.

**To escalate:** If the implementation is fundamentally wrong, close the PR without merging and
create a new intake item to plan corrective work.
