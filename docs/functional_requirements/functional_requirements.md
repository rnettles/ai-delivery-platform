# Functional Requirements

## 1. Intake & Routing
- System shall accept requests from Slack
- System shall normalize requests into structured format
- System shall create workflow instance in Postgres

## 2. Governance Integration
- System shall load prompts, rules, templates from Git
- System shall not duplicate governance rules in n8n or DB

## 3. Planner Execution
- System shall invoke planner role
- System shall generate Phase artifact
- System shall generate Sprint Plan artifact

## 4. Sprint Controller Execution
- System shall invoke sprint-controller role
- System shall generate staged task artifacts

## 5. Artifact Management
- System shall persist artifacts in Git
- System shall store only references in Postgres

## 6. Validation
- System shall validate artifact existence
- System shall enforce required structure
- System shall pause on validation failure

## 7. State Management
- System shall track runtime state in Postgres
- System shall reconstruct state from Git when needed

## 8. Human Interaction
- System shall support approval, rejection, revision
- System shall pause workflows for approval

## 9. Execution Flexibility
- System shall support human or AI execution
- System shall validate outputs independent of actor
