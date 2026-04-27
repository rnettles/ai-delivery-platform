# AI Delivery Platform CLI

A command-line interface for interacting with the AI Delivery Platform.

## Installation

```bash
npm install
npm run build
```

Or run in development mode:

```bash
npx tsx src/index.ts [command] [options]
```

## Global Options

- `--base-url <url>`: API base URL (overrides `ADP_API_BASE_URL`)
- `--api-key <key>`: API key (overrides `ADP_API_KEY`)
- `--env-file <path>`: Load environment variables from a .env file before executing

---

## Commands

### Core

- `active-set`
  - `--channel-id <id>`: Slack channel ID
  - `--pipeline-id <id>`: Pipeline ID

- `active-show`
  - Show current active defaults

- `active-clear`
  - Clear active defaults

- `health`
  - `--json`: Output raw JSON

---

### Project

- `projects`
  - `--exclude-channels`: Omit channel mappings from response
  - `--json`: Output raw JSON

- `project <projectId>`
  - `--json`: Output raw JSON

- `project-create`
  - `--project-name <name>` (required): Project name
  - `--repo-url <url>` (required): Repository URL
  - `--default-branch <branch>`: Default branch (default: `main`)
  - `--channel-id <id>`: Slack channel ID to assign immediately
  - `--json`: Output raw JSON

- `project-assign-channel`
  - `--project-id <id>` (required): Project ID
  - `--channel-id <id>` (required): Slack channel ID
  - `--json`: Output raw JSON

---

### Pipeline

- `pipeline-create`
  - `--entry-point <role>`: Entry point (`planner|sprint-controller|implementer|verifier`, default: `planner`)
  - `--execution-mode <mode>`: `next|next-flow|full-sprint`
  - `--description <text>`: Pipeline description (required)
  - `--slack-channel <id>`: Slack channel ID (required)
  - `--actor <name>`: Actor name (default: `operator`)
  - `--body-json <json>`: Raw JSON body (overrides other options)
  - `--json`: Output raw JSON
  - `--no-set-active`: Do not update active pipeline_id after create

- `pipeline`
- `pipelines`
- `pipeline-list`
- `pipeline-current`
- `pipeline-summary`
- `staged-phases`
- `staged-sprints`
- `staged-tasks`
- `sprint`
- `pipeline-handoff`
- `pipeline-skip`

(See CLI help for options for these commands.)

---

### Execution

- `scripts`
  - `--json`: Output raw JSON

- `execute`
  - `--target-type <type>`: Target type (`script|role`, default: `script`)
  - `--script-name <name>`: Script name (default: `test.echo`)
  - `--script-version <version>`: Script version (default: `2026.04.18`)
  - `--message <msg>`: Input message (default: `hello-local`)
  - `--body-json <json>`: Raw JSON body (overrides other options)
  - `--json`: Output raw JSON

- `executions`
- `execution <executionId>`
- `replay <executionId>`

---

### Other

- `git-sync`
  - `--json`: Output raw JSON

- `git-status`
  - `--json`: Output raw JSON

- `coord-create`
  - `--body-json <json>` (required): JSON body for the coordination entry
  - `--json`: Output raw JSON

- `coord-get <coordinationId>`
  - `--json`: Output raw JSON

- `coord-patch <coordinationId>`
  - `--body-json <json>` (required): JSON body for the patch
  - `--json`: Output raw JSON

- `coord-query`
  - `--json`: Output raw JSON

- `coord-archive <coordinationId>`
  - `--json`: Output raw JSON

- `request`
  - (See CLI help for options.)

---

## Usage

For help on any command, run:

```bash
adp [command] --help
```

Or in dev mode:

```bash
npx tsx src/index.ts [command] --help
```

---

**Note:** Some commands require certain options (e.g., `--description`, `--slack-channel` for `pipeline-create`). See the CLI help output for full details and required parameters.
