import { describe, it, expect } from "vitest";
import { sprintPlanValidatorService } from "../services/sprint-plan-validator.service";
import type { RichSprintLlmResponse } from "../domain/sprint-plan.types";
import type { ExecutionContract } from "../domain/execution-contract.types";

const makeContract = (taskId: string, sprintId = "S01"): ExecutionContract => ({
  contract_version: 1,
  task_id: taskId,
  sprint_id: sprintId,
  scope: {
    allowed_paths: ["src/feature/**"],
    allowed_paths_extra: ["**/*.test.ts"],
    forbidden_actions: ["add_new_routes", "rename_files"],
  },
  dependencies: { allowed: [], install_command: "npm install" },
  commands: { lint: "npm run lint", typecheck: "npm run typecheck", test: "npm run test" },
  determinism: { idempotent_runtime: "n/a", no_randomness: true, no_external_calls: true },
  success_criteria: { all_tests_pass: true, lint_pass: true, typecheck_pass: true, no_regressions: true },
  evidence_required: true,
  verification_inputs: ["project_work/ai_project_tasks/active/test_results.json"],
});

const makeValidPlan = (): RichSprintLlmResponse => ({
  plan_version: 1,
  first_task_id: "S01-001",
  sprint_plan: {
    sprint_id: "S01",
    phase_id: "phase-foo",
    name: "Phase Foo Sprint 1",
    status: "staged",
    execution_mode: "normal",
    overview: { purpose: "Implement X", scope: "src/feature" },
    design_decisions: [{ decision: "DB choice", choice: "Postgres", rationale: "ACID" }],
    goals: ["Deliver feature X"],
    tasks: ["S01-001", "S01-002"],
    data_contracts: [
      { name: "FooRequest", kind: "request", json_schema: JSON.stringify({ type: "object" }) },
    ],
    invariants: [
      { id: "INV-1", statement: "All writes are idempotent", testable_via: "unit test" },
    ],
    dependency_graph: [
      { task_id: "S01-001", depends_on: [] },
      { task_id: "S01-002", depends_on: ["S01-001"] },
    ],
    test_matrix: [
      { task_id: "S01-001", normal: ["happy path"], edge: [], failure: [], idempotency: [] },
      { task_id: "S01-002", normal: ["happy path"], edge: [], failure: [], idempotency: [] },
    ],
    validation_gates: ["lint", "typecheck", "unit"],
    definition_of_done: ["All tasks complete", "All tests pass"],
  },
  task_specifications: [
    {
      task_id: "S01-001",
      title: "First task",
      description: "Do thing 1",
      subsystem: "feature",
      fr_ids_in_scope: ["FR-001"],
      inputs: [{ name: "req", type: "FooRequest", source: "http" }],
      outputs: [{ name: "res", type: "FooResponse", sink: "http" }],
      implementation_notes: ["use existing helper"],
      acceptance_criteria: ["returns 200 on happy path"],
      estimated_effort: "S",
      files_likely_affected: ["src/feature/foo.ts"],
      depends_on: [],
      test_refs: ["S01-001"],
      invariant_refs: ["INV-1"],
      contract_refs: ["FooRequest"],
      task_flags: {
        fr_ids_in_scope: ["FR-001"],
        architecture_contract_change: false,
        ui_evidence_required: false,
        incident_tier: "none",
      },
      execution_contract: makeContract("S01-001"),
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
      acceptance_criteria: ["builds on task 1"],
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
      execution_contract: makeContract("S01-002"),
    },
  ],
});

describe("SprintPlanValidatorService", () => {
  it("validates a fully populated rich plan", async () => {
    const result = await sprintPlanValidatorService.validateRichResponse(makeValidPlan());
    expect(result.ok).toBe(true);
  });

  it("rejects when first_task_id is not in tasks[]", async () => {
    const plan = makeValidPlan();
    plan.first_task_id = "S01-999";
    const result = await sprintPlanValidatorService.validateRichResponse(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => String(e["message"]).includes("first_task_id"))).toBe(true);
    }
  });

  it("rejects when dependency_graph references unknown task", async () => {
    const plan = makeValidPlan();
    const entry = plan.sprint_plan.dependency_graph.find((e) => e.task_id === "S01-002")!;
    entry.depends_on = ["S01-999"];
    const result = await sprintPlanValidatorService.validateRichResponse(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => String(e["message"]).includes("S01-999"))).toBe(true);
    }
  });

  it("rejects when dependency_graph contains a cycle", async () => {
    const plan = makeValidPlan();
    const entry = plan.sprint_plan.dependency_graph.find((e) => e.task_id === "S01-001")!;
    entry.depends_on = ["S01-002"];
    const result = await sprintPlanValidatorService.validateRichResponse(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => String(e["message"]).includes("cycle"))).toBe(true);
    }
  });

  it("rejects when execution_contract.task_id mismatches the spec", async () => {
    const plan = makeValidPlan();
    plan.task_specifications[0].execution_contract = {
      ...plan.task_specifications[0].execution_contract,
      task_id: "S01-NOPE",
    };
    const result = await sprintPlanValidatorService.validateRichResponse(plan);
    expect(result.ok).toBe(false);
  });

  it("rejects when task_specifications missing for a listed task", async () => {
    const plan = makeValidPlan();
    plan.sprint_plan.tasks.push("S01-003");
    const result = await sprintPlanValidatorService.validateRichResponse(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => String(e["message"]).includes("S01-003"))).toBe(true);
    }
  });

  it("rejects when invariant_ref is undeclared", async () => {
    const plan = makeValidPlan();
    plan.task_specifications[0].invariant_refs = ["INV-MISSING"];
    const result = await sprintPlanValidatorService.validateRichResponse(plan);
    expect(result.ok).toBe(false);
  });

  it("validates a standalone execution contract", async () => {
    const result = await sprintPlanValidatorService.validateExecutionContractValue(
      makeContract("S01-001")
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an execution contract missing required fields", async () => {
    const bad = { ...makeContract("S01-001") } as Partial<ExecutionContract>;
    delete bad.commands;
    const result = await sprintPlanValidatorService.validateExecutionContractValue(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects an execution contract with unknown forbidden_action", async () => {
    const bad = makeContract("S01-001");
    (bad.scope.forbidden_actions as unknown as string[]) = ["unauthorized_voodoo"];
    const result = await sprintPlanValidatorService.validateExecutionContractValue(bad);
    expect(result.ok).toBe(false);
  });
});
