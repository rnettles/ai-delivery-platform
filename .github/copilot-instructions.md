# Copilot Instructions — ai-delivery-platform

## Project Identity

- **Repository:** ai-delivery-platform
- **Stack:** TypeScript · Node.js · Express
- **Default branch:** master
- **Package manager:** npm (package.json)
- **Runtime:** tsx (ts-node compatible)

## AI Dev Stack

This project uses the governed AI delivery workflow defined in ai-project_template.

All agent guidance lives at relative paths within this project:

- Runtime policy: `ai_dev_stack/ai_guidance/AI_RUNTIME_POLICY.md`
- Loading rules: `ai_dev_stack/ai_guidance/AI_RUNTIME_LOADING_RULES.md`
- Quality gates: `ai_dev_stack/ai_guidance/AI_RUNTIME_GATES.md`
- Active task: `ai_dev_stack/ai_project_tasks/active/AI_IMPLEMENTATION_BRIEF.md`
- Project context: `ai_dev_stack/ai_project_tasks/PROJECT_CONTEXT.md`

Always read `AI_RUNTIME_LOADING_RULES.md` before starting any task to determine which
additional guidance files apply.

## Agent Files

Agent prompt definitions live in `ai-project_template/.github/agents/` and are
synced to the global Copilot agents folder via `ai-project_template/install/install.bat`.
The `ai-project_template` repo is included as a workspace folder in
`ai-delivery-platform.code-workspace` for direct agent discovery.

## Guidance Sync

To update policy guidance files from the template, run:

```
ai-project_template\install\sync-project.bat C:\dev\code\ai-delivery-platform
```

In Codespaces:

```
bash /workspaces/ai-project_template/install/sync-project.sh /workspaces/ai-delivery-platform
```
