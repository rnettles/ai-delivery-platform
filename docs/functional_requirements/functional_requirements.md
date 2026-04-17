# Functional Requirements
## Governed AI Orchestration System

---

## 1. Governance Integration

- System SHALL load prompts, rules, and templates from Git
- System SHALL NOT duplicate governance rules in n8n or Postgres
- System SHALL reference governance artifacts via file paths

---

## 2. Intake & Workflow Initialization

- System SHALL accept Slack-based requests
- System SHALL normalize request into structured format
- System SHALL create workflow instance in Postgres
- System SHALL assign initial state = `received`

---

## 3. Planner Execution

- System SHALL load planner prompt and rules
- System SHALL load Phase and Sprint Plan templates
- System SHALL invoke LLM to produce structured JSON output
- System SHALL deterministically render artifacts into templates
- System SHALL persist artifacts in Git

---

## 4. Sprint Controller Execution

- System SHALL load sprint-controller prompt and rules
- System SHALL load Sprint Plan artifact
- System SHALL generate structured task definitions
- System SHALL render staged task artifacts in Git

---

## 5. Artifact Management

- System SHALL treat Git as source of truth
- System SHALL store only artifact references in Postgres
- System SHALL enforce artifact location conventions

---

## 6. Validation

### Level 1 (Phase 1)
- System SHALL validate artifact existence
- System SHALL validate required sections present

### Future
- Governance rule validation
- Semantic validation

---

## 7. State Management

- System SHALL track runtime state in Postgres
- System SHALL derive true state from Git artifacts
- System SHALL prevent transitions without valid artifacts

---

## 8. Human Interaction

- System SHALL support:
  - approve
  - reject
  - request_revision
- System SHALL pause workflow at approval boundaries

---

## 9. Execution Flexibility

- System SHALL support both human and AI execution
- System SHALL validate outcomes independent of actor
