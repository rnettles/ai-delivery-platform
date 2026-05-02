import { describe, it, expect } from "vitest";
import { executionContractEnforcer } from "../services/execution-contract-enforcer.service";
import type { ExecutionContract } from "../domain/execution-contract.types";

const baseContract = (overrides: Partial<ExecutionContract> = {}): ExecutionContract => ({
  contract_version: 1,
  task_id: "S01-001",
  sprint_id: "S01",
  scope: {
    allowed_paths: ["src/**", "platform/backend-api/src/**"],
    allowed_paths_extra: ["**/*.test.ts"],
    forbidden_actions: [],
  },
  dependencies: { allowed: [], install_command: "npm install" },
  commands: {
    lint: "npm run lint",
    typecheck: "npm run typecheck",
    test: "npm run test",
  },
  determinism: { idempotent_runtime: "n/a", no_randomness: true, no_external_calls: true },
  success_criteria: { all_tests_pass: true, lint_pass: true, typecheck_pass: true, no_regressions: true },
  evidence_required: false,
  verification_inputs: [],
  ...overrides,
});

describe("executionContractEnforcer.checkWriteAllowed", () => {
  it("permits paths matching allowed_paths globs", () => {
    const r = executionContractEnforcer.checkWriteAllowed(baseContract(), "src/foo/bar.ts");
    expect(r.ok).toBe(true);
  });

  it("permits paths matching allowed_paths_extra", () => {
    const r = executionContractEnforcer.checkWriteAllowed(baseContract(), "anywhere/thing.test.ts");
    expect(r.ok).toBe(true);
  });

  it("rejects paths outside allowed lists", () => {
    const r = executionContractEnforcer.checkWriteAllowed(baseContract(), "docs/forbidden.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONTRACT_VIOLATION");
  });

  it("rejects all writes when allowed_paths is empty", () => {
    const c = baseContract({ scope: { allowed_paths: [], forbidden_actions: [] } });
    const r = executionContractEnforcer.checkWriteAllowed(c, "src/x.ts");
    expect(r.ok).toBe(false);
  });

  it("normalises ./ and leading slashes", () => {
    const r = executionContractEnforcer.checkWriteAllowed(baseContract(), "./src/x.ts");
    expect(r.ok).toBe(true);
  });
});

describe("executionContractEnforcer.checkCommandAllowed", () => {
  it("permits lint/typecheck/test verbatim", () => {
    const c = baseContract();
    expect(executionContractEnforcer.checkCommandAllowed(c, "npm run lint").ok).toBe(true);
    expect(executionContractEnforcer.checkCommandAllowed(c, "npm run typecheck").ok).toBe(true);
    expect(executionContractEnforcer.checkCommandAllowed(c, "npm run test").ok).toBe(true);
  });

  it("rejects arbitrary shell commands", () => {
    const r = executionContractEnforcer.checkCommandAllowed(baseContract(), "rm -rf /");
    expect(r.ok).toBe(false);
  });

  it("trims surrounding whitespace before comparing", () => {
    const r = executionContractEnforcer.checkCommandAllowed(baseContract(), "  npm run lint  ");
    expect(r.ok).toBe(true);
  });
});

describe("executionContractEnforcer.checkContentDeterminism", () => {
  it("rejects Math.random in non-test code when no_randomness=true", () => {
    const r = executionContractEnforcer.checkContentDeterminism(
      baseContract(),
      "src/foo.ts",
      "export const x = Math.random();"
    );
    expect(r.ok).toBe(false);
  });

  it("permits Math.random in test files", () => {
    const r = executionContractEnforcer.checkContentDeterminism(
      baseContract(),
      "src/__tests__/foo.test.ts",
      "expect(Math.random()).toBeDefined();"
    );
    expect(r.ok).toBe(true);
  });

  it("rejects fetch() when no_external_calls=true", () => {
    const r = executionContractEnforcer.checkContentDeterminism(
      baseContract(),
      "src/api.ts",
      "await fetch('https://x.com');"
    );
    expect(r.ok).toBe(false);
  });

  it("permits clean content", () => {
    const r = executionContractEnforcer.checkContentDeterminism(
      baseContract(),
      "src/clean.ts",
      "export const add = (a: number, b: number) => a + b;"
    );
    expect(r.ok).toBe(true);
  });

  it("ignores randomness when no_randomness=false", () => {
    const c = baseContract({
      determinism: { idempotent_runtime: "n/a", no_randomness: false, no_external_calls: false },
    });
    const r = executionContractEnforcer.checkContentDeterminism(c, "src/foo.ts", "Math.random();");
    expect(r.ok).toBe(true);
  });
});

describe("executionContractEnforcer.checkManifestDependencyDiff", () => {
  it("permits no-op edits", () => {
    const before = JSON.stringify({ dependencies: { lodash: "1.0.0" } });
    const after = JSON.stringify({ dependencies: { lodash: "1.0.0" } });
    expect(executionContractEnforcer.checkManifestDependencyDiff(baseContract(), before, after).ok).toBe(true);
  });

  it("rejects added packages outside allowed list", () => {
    const before = JSON.stringify({ dependencies: {} });
    const after = JSON.stringify({ dependencies: { evil: "1.0.0" } });
    const r = executionContractEnforcer.checkManifestDependencyDiff(baseContract(), before, after);
    expect(r.ok).toBe(false);
  });

  it("permits added packages on the allowed list", () => {
    const c = baseContract({ dependencies: { allowed: ["zod"], install_command: "npm install" } });
    const before = JSON.stringify({ dependencies: {} });
    const after = JSON.stringify({ dependencies: { zod: "3.22.0" } });
    expect(executionContractEnforcer.checkManifestDependencyDiff(c, before, after).ok).toBe(true);
  });

  it("permits removals", () => {
    const before = JSON.stringify({ dependencies: { gone: "1.0.0" } });
    const after = JSON.stringify({ dependencies: {} });
    expect(executionContractEnforcer.checkManifestDependencyDiff(baseContract(), before, after).ok).toBe(true);
  });

  it("passes when JSON is unparseable", () => {
    expect(executionContractEnforcer.checkManifestDependencyDiff(baseContract(), "{not json", "{also not").ok).toBe(true);
  });
});

describe("executionContractEnforcer.checkPreFinishGates", () => {
  it("rejects when any required command is missing", () => {
    const r = executionContractEnforcer.checkPreFinishGates(baseContract(), [
      { command: "npm run lint", exit_code: 0 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("permits when all three commands have exit 0", () => {
    const r = executionContractEnforcer.checkPreFinishGates(baseContract(), [
      { command: "npm run lint", exit_code: 0 },
      { command: "npm run typecheck", exit_code: 0 },
      { command: "npm run test", exit_code: 0 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects when a required command failed", () => {
    const r = executionContractEnforcer.checkPreFinishGates(baseContract(), [
      { command: "npm run lint", exit_code: 0 },
      { command: "npm run typecheck", exit_code: 1 },
      { command: "npm run test", exit_code: 0 },
    ]);
    expect(r.ok).toBe(false);
  });
});
