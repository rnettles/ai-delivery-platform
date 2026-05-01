# Component: Action Bar

## Purpose
Renders pipeline action buttons driven entirely by the API response. Never hardcodes available actions.

## Data Source
`allowed_actions[]` from the pipeline API response.

## Behavior
- Renders one button per entry in `allowed_actions[]`
- If `allowed_actions` is empty, renders nothing
- Button labels map from action type strings to display labels
- Action submission goes to API; UI updates from returned events

## Known Action Types (from `action-model.md`)

| Action type | Display label |
|---|---|
| `start_pipeline` | Start |
| `pause_pipeline` | Pause |
| `resume_pipeline` | Resume |
| `cancel_pipeline` | Cancel |
| `approve_gate` | Approve |
| `reject_gate` | Reject |
| `start_takeover` | Take Over |
| `end_takeover` | End Takeover |

## Rules
- No hardcoded action list
- No action visibility logic in the component
- The API is the only authority on what is allowed

## Dependencies
- `system-behavior/action-model.md`
- `system-mapping/state-to-ui.md`
