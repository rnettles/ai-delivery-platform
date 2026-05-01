# State to UI Mapping

## Purpose
Defines how each `PipelineStatus` value maps to UI behavior — specifically which actions are available and how the view presents state.

## Source of Truth
The API returns `allowed_actions[]` per pipeline. The UI renders only what is returned. This table reflects what the API will return per state (defined in `action-model.md`), not what the UI computes.

## State → UI Behavior

| `PipelineStatus` | UI Label | Action Bar renders |
|---|---|---|
| `running` | RUNNING | Pause, Cancel, Start Takeover |
| `awaiting_approval` | AWAITING APPROVAL | Approve, Reject, Cancel |
| `paused_takeover` | PAUSED (TAKEOVER) | End Takeover, Cancel |
| `paused` | PAUSED | Resume, Cancel |
| `failed` | FAILED | Cancel |
| `complete` | COMPLETED | _(none)_ |
| `cancelled` | CANCELLED | _(none)_ |
| `awaiting_pr_review` | AWAITING PR REVIEW | _(none — external action)_ |

## Rules
- UI must not compute or infer allowed actions
- Buttons only render if the action appears in `allowed_actions[]`
- Terminal states (`failed`, `complete`, `cancelled`) have no resumable actions

## Dependencies
- `system-behavior/action-model.md` — action → state mapping
- `system-behavior/pipeline-state-machine.md` — valid transitions
