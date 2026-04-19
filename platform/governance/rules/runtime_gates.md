# Runtime Execution Gates

## Purpose

Canonical execution-gate reference for the automated pipeline implementation, verification, and fix loops.

## Required Gates

All implementation tasks must pass before the Verifier runs:

1. **lint** — static analysis on changed files
2. **typecheck** — type correctness on changed files
3. **tests** — relevant unit and integration tests for touched behavior

## Gate Evaluation

- Gates are evaluated by the Verifier role against the implementation summary and test evidence.
- The Verifier FAILS the task if any gate is not represented in the implementation evidence.
- The Fixer must address gate failures before the Verifier re-runs.

## Implementation Scope Gates

- Maximum 5 files changed per task (standard mode).
- Maximum 200 lines of code per task (standard mode).
- Each file change must trace to at least one acceptance criterion.

## Output Evidence

The implementation summary must include a `test_approach` field describing:
- What test types were used (unit, integration, e2e)
- What specific behaviors were tested
- Which acceptance criteria each test covers
