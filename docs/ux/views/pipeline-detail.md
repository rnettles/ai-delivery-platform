# View: Pipeline Detail

## Purpose
Primary control surface for pipeline execution.

## Responsibilities
- Display pipeline timeline
- Show step states and artifacts
- Provide execution controls

## Notes
This is the most critical UI surface.

---

## Low-Fidelity Wireframes

These wireframes validate the mental model, not visual design. No colors, branding, or pixel precision.

---

### 1. Main Layout (Running State)

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
│  Pipeline: #abc-123  │  Status: RUNNING  │  Mode: next-flow    │
│  Updated: 2m ago                                                │
├────────────────────────────────┬────────────────────────────────┤
│ TIMELINE                       │ SIDE PANEL                     │
│                                │  (empty until selection)       │
│  ▼ planner / iter 1 ✓          │                                │
│    ├─ [step_started]           │  Click an artifact or event    │
│    ├─ [artifact_created] 📄    │  to view details here.         │
│    └─ [step_completed]         │                                │
│                                │                                │
│  ▼ sprint-controller / iter 1  │                                │
│    ├─ [step_started]           │                                │
│    └─ [gate_waiting] ⚠         │                                │
│       ┌──────────────────────┐ │                                │
│       │ APPROVAL REQUIRED    │ │                                │
│       │ [Approve] [Reject]   │ │                                │
│       └──────────────────────┘ │                                │
│                                │                                │
│  ▷ implementer / iter 1        │                                │
│    (pending)                   │                                │
│                                │                                │
│  ▷ verifier / iter 1           │                                │
│    (pending)                   │                                │
└────────────────────────────────┴────────────────────────────────┘
```

---

### 2. Artifact Panel Open

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
│  Pipeline: #abc-123  │  Status: RUNNING  │  Mode: next-flow    │
├────────────────────────────────┬────────────────────────────────┤
│ TIMELINE                       │ SIDE PANEL — Artifact          │
│                                │  phase_plan_p01.md  [✕ close] │
│  ▼ planner / iter 1 ✓          │ ─────────────────────────────  │
│    ├─ [step_started]           │  type: md                      │
│    ├─ [artifact_created] 📄 ◀─selected                         │
│    └─ [step_completed]         │  ┌────────────────────────┐   │
│                                │  │ # Phase Plan           │   │
│  ▷ sprint-controller           │  │ ## Goal                │   │
│  ▷ implementer                 │  │ ...                    │   │
│  ▷ verifier                    │  │ [lazy loaded]          │   │
│                                │  └────────────────────────┘   │
└────────────────────────────────┴────────────────────────────────┘
```

---

### 3. Awaiting Approval (Action Bar Active)

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
│  Pipeline: #abc-123  │  Status: AWAITING APPROVAL              │
├─────────────────────────────────────────────────────────────────┤
│ ACTION BAR  [Approve ▶]  [Reject ✕]  [Cancel]                  │
│              ↑ from allowed_actions[] only                      │
├────────────────────────────────┬────────────────────────────────┤
│ TIMELINE                       │ SIDE PANEL                     │
│                                │                                │
│  ▼ planner / iter 1 ✓          │                                │
│  ▼ sprint-controller / iter 1  │                                │
│    ├─ [step_started]           │                                │
│    └─ [gate_waiting] ⚠ ◀─ ACTIVE GATE                         │
│       ┌──────────────────────┐ │                                │
│       │ ⚠ BLOCKING           │ │                                │
│       │ Approval required    │ │                                │
│       │ Status: waiting      │ │                                │
│       └──────────────────────┘ │                                │
│                                │                                │
│  ▷ implementer  (blocked)      │                                │
│  ▷ verifier     (blocked)      │                                │
└────────────────────────────────┴────────────────────────────────┘
```

---

### 4. Paused — Human Takeover

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
│  Pipeline: #abc-123  │  Status: PAUSED (TAKEOVER)              │
├─────────────────────────────────────────────────────────────────┤
│ ACTION BAR  [End Takeover ↩]  [Cancel]                         │
├────────────────────────────────┬────────────────────────────────┤
│ TIMELINE                       │ SIDE PANEL                     │
│                                │                                │
│  ▼ implementer / iter 1        │                                │
│    ├─ [step_started]           │                                │
│    └─ [human_takeover_started] │                                │
│       ┌──────────────────────┐ │                                │
│       │ 👤 HUMAN IN CONTROL  │ │                                │
│       │ actor: @randy        │ │                                │
│       └──────────────────────┘ │                                │
└────────────────────────────────┴────────────────────────────────┘
```

---

### 5. Failed State

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
│  Pipeline: #abc-123  │  Status: FAILED                         │
├─────────────────────────────────────────────────────────────────┤
│ ACTION BAR  [Cancel]   (no resume — failed is terminal)        │
├────────────────────────────────┬────────────────────────────────┤
│ TIMELINE                       │ SIDE PANEL                     │
│                                │                                │
│  ▼ planner ✓                   │                                │
│  ▼ sprint-controller ✓         │                                │
│  ▼ implementer ✗  ◀─ FAILED   │                                │
│    ├─ [step_started]           │                                │
│    ├─ [step_retried]           │                                │
│    └─ [step_failed]            │                                │
│       ┌──────────────────────┐ │                                │
│       │ ✗ FAILED             │ │                                │
│       │ reason: ...          │ │                                │
│       └──────────────────────┘ │                                │
│                                │                                │
│  ▷ verifier (not run)          │                                │
└────────────────────────────────┴────────────────────────────────┘
```

---

### 6. Step Expand / Collapse States

```
COLLAPSED (default for completed steps):
  ▶ planner / iter 1 ✓  [3 events] [2 artifacts 📄]

EXPANDED:
  ▼ planner / iter 1 ✓
    ├─ 10:01  step_started          actor: system
    ├─ 10:03  artifact_created 📄   phase_plan_p01.md
    └─ 10:05  step_completed        actor: system

ACTIVE STEP (always expanded):
  ▼ implementer / iter 1  ● RUNNING
    ├─ 10:10  step_started
    └─ ...loading
```

---

## Interaction Rules Encoded in Wireframes

| Element | Rule enforced |
|---|---|
| Action Bar driven by `allowed_actions[]` | No hardcoded buttons |
| Gate shown as distinct card inside step | Gates are first-class, not inline events |
| Side panel opens on click only | Artifacts lazy loaded, never eager |
| Completed steps collapsed by default | Timeline-first, not log-first |
| Failed step shows downstream as `not run` | No inferred state on subsequent steps |
| Pending steps marked `▷` not grayed out | Pending ≠ disabled — just not started |
