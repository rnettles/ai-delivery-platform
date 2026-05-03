import { describe, it, expect } from "vitest";
import { sprintPlanRendererService } from "../services/sprint-plan-renderer.service";
import type { RichSprintPlan, TaskSpecification } from "../domain/sprint-plan.types";
import type { ExecutionContract } from "../domain/execution-contract.types";

const contract: ExecutionContract = {
  contract_version: 1,
  task_id: "S01-001",
  sprint_id: "S01",
  scope: {
    allowed_paths: ["src/feature/**"],
    allowed_paths_extra: ["**/*.test.ts"],
    forbidden_actions: ["add_new_routes"],
  },
  dependencies: { allowed: [], install_command: "npm install" },
  commands: { lint: "npm run lint", typecheck: "npm run typecheck", test: "npm run test" },
  determinism: { idempotent_runtime: "n/a", no_randomness: true, no_external_calls: true },
  success_criteria: { all_tests_pass: true, lint_pass: true, typecheck_pass: true, no_regressions: true },
  evidence_required: true,
  verification_inputs: ["project_work/ai_project_tasks/active/test_results.json"],
};

const plan: RichSprintPlan = {
  sprint_id: "S01",
  phase_id: "phase-foo",
  name: "Phase Foo Sprint 1",
  status: "staged",
  execution_mode: "normal",
  overview: { purpose: "Implement X", scope: "src/feature" },
  design_decisions: [{ decision: "DB", choice: "Postgres", rationale: "ACID" }],
  goals: ["Deliver X"],
  tasks: ["S01-001", "S01-002"],
  data_contracts: [{ name: "FooReq", kind: "request", json_schema: JSON.stringify({ type: "object" }) }],
  invariants: [{ id: "INV-1", statement: "Idempotent writes", testable_via: "unit" }],
  dependency_graph: [
    { task_id: "S01-001", depends_on: [] },
    { task_id: "S01-002", depends_on: ["S01-001"] },
  ],
  test_matrix: [
    { task_id: "S01-001", normal: ["happy"], edge: [], failure: [], idempotency: [] },
    { task_id: "S01-002", normal: ["happy"], edge: ["empty"], failure: [], idempotency: [] },
  ],
  validation_gates: ["lint", "typecheck", "unit"],
  definition_of_done: ["All tests pass"],
};

const specs: TaskSpecification[] = [
  {
    task_id: "S01-001",
    title: "First task",
    description: "Do thing 1",
    subsystem: "feature",
    fr_ids_in_scope: ["FR-001"],
    inputs: [{ name: "req", type: "FooReq", source: "http" }],
    outputs: [{ name: "res", type: "FooRes", sink: "http" }],
    implementation_notes: ["use existing helper"],
    acceptance_criteria: ["returns 200"],
    estimated_effort: "S",
    files_likely_affected: ["src/feature/foo.ts"],
    depends_on: [],
    test_refs: ["S01-001"],
    invariant_refs: ["INV-1"],
    contract_refs: ["FooReq"],
    task_flags: {
      fr_ids_in_scope: ["FR-001"],
      architecture_contract_change: false,
      ui_evidence_required: false,
      incident_tier: "none",
    },
    execution_contract: contract,
  },
  {
    task_id: "S01-002",
    title: "Second task",
    description: "Do thing 2",
    subsystem: "feature",
    fr_ids_in_scope: ["FR-001"],
    inputs: [],
    outputs: [],
    implementation_notes: [],
    acceptance_criteria: ["builds on 1"],
    estimated_effort: "M",
    files_likely_affected: ["src/feature/bar.ts"],
    depends_on: ["S01-001"],
    test_refs: ["S01-002"],
    invariant_refs: [],
    contract_refs: [],
    task_flags: {
      fr_ids_in_scope: ["FR-001"],
      architecture_contract_change: false,
      ui_evidence_required: false,
      incident_tier: "none",
    },
    execution_contract: { ...contract, task_id: "S01-002" },
  },
];

describe("SprintPlanRendererService", () => {
  it("renders all required sections for a complete plan", () => {
    const md = sprintPlanRendererService.render(plan, specs);
    for (const section of [
      "# Sprint Plan: S01",
      "## Overview",
      "## Design Decisions",
      "## Goals",
      "## Tasks",
      "## Task Specifications",
      "### S01-001 — First task [S]",
      "### S01-002 — Second task [M]",
      "## Data Contracts",
      "## Test Matrix",
      "## Invariants",
      "## Dependency Graph",
      "## Validation Gates",
      "## Definition of Done",
    ]) {
      expect(md, `missing section: ${section}`).toContain(section);
    }
  });

  it("is byte-stable for identical input", () => {
    const a = sprintPlanRendererService.render(plan, specs);
    const b = sprintPlanRendererService.render(plan, specs);
    expect(a).toBe(b);
  });

  it("serializes data_contract json_schema deterministically", () => {
    const md = sprintPlanRendererService.render(plan, specs);
    expect(md).toContain('"type": "object"');
  });

  it("renders 'no deps' marker for tasks with empty dependency_graph entries", () => {
    const md = sprintPlanRendererService.render(plan, specs);
    expect(md).toContain("`S01-001` → _(no deps)_");
    expect(md).toContain("`S01-002` → `S01-001`");
  });

  it("renders empty placeholders when sections are empty", () => {
    const empty: RichSprintPlan = {
      ...plan,
      design_decisions: [],
      data_contracts: [],
      invariants: [],
      test_matrix: [],
      validation_gates: [],
      definition_of_done: [],
    };
    const md = sprintPlanRendererService.render(empty, []);
    expect(md).toContain("## Design Decisions\n\n_None recorded._");
    expect(md).toContain("## Data Contracts\n\n_None._");
    expect(md).toContain("## Invariants\n\n_None._");
    expect(md).toContain("## Test Matrix\n\n_None._");
  });
});
