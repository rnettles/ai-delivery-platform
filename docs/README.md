# Project Documentation Index

This folder defines the documentation model for the ai-delivery-platform orchestration system.

## Document hierarchy

1. **Vision & Strategy** — System vision, principles, and long-term direction
2. **Requirements** — PRD defines product goals; FRs define verifiable system behavior  
3. **Decisions** — ADRs record why architectural choices were made; TDNs specify design constraints
4. **Architecture** — System structure, subsystems, and how components support requirements
5. **Roadmap** — Phase and sprint plans sequence execution
6. **Runbooks** — Operations, deployment, troubleshooting

## Folder map

- `prd/`: Product requirements documents
- `functional_requirements/`: Functional requirement specifications and test contracts
- `adr/`: Architecture Decision Records (rationale for major choices)
- `design/`: Technical Design Notes (TDN) — design decisions that gate phase advancement. TDNs require human approval before sprint staging. See `../ai_dev_stack/ai_guidance/AI_DESIGN_PROCESS.md`
- `architecture/`: Subsystem architecture reference documents (ARCH_*.md) and composite system structure. Reference documents describe overall system composition; they do not block planner gates (only TDNs do).
- `roadmap/`: Produced phase and sprint planning artifacts
- `runbook/`: Operations and deployment procedures
- `adr/`: Architecture Decision Records capturing major decisions

## Design Decision vs. Architecture Reference

**Design Decision Documents (gate-blocking):**
- **TDN** (`docs/design/tdn/TDN-*.md`): Technical Design Note specifying a design constraint or decision
  - Purpose: Record decisions that constrain implementation  
  - Gate: Planner requires `Status: Approved` before sprint staging
  - Example: TDN-UI-main-window-aesthetic.md specifies Tailwind token contracts and component interfaces
- **ADR** (`docs/adr/ADR-*.md`): Architecture Decision Record capturing rationale
  - Purpose: Explain why a major architectural choice was made
  - Gate: ADRs are advisory (do not block Planner)
  - Example: ADR-001-governance-first-workflow-baseline.md records why Git is source of truth

**Architecture Reference Documents (non-blocking):**
- **ARCH** (`docs/architecture/ARCH-*.md`): Composite architecture description
  - Purpose: Document overall system structure and how subsystems integrate
  - Gate: No gate enforcement; purely reference material
  - Example: ARCH_CORE_reference_system.md describes the system's execution model

## Key rule

Create a **TDN** when design choices must be locked in before implementation (component contracts, data models, algorithms).  
Create an **ARCH** reference document when you need to explain how the system fits together or describe composite structure.  
Create an **ADR** when recording the rationale for a major architectural decision that will endure.

See `../ai_dev_stack/ai_guidance/AI_DESIGN_PROCESS.md` for complete design artifact guidance.
