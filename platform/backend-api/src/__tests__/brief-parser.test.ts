import { describe, it, expect } from "vitest";
import { parseBrief, parseTaskFlags, parseExecutionContract } from "../utils/brief-parser";

describe("parseBrief (ADR-033 Phase 1)", () => {
  it("returns empty defaults for an empty document", () => {
    const result = parseBrief("");
    expect(result.acceptanceCriteria).toEqual([]);
    expect(result.designRefs).toEqual([]);
    expect(result.canonicalValues).toBe("");
    expect(result.deliverables).toEqual([]);
  });

  it("parses checklist items from Acceptance Criteria", () => {
    const md = [
      "## Acceptance Criteria",
      "- [ ] First criterion",
      "- [x] Second criterion",
      "",
      "## Some Other Section",
      "noise",
    ].join("\n");
    const r = parseBrief(md);
    expect(r.acceptanceCriteria).toEqual([
      { text: "First criterion", checked: false },
      { text: "Second criterion", checked: true },
    ]);
  });

  it("parses bullet-listed paths from Design References", () => {
    const md = [
      "## Design References",
      "- docs/adr/adr-031-governance.md",
      "- docs/architecture/overview.md",
      "",
    ].join("\n");
    const r = parseBrief(md);
    expect(r.designRefs).toEqual([
      "docs/adr/adr-031-governance.md",
      "docs/architecture/overview.md",
    ]);
  });

  it("captures Canonical Values verbatim", () => {
    const md = [
      "## Canonical Values",
      "MAX_ITER = 25",
      "TIMEOUT = 60000",
      "",
      "## Next Section",
      "ignored",
    ].join("\n");
    const r = parseBrief(md);
    expect(r.canonicalValues).toContain("MAX_ITER = 25");
    expect(r.canonicalValues).toContain("TIMEOUT = 60000");
    expect(r.canonicalValues).not.toContain("ignored");
  });

  it("parses Deliverables Checklist items", () => {
    const md = [
      "## Deliverables Checklist",
      "- [ ] src/foo.ts",
      "- [ ] docs/bar.md",
    ].join("\n");
    const r = parseBrief(md);
    expect(r.deliverables.map((d) => d.path)).toEqual(["src/foo.ts", "docs/bar.md"]);
    expect(r.deliverables.every((d) => !d.checked)).toBe(true);
  });
});

describe("parseTaskFlags (ADR-033 Phase 1)", () => {
  it("returns safe defaults when no Task Flags block exists", () => {
    const flags = parseTaskFlags("# Some brief\n\nNo flags here.");
    expect(flags.fr_ids_in_scope).toEqual([]);
    expect(flags.ui_evidence_required).toBe(false);
    expect(flags.architecture_contract_change).toBe(false);
  });

  it("parses JSON-formatted task flags block", () => {
    const md = [
      "## Task Flags",
      "```json",
      JSON.stringify({
        task_id: "TASK-001",
        fr_ids_in_scope: ["FR-12", "FR-13"],
        ui_evidence_required: true,
        architecture_contract_change: false,
      }),
      "```",
    ].join("\n");
    const flags = parseTaskFlags(md);
    expect(flags.task_id).toBe("TASK-001");
    expect(flags.fr_ids_in_scope).toEqual(["FR-12", "FR-13"]);
    expect(flags.ui_evidence_required).toBe(true);
  });
});

describe("parseExecutionContract (Phase 3)", () => {
  it("returns null when the section is absent", () => {
    expect(parseExecutionContract("# Brief\n\n## Task Description\nfoo")).toBeNull();
  });

  it("returns null when the JSON block is malformed", () => {
    const md = "## Execution Contract\n\n```json\n{not valid json\n```\n";
    expect(parseExecutionContract(md)).toBeNull();
  });

  it("extracts a valid contract from a fenced json block", () => {
    const contract = {
      contract_version: 1,
      task_id: "S01-001",
      sprint_id: "S01",
      scope: { allowed_paths: ["src/**"], allowed_paths_extra: [], forbidden_actions: ["add_new_routes"] },
      dependencies: { allowed: [], install_command: "npm install" },
      commands: { lint: "npm run lint", typecheck: "npm run typecheck", test: "npm run test" },
      determinism: { idempotent_runtime: "n/a", no_randomness: true, no_external_calls: true },
      success_criteria: { all_tests_pass: true, lint_pass: true, typecheck_pass: true, no_regressions: true },
      evidence_required: true,
      verification_inputs: ["x.json"],
    };
    const md = `# Brief\n\n## Execution Contract\n\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n\n## Task Description\nfoo`;
    const parsed = parseExecutionContract(md);
    expect(parsed).not.toBeNull();
    expect(parsed?.task_id).toBe("S01-001");
    expect(parsed?.scope.forbidden_actions).toContain("add_new_routes");
  });
});
