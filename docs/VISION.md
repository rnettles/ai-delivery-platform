# Vision
## Governed AI Software Development Orchestration Platform

---

## What This Is

This platform is a **governed, hybrid AI/human software development system** that automates the software delivery lifecycle while keeping humans in control at every meaningful decision point.

It is not a code generator. It is not a chatbot. It is a **disciplined delivery engine** that enforces architectural integrity, maintains full traceability, and safely accelerates development through a structured pipeline of specialized AI agents — each bounded by explicit governance rules.

---

## The Core Problem

AI-assisted development today is fragmented and dangerous:

- AI agents drift from architecture and design intent
- Outputs are untracked, unversioned, and unvalidated
- There is no consistent handoff between planning, implementation, and verification
- Humans either over-supervise (defeating the value of AI) or under-supervise (accepting unreviewed outputs)
- There is no safe way to say: "AI, take this task end-to-end while I review the plan and the result"

---

## The Vision

A software engineer or architect should be able to:

1. Describe what they want to build — in plain language, in Slack
2. Watch the system plan, implement, verify, and close the work — following their own defined governance rules
3. Intervene at any step — review a plan, take over an implementation, approve a result, or hand back to the pipeline
4. Trust the output — because every step is traceable, every artifact is versioned, and every rule was enforced

This system makes that possible.

---

## The Agent Pipeline

The platform executes work through a governed pipeline of specialized roles. Each role has a single responsibility and hands off to the next via a structured contract.

```
Human Request (Slack or API)
        │
        ▼
   ┌─────────┐
   │ Planner │  Reads PRD + FRs + Architecture → produces Phase Plan
   └────┬────┘
        │  human gate: approve plan or take over
        ▼
┌──────────────────┐
│ Sprint Controller│  Derives Sprint Plans + Task Briefs from Phase Plan
└────────┬─────────┘
         │  human gate: approve sprint or take over
         ▼
   ┌─────────────┐
   │ Implementer │  Executes tasks, writes code, commits artifacts
   └──────┬──────┘
          │  human gate: review code or take over
          ▼
    ┌──────────┐
    │ Verifier │  Checks output against spec, runs tests, gates quality
    └─────┬────┘
          │
    ┌─────┴──────┐
    │            │
  PASS          FAIL
    │            │
    │       ┌────▼────┐
    │       │  Fixer  │  Addresses verifier findings
    │       └────┬────┘
    │            │ (loops back to Verifier)
    │            ▼
    └──► Sprint Controller (task close-out, stage next task)
```

At every gate, the human can:
- **Approve** — pipeline continues automatically
- **Take over** — pipeline pauses, human performs the step
- **Hand off** — human signals completion, pipeline resumes
- **Skip** — advance past a step with recorded justification

The human can also enter the pipeline at any role directly:
- `/implement TASK-001` — enter at Implementer for a known task
- `/verify TASK-001` — run Verifier on existing work
- `/plan "Build the auth module"` — full pipeline from Planner

---

## Design Principles

### 1. Governance lives in Git
All prompts, rules, templates, schemas, and role definitions live in the AI governance repository. The platform reads them; it never hardcodes them.

### 2. Artifacts are truth
System state is derived from what artifacts exist and whether they are valid. Not from database records, not from what the system "thinks" happened.

### 3. Deterministic over LLM
Every step that can be deterministic is deterministic. LLMs are called only within bounded, schema-validated execution steps. LLM outputs never control workflow logic.

### 4. Humans approve; automation proposes
AI proposes plans, code, and decisions. Humans approve them. Execution enforces them. The system never forces a human to accept an AI output.

### 5. Every execution is observable and replayable
Every governed execution produces an immutable record: who ran what, at which version, with which input, producing which output. Any execution can be replayed.

### 6. Interface is not execution
Slack, n8n, and any future interface are pure I/O layers. They never embed business logic, governance rules, or execution decisions. All intelligence lives inside the Execution Service.

---

## System Components

| Component | Role | Technology |
|---|---|---|
| Execution Service | Governs all agent execution, enforces contracts, stores records | TypeScript + Express, Azure Container Apps |
| n8n | Orchestrates pipeline sequencing, manages Slack I/O | n8n, Azure Container Apps |
| Slack | Human interaction surface — commands, approvals, notifications | Slack (via n8n credentials) |
| Azure OpenAI | LLM reasoning layer for all agent roles | Azure OpenAI (gpt-4.1) |
| PostgreSQL | Pipeline run state, execution records, coordination context | Azure PostgreSQL Flexible Server |
| Azure Files | Persistent repo storage for governance artifacts and project files | Azure Files (mounted in containers) |
| Git (AI Governance) | Single source of truth for rules, prompts, templates | Git repository |

---

## What Gets Built — Platform Capabilities

### Delivered in phases:

**Phase 1 — Pipeline Foundation**
Pipeline run entity, state machine, API contract for pipeline operations. Planner role functional. No Slack yet — API-driven only.

**Phase 2 — Slack Ingress**
n8n Slack ingress workflow. Slash commands parsed and routed to `/pipeline`. Initial acknowledgement in Slack thread.

**Phase 3 — Human Gates and Interactive Messages**
Interactive Slack messages with action buttons at each gate. Approve/take-over/hand-off mechanics. n8n pipeline-notifier workflow.

**Phase 4 — Full Agent Pipeline**
Sprint Controller, Implementer, Verifier, Fixer roles implemented. Azure OpenAI integration. Git artifact read/write. End-to-end pipeline operational.

**Phase 5 — Production Hardening**
Terraform secrets management, monitoring, error recovery, multi-project support.

---

## Success Criteria

The platform is successful when:

- A human can describe a feature in Slack and receive a governed phase plan in under 5 minutes
- A human can approve that plan and watch the system stage and implement the first sprint task
- Every output is traceable from request to artifact to commit
- A human can pause, take over, and resume the pipeline without breaking state
- A new project can be onboarded by pointing the system at a governance repo and a project repo

---

## What This Is Not

- It is not a fully autonomous coding agent. Humans remain in the loop.
- It is not a replacement for VSCode, Copilot, or developer tooling.
- It is not a general-purpose LLM chatbot.
- It is not a fixed workflow. Any step can be human-performed or AI-performed, and the pipeline adapts.
