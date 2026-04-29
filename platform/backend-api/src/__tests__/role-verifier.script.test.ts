/**
 * role-verifier.script.test.ts
 *
 * Coverage: Phases 1-3 governance alignment
 *   Suite 1 (REV-001): Required-input gate — all 4 mandatory inputs enforced
 *   Suite 2 (REV-002): 10-check ordered pipeline — deterministic checks + LLM governance
 *   Suite 3 (HND-003): FAIL handoff — evidence_refs always non-empty on FAIL
 *   Suite 4 (Integration): Full PASS, command-fail, governance-fail, UX-fail paths
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const findFirst = vi.fn();
  const write = vi.fn();
  const getComposedPrompt = vi.fn();
  const chatJson = vi.fn();
  const forRole = vi.fn(async () => ({ chatJson }));
  const get = vi.fn();
  const getById = vi.fn();
  const ensureReady = vi.fn();
  const commitAll = vi.fn();
  const push = vi.fn();
  const requireRelevantDesignInputs = vi.fn();
  const access = vi.fn();
  const readFile = vi.fn();
  const writeFile = vi.fn();
  const mkdir = vi.fn();
  const execMock = vi.fn();

  return {
    findFirst,
    write,
    getComposedPrompt,
    chatJson,
    forRole,
    get,
    getById,
    ensureReady,
    commitAll,
    push,
    requireRelevantDesignInputs,
    access,
    readFile,
    writeFile,
    mkdir,
    execMock,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../services/artifact.service", () => ({
  artifactService: { findFirst: mocks.findFirst, write: mocks.write },
}));

vi.mock("../services/governance.service", () => ({
  governanceService: { getComposedPrompt: mocks.getComposedPrompt },
}));

vi.mock("../services/llm/llm-factory.service", () => ({
  llmFactory: { forRole: mocks.forRole },
}));

vi.mock("../services/pipeline.service", () => ({
  pipelineService: { get: mocks.get },
}));

vi.mock("../services/project.service", () => ({
  projectService: { getById: mocks.getById },
}));

vi.mock("../services/project-git.service", () => ({
  projectGitService: { ensureReady: mocks.ensureReady, commitAll: mocks.commitAll, push: mocks.push },
}));

vi.mock("../services/design-input-gate.service", () => ({
  designInputGateService: { requireRelevantDesignInputs: mocks.requireRelevantDesignInputs },
}));

vi.mock("fs/promises", () => ({
  default: {
    access: mocks.access,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
  },
}));

vi.mock("child_process", () => ({
  exec: (...args: unknown[]) => mocks.execMock(...args),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { VerifierScript, VerifierOutput, VerificationResult, HandoffContract, VerificationCheck } from "../scripts/role-verifier.script";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const PIPELINE_ID = "pipe-test-001";
const TASK_ID = "TST-001";
const REPO_PATH = "/repo/phks";

const BRIEF_CONTENT = `# Task TST-001 Implementation Brief

**task_id:** TST-001
**ui_evidence_required:** false

## Acceptance Criteria
- Feature X implemented
- Tests written

## Files Created
- src/feature-x.ts (Create)
`;

const TASK_CONTENT = JSON.stringify({ task_id: TASK_ID, title: "Implement Feature X", status: "ready_for_verification", acceptance_criteria: ["Feature X implemented", "Tests written"] });
const TEST_RESULTS_CONTENT = JSON.stringify({ passed: 10, failed: 0, skipped: 0, suites: [] });
const AI_RULES_PATH = path.join(REPO_PATH, "ai_dev_stack", "ai_guidance", "AI_RULES.md");

const PROJECT = { project_id: "proj-phks", clone_path: REPO_PATH };
const RUN = { project_id: "proj-phks", sprint_branch: "feature/TST-001" };

/** Context spy helper */
function makeContext() {
  return {
    execution_id: PIPELINE_ID,
    correlation_id: PIPELINE_ID,
    request_id: "req-001",
    metadata: {},
    log: vi.fn(),
    notify: vi.fn(),
  };
}

/** Minimal LLM governance response for all 6 checks passing */
const GOVERNANCE_PASS_RESPONSE = {
  checks: [
    { check_number: 2, check_name: "deliverable_completeness", result: "PASS", evidence: "All deliverables present" },
    { check_number: 3, check_name: "file_evidence", result: "PASS", evidence: "File actions match" },
    { check_number: 4, check_name: "contradiction_guardrail_behavior", result: "PASS", evidence: "Guardrails applied" },
    { check_number: 5, check_name: "contradiction_guardrail_tests", result: "PASS", evidence: "Tests cover guardrails" },
    { check_number: 6, check_name: "test_existence", result: "PASS", evidence: "Tests exist for all AC" },
    { check_number: 10, check_name: "scope_expansion_guard", result: "PASS", evidence: "No out-of-scope changes" },
  ],
  summary: "All governance checks pass",
  required_corrections: [],
  handoff: { changed_scope: [], verification_state: "pass", open_risks: [], next_role_action: "none", evidence_refs: [] },
};

/** LLM governance response with one failing governance check */
const GOVERNANCE_FAIL_RESPONSE = {
  checks: [
    { check_number: 2, check_name: "deliverable_completeness", result: "FAIL", evidence: "Missing deliverable Y", failure_detail: "Implement deliverable Y per acceptance criteria" },
    { check_number: 3, check_name: "file_evidence", result: "PASS", evidence: "File actions match" },
    { check_number: 4, check_name: "contradiction_guardrail_behavior", result: "PASS", evidence: "Guardrails applied" },
    { check_number: 5, check_name: "contradiction_guardrail_tests", result: "PASS", evidence: "Tests cover guardrails" },
    { check_number: 6, check_name: "test_existence", result: "PASS", evidence: "Tests exist" },
    { check_number: 10, check_name: "scope_expansion_guard", result: "PASS", evidence: "No scope expansion" },
  ],
  summary: "Governance check 2 failed",
  required_corrections: ["Implement deliverable Y per acceptance criteria"],
  handoff: {
    changed_scope: ["feature-x"],
    verification_state: "fail",
    open_risks: ["Deliverable Y missing"],
    next_role_action: "implementer_retry",
    evidence_refs: ["check-2:deliverable_completeness"],
  },
};

/** Sets up happy-path exec mock for npm test, lint, tsc */
function mockCommandsPass() {
  mocks.execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) =>
    cb(null, { stdout: "Tests passed", stderr: "" })
  );
}

/** Sets up failing exec mock for first command */
function mockCommandFail() {
  let first = true;
  mocks.execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) => {
    if (first) {
      first = false;
      const err = Object.assign(new Error("Test failure"), { code: 1, stdout: "", stderr: "FAIL: 2 tests failed" });
      cb(err as unknown as Error);
    } else {
      cb(null, { stdout: "ok", stderr: "" });
    }
  });
}

/** Common setup: project, run, design inputs, governance prompt */
function setupCommonMocks() {
  mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: ["docs/fr.md"], project_name: "PHKS" });
  mocks.get.mockResolvedValue(RUN);
  mocks.getById.mockResolvedValue(PROJECT);
  mocks.getComposedPrompt.mockResolvedValue("You are a verifier agent.");
  mocks.write.mockImplementation((_pid: string, name: string, _content: string) =>
    Promise.resolve(`/artifacts/${name}`)
  );
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.commitAll.mockResolvedValue(undefined);
  mocks.push.mockResolvedValue(undefined);
  // AI_RULES.md present by default
  mocks.access.mockResolvedValue(undefined);
}

/** Sets up REV-001: all 4 artifacts present */
function setupAllInputsPresent() {
  mocks.findFirst.mockImplementation((paths: string[]) => {
    if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
      return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: BRIEF_CONTENT });
    if (paths.some((p: string) => p.includes("current_task")))
      return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
    if (paths.some((p: string) => p.includes("test_results")))
      return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
    return Promise.resolve(null);
  });
}

// ─── Suite 1: REV-001 required-input gate ─────────────────────────────────────

describe("Suite 1 (REV-001): Required-input gate", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
  });

  it("1.1 — proceeds when all 4 required inputs are present", async () => {
    setupAllInputsPresent();
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.task_id).toBe(TASK_ID);
    expect(result.passed).toBe(true);
    expect(result.handoff).toBeUndefined();
  });

  it("1.2 — fails when AI_IMPLEMENTATION_BRIEF.md is missing", async () => {
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.task_id).toBe("UNKNOWN");
    expect(result.handoff?.evidence_refs).toContain("required-input:AI_IMPLEMENTATION_BRIEF.md");
  });

  it("1.3 — fails when current_task.json is missing", async () => {
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: BRIEF_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff?.evidence_refs).toContain("required-input:current_task.json");
  });

  it("1.4 — fails when test_results.json is missing", async () => {
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: BRIEF_CONTENT });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      return Promise.resolve(null);
    });

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff?.evidence_refs).toContain("required-input:test_results.json");
  });

  it("1.5 — fails when AI_RULES.md is absent from project repo", async () => {
    setupAllInputsPresent();
    mocks.access.mockRejectedValue(new Error("ENOENT"));

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff?.evidence_refs).toContain("required-input:AI_RULES.md");
  });

  it("1.6 — fails when all 4 inputs are missing; evidence_refs lists all", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.access.mockRejectedValue(new Error("ENOENT"));

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: [], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff?.verification_state).toBe("fail");
    expect(result.handoff?.evidence_refs?.length).toBeGreaterThanOrEqual(4);
  });

  it("1.7 — gate fail emits NOT_RUN for all 10 checks", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.access.mockRejectedValue(new Error("ENOENT"));

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: [], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    expect(wroteJson).toBeDefined();
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    expect(written.checks).toHaveLength(10);
    expect(written.checks.every((c: VerificationCheck) => c.result === "NOT_RUN")).toBe(true);
  });

  it("1.8 — no synthetic task_id fallback when current_task.json has no task_id field", async () => {
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: BRIEF_CONTENT });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: JSON.stringify({ title: "no task_id here" }) });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    // Must not synthesise a task-${pipelineId} style fallback
    expect(result.task_id).toBe("UNKNOWN");
    expect(result.passed).toBe(false);
    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    expect(written.task_id).not.toMatch(/^task-/);
  });
});

// ─── Suite 2 (REV-002): Ordered check pipeline ───────────────────────────────

describe("Suite 2 (REV-002): Ordered verification check pipeline", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    setupAllInputsPresent();
    mockCommandsPass();
  });

  it("2.1 — emits exactly 10 numbered checks on PASS", async () => {
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    expect(written.checks).toHaveLength(10);
    expect(written.checks.map((c: VerificationCheck) => c.check_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("2.2 — check 1 (task_id_alignment) passes when brief references task_id", async () => {
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check1 = written.checks.find((c: VerificationCheck) => c.check_number === 1)!;
    expect(check1.result).toBe("PASS");
    expect(check1.category).toBe("filesystem");
  });

  it("2.3 — check 1 fails when brief declares a different task_id", async () => {
    const mismatchBrief = BRIEF_CONTENT.replaceAll("TST-001", "OTHER-999");
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: mismatchBrief });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check1 = written.checks.find((c: VerificationCheck) => c.check_number === 1)!;
    expect(check1.result).toBe("FAIL");
  });

  it("2.4 — check 7 (ci_evidence_quality) passes when all commands succeed", async () => {
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check7 = written.checks.find((c: VerificationCheck) => c.check_number === 7)!;
    expect(check7.result).toBe("PASS");
    expect(check7.category).toBe("command");
  });

  it("2.5 — check 7 fails when a command fails", async () => {
    mockCommandFail();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check7 = written.checks.find((c: VerificationCheck) => c.check_number === 7)!;
    expect(check7.result).toBe("FAIL");
  });

  it("2.6 — check 8 (ui_evidence_playwright) is SKIP when ui_evidence_required=false", async () => {
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check8 = written.checks.find((c: VerificationCheck) => c.check_number === 8)!;
    expect(check8.result).toBe("SKIP");
  });

  it("2.7 — check 8 passes when ui_evidence_required=true and user_flow.md is Approved", async () => {
    const uiBrief = BRIEF_CONTENT.replace("**ui_evidence_required:** false", "**ui_evidence_required:** true");
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: uiBrief });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });
    mocks.readFile.mockResolvedValue("# User Flow\n\nStatus: Approved\n\nFlow description here.");
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check8 = written.checks.find((c: VerificationCheck) => c.check_number === 8)!;
    expect(check8.result).toBe("PASS");
  });

  it("2.8 — check 8 fails when ui_evidence_required=true and user_flow.md is missing", async () => {
    const uiBrief = BRIEF_CONTENT.replace("**ui_evidence_required:** false", "**ui_evidence_required:** true");
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: uiBrief });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check8 = written.checks.find((c: VerificationCheck) => c.check_number === 8)!;
    expect(check8.result).toBe("FAIL");
  });

  it("2.9 — check 9 (active_artifact_integrity) is always PASS under normal repo path", async () => {
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check9 = written.checks.find((c: VerificationCheck) => c.check_number === 9)!;
    expect(check9.result).toBe("PASS");
    expect(check9.category).toBe("filesystem");
  });

  it("2.10 — governance checks 2-6,10 reflect LLM response", async () => {
    mocks.chatJson.mockResolvedValue(GOVERNANCE_FAIL_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check2 = written.checks.find((c: VerificationCheck) => c.check_number === 2)!;
    expect(check2.result).toBe("FAIL");
    expect(check2.category).toBe("governance");
    // Other governance checks still PASS
    const check3 = written.checks.find((c: VerificationCheck) => c.check_number === 3)!;
    expect(check3.result).toBe("PASS");
  });

  it("2.11 — governance checks fallback to NOT_RUN when LLM throws", async () => {
    mocks.chatJson.mockRejectedValue(new Error("LLM unavailable"));

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const governanceChecks = written.checks.filter((c: VerificationCheck) => c.category === "governance");
    expect(governanceChecks.every((c: VerificationCheck) => c.result === "NOT_RUN")).toBe(true);
  });
});

// ─── Suite 3 (HND-003): FAIL handoff evidence_refs always non-empty ───────────

describe("Suite 3 (HND-003): FAIL handoff evidence_refs always non-empty", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    setupAllInputsPresent();
  });

  it("3.1 — handoff is undefined on PASS", async () => {
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(true);
    expect(result.handoff).toBeUndefined();
  });

  it("3.2 — handoff.evidence_refs non-empty when command fails (HND-003)", async () => {
    mockCommandFail();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff).toBeDefined();
    expect(result.handoff!.evidence_refs.length).toBeGreaterThan(0);
    expect(result.handoff!.verification_state).toBe("fail");
  });

  it("3.3 — handoff.evidence_refs non-empty when governance check fails (HND-003)", async () => {
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_FAIL_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff!.evidence_refs.length).toBeGreaterThan(0);
  });

  it("3.4 — handoff.evidence_refs non-empty when LLM returns empty evidence_refs on fail", async () => {
    mockCommandsPass();
    // LLM returns fail but with empty evidence_refs
    mocks.chatJson.mockResolvedValue({
      ...GOVERNANCE_FAIL_RESPONSE,
      handoff: { ...GOVERNANCE_FAIL_RESPONSE.handoff, evidence_refs: [] },
    });

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.handoff!.evidence_refs.length).toBeGreaterThan(0);
  });

  it("3.5 — handoff.evidence_refs non-empty on UX gate FAIL (previously undefined)", async () => {
    const uiBrief = BRIEF_CONTENT.replace("**ui_evidence_required:** false", "**ui_evidence_required:** true");
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: uiBrief });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });
    mockCommandsPass();
    mocks.readFile.mockRejectedValue(new Error("ENOENT")); // user_flow.md missing
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff).toBeDefined();
    expect(result.handoff!.evidence_refs.length).toBeGreaterThan(0);
  });

  it("3.6 — REV-001 gate fail handoff has non-empty evidence_refs", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.access.mockRejectedValue(new Error("ENOENT"));

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: [], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff!.evidence_refs.length).toBeGreaterThan(0);
  });
});

// ─── Suite 4 (Integration): Full path scenarios ────────────────────────────────

describe("Suite 4 (Integration): Full verification path scenarios", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    setupAllInputsPresent();
  });

  it("4.1 — PASS path: all 10 checks pass; no handoff; verification_result.json written", async () => {
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(true);
    expect(result.task_id).toBe(TASK_ID);
    expect(result.handoff).toBeUndefined();
    expect(result.verification_result_path).toContain("verification_result.json");
    expect(result.artifact_path).toContain("verification_result.md");

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    expect(written.result).toBe("PASS");
    expect(written.checks).toHaveLength(10);
    expect(written.checks.every((c: VerificationCheck) => c.result === "PASS" || c.result === "SKIP")).toBe(true);
  });

  it("4.2 — command FAIL path: task_id preserved, handoff emitted, result is FAIL", async () => {
    mockCommandFail();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.task_id).toBe(TASK_ID);
    expect(result.handoff?.verification_state).toBe("fail");

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    expect(written.result).toBe("FAIL");
    expect(written.required_corrections.length).toBeGreaterThan(0);
  });

  it("4.3 — governance FAIL path: result FAIL even when commands all pass", async () => {
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_FAIL_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    expect(result.handoff).toBeDefined();
  });

  it("4.4 — verification_result.json is persisted to repo active-slot directory", async () => {
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx);

    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("project_work", "ai_project_tasks", "active", "verification_result.json")),
      expect.any(String),
      "utf-8"
    );
  });

  it("4.5 — both PASS and FAIL paths return consistent VerifierOutput schema fields", async () => {
    // PASS
    mockCommandsPass();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);
    const ctx = makeContext();
    const passResult = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;
    expect(passResult).toHaveProperty("task_id");
    expect(passResult).toHaveProperty("passed");
    expect(passResult).toHaveProperty("verification_result_path");
    expect(passResult).toHaveProperty("artifact_path");

    vi.clearAllMocks();
    setupCommonMocks();
    setupAllInputsPresent();

    // FAIL
    mockCommandFail();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);
    const ctx2 = makeContext();
    const failResult = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx2) as VerifierOutput;
    expect(failResult).toHaveProperty("task_id");
    expect(failResult).toHaveProperty("passed");
    expect(failResult).toHaveProperty("verification_result_path");
    expect(failResult).toHaveProperty("artifact_path");
    expect(failResult.handoff).toBeDefined();
  });
});

// ─── Suite 5 (Phase 4): Complete FAIL handoff contract ───────────────────────

describe("Suite 5 (Phase 4): Complete FAIL handoff — all HND fields populated", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    setupAllInputsPresent();
  });

  const HND_FIELDS = ["changed_scope", "verification_state", "open_risks", "next_role_action", "evidence_refs"] as const;

  it("5.1 — command-fail handoff has all 5 HND fields and verification_state=fail", async () => {
    mockCommandFail();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    for (const field of HND_FIELDS) {
      expect(result.handoff).toHaveProperty(field);
    }
    expect(result.handoff!.verification_state).toBe("fail");
    expect(result.handoff!.open_risks.length).toBeGreaterThan(0);
  });

  it("5.2 — governance-fail handoff has all 5 HND fields and open_risks non-empty", async () => {
    mockCommandsPass();
    // LLM returns empty open_risks — Phase 4 must synthesize them from failed checks
    mocks.chatJson.mockResolvedValue({
      ...GOVERNANCE_FAIL_RESPONSE,
      handoff: { ...GOVERNANCE_FAIL_RESPONSE.handoff, open_risks: [] },
    });

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    for (const field of HND_FIELDS) {
      expect(result.handoff).toHaveProperty(field);
    }
    // Phase 4: open_risks synthesized from failed check evidence when LLM returns empty
    expect(result.handoff!.open_risks.length).toBeGreaterThan(0);
  });

  it("5.3 — UX-gate-fail handoff has all 5 HND fields", async () => {
    const uiBrief = BRIEF_CONTENT.replace("**ui_evidence_required:** false", "**ui_evidence_required:** true");
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: uiBrief });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });
    mockCommandsPass();
    mocks.readFile.mockRejectedValue(new Error("ENOENT")); // user_flow.md missing
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    for (const field of HND_FIELDS) {
      expect(result.handoff).toHaveProperty(field);
    }
    expect(result.handoff!.open_risks.length).toBeGreaterThan(0);
    expect(result.handoff!.evidence_refs.length).toBeGreaterThan(0);
  });

  it("5.4 — handoff task_id matches verified task (Phase 4 tracing field)", async () => {
    mockCommandFail();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.handoff!.task_id).toBe(TASK_ID);
  });

  it("5.5 — REV-001 gate-fail handoff has all 5 HND fields and open_risks non-empty", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.access.mockRejectedValue(new Error("ENOENT"));

    const ctx = makeContext();
    const result = await script.run({ previous_artifacts: [], pipeline_id: PIPELINE_ID }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    for (const field of HND_FIELDS) {
      expect(result.handoff).toHaveProperty(field);
    }
    expect(result.handoff!.verification_state).toBe("fail");
    expect(result.handoff!.open_risks.length).toBeGreaterThan(0);
  });
});

// ─── Suite 6 (Phase 5): Gate command and override control ────────────────────

describe("Suite 6 (Phase 5): Gate command and override control", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    setupAllInputsPresent();
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);
    delete process.env.VERIFIER_COMMANDS;
  });

  it("6.1 — baseline commands always run; override cannot replace them", async () => {
    mockCommandsPass();
    const ctx = makeContext();
    // Passing a single override that is NOT in the baseline — should run 4 commands total
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
      verification_commands: ["npm run custom-check"],
    }, ctx);

    // 3 baseline + 1 override = 4 exec calls
    expect(mocks.execMock).toHaveBeenCalledTimes(4);
  });

  it("6.2 — passing only baseline commands via verification_commands does not duplicate them", async () => {
    mockCommandsPass();
    const ctx = makeContext();
    // Passing a command already in baseline — should not run it twice
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
      verification_commands: ["npm test"],
    }, ctx);

    // Still only 3 exec calls (deduped)
    expect(mocks.execMock).toHaveBeenCalledTimes(3);
  });

  it("6.3 — VERIFIER_COMMANDS env adds to baseline, not replaces it", async () => {
    mockCommandsPass();
    process.env.VERIFIER_COMMANDS = "npm run extra-check";
    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    // 3 baseline + 1 from env = 4 exec calls
    expect(mocks.execMock).toHaveBeenCalledTimes(4);
    delete process.env.VERIFIER_COMMANDS;
  });

  it("6.4 — command_source is 'baseline' for default commands", async () => {
    mockCommandsPass();
    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    expect(written.command_results.every((r) => r.command_source === "baseline")).toBe(true);
  });

  it("6.5 — command_source is 'override' for caller-added commands", async () => {
    mockCommandsPass();
    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
      verification_commands: ["npm run custom-check"],
    }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const overrideResult = written.command_results.find((r) => r.command === "npm run custom-check");
    expect(overrideResult).toBeDefined();
    expect(overrideResult!.command_source).toBe("override");
    // Baseline commands retain "baseline" source
    const baselineResult = written.command_results.find((r) => r.command === "npm test");
    expect(baselineResult!.command_source).toBe("baseline");
  });

  it("6.6 — test_results.json with valid content produces PASS evidence in check 7", async () => {
    mockCommandsPass();
    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check7 = written.checks.find((c: VerificationCheck) => c.check_number === 7)!;
    expect(check7.result).toBe("PASS");
    // evidence should mention test_results pass/fail counts
    expect(check7.evidence).toContain("test_results:");
  });

  it("6.7 — test_results.json with missing count fields is noted in check 7 evidence", async () => {
    // Override the test_results fixture to have no pass/fail fields
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: BRIEF_CONTENT });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: JSON.stringify({ suites: [] }) });
      return Promise.resolve(null);
    });
    mockCommandsPass();
    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check7 = written.checks.find((c: VerificationCheck) => c.check_number === 7)!;
    // Evidence includes test_results quality note even when content is sparse
    expect(check7.evidence).toContain("test_results:");
  });
});

// ─── Suite 7 (Phase 6): Task-flag structural parsing ─────────────────────────

const BRIEF_WITH_FLAGS_JSON = `# Task TST-001 Implementation Brief

{
  "task_id": "TST-001",
  "ui_evidence_required": false,
  "architecture_contract_change": true,
  "fr_ids_in_scope": ["FR-010", "FR-011"],
  "incident_tier": "tier-2"
}

## Acceptance Criteria
- Feature X implemented
- Tests written

## Files Created
- src/feature-x.ts (Create)
`;

const BRIEF_WITH_FLAGS_MD = `# Task TST-001 Implementation Brief

**task_id:** TST-001
**ui_evidence_required:** false
**architecture_contract_change:** true
**fr_ids_in_scope:** FR-010, FR-011
**incident_tier:** tier-2

## Acceptance Criteria
- Feature X implemented
`;

describe("Suite 7 (Phase 6): Task-flag structural parsing", () => {
  const script = new VerifierScript();

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    mockCommandsPass();
  });

  function setupBriefContent(briefContent: string) {
    mocks.findFirst.mockImplementation((paths: string[]) => {
      if (paths.some((p: string) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return Promise.resolve({ path: "/artifacts/AI_IMPLEMENTATION_BRIEF.md", content: briefContent });
      if (paths.some((p: string) => p.includes("current_task")))
        return Promise.resolve({ path: "/artifacts/current_task.json", content: TASK_CONTENT });
      if (paths.some((p: string) => p.includes("test_results")))
        return Promise.resolve({ path: "/artifacts/test_results.json", content: TEST_RESULTS_CONTENT });
      return Promise.resolve(null);
    });
  }

  it("7.1 — fr_ids_in_scope included in LLM governance prompt (JSON format)", async () => {
    setupBriefContent(BRIEF_WITH_FLAGS_JSON);
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const chatCall = mocks.chatJson.mock.calls[0];
    const userMessage = (chatCall[0] as Array<{ role: string; content: string }>)
      .find((m) => m.role === "user");
    expect(userMessage!.content).toContain("fr_ids_in_scope");
    expect(userMessage!.content).toContain("FR-010");
    expect(userMessage!.content).toContain("FR-011");
  });

  it("7.2 — architecture_contract_change=true included in governance prompt (JSON format)", async () => {
    setupBriefContent(BRIEF_WITH_FLAGS_JSON);
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const chatCall = mocks.chatJson.mock.calls[0];
    const userMessage = (chatCall[0] as Array<{ role: string; content: string }>)
      .find((m) => m.role === "user");
    expect(userMessage!.content).toContain("architecture_contract_change");
    expect(userMessage!.content).toContain("true");
  });

  it("7.3 — fr_ids_in_scope parsed from JSON array in brief", async () => {
    setupBriefContent(BRIEF_WITH_FLAGS_JSON);
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    // Task flags are in the chatJson call's user message as task_flags.json section
    const chatCall = mocks.chatJson.mock.calls[0];
    const userMsg = (chatCall[0] as Array<{ role: string; content: string }>).find((m) => m.role === "user")!;
    const taskFlagsSection = userMsg.content.split("# task_flags.json")[1] ?? "";
    const parsed = JSON.parse(taskFlagsSection.split("\n\n")[1] ?? "{}") as { fr_ids_in_scope?: string[] };
    expect(parsed.fr_ids_in_scope).toEqual(["FR-010", "FR-011"]);
  });

  it("7.4 — fr_ids_in_scope parsed from markdown format in brief", async () => {
    setupBriefContent(BRIEF_WITH_FLAGS_MD);
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const chatCall = mocks.chatJson.mock.calls[0];
    const userMsg = (chatCall[0] as Array<{ role: string; content: string }>).find((m) => m.role === "user")!;
    const taskFlagsSection = userMsg.content.split("# task_flags.json")[1] ?? "";
    const parsed = JSON.parse(taskFlagsSection.split("\n\n")[1] ?? "{}") as { fr_ids_in_scope?: string[] };
    expect(parsed.fr_ids_in_scope).toEqual(expect.arrayContaining(["FR-010", "FR-011"]));
  });

  it("7.5 — ui_evidence_required parsed from JSON task flags block (canonical flag parser)", async () => {
    // JSON block with ui_evidence_required=true triggers check 8
    const uiBriefJson = BRIEF_WITH_FLAGS_JSON.replace('"ui_evidence_required": false', '"ui_evidence_required": true');
    setupBriefContent(uiBriefJson);
    mocks.readFile.mockResolvedValue("# User Flow\n\nStatus: Approved\n\nFlow description.");
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check8 = written.checks.find((c: VerificationCheck) => c.check_number === 8)!;
    // Flag parsed correctly from JSON block, triggering UX check (not SKIP)
    expect(check8.result).not.toBe("SKIP");
  });

  it("7.6 — ui_evidence_required parsed from markdown task flags block (canonical flag parser)", async () => {
    // Markdown block with ui_evidence_required=true triggers check 8
    const uiBriefMd = BRIEF_WITH_FLAGS_MD.replace("**ui_evidence_required:** false", "**ui_evidence_required:** true");
    setupBriefContent(uiBriefMd);
    mocks.readFile.mockRejectedValue(new Error("ENOENT")); // user_flow.md missing → FAIL
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    const result = await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx) as VerifierOutput;

    expect(result.passed).toBe(false);
    const wroteJson = mocks.write.mock.calls.find(([, name]: string[]) => name === "verification_result.json");
    const written = JSON.parse(wroteJson![2] as string) as VerificationResult;
    const check8 = written.checks.find((c: VerificationCheck) => c.check_number === 8)!;
    // Flag parsed from markdown, check 8 runs and fails (not SKIP)
    expect(check8.result).toBe("FAIL");
  });

  it("7.7 — multiple task flags parsed together and all included in governance prompt", async () => {
    setupBriefContent(BRIEF_WITH_FLAGS_JSON);
    mocks.chatJson.mockResolvedValue(GOVERNANCE_PASS_RESPONSE);

    const ctx = makeContext();
    await script.run({
      previous_artifacts: ["/artifacts/AI_IMPLEMENTATION_BRIEF.md", "/artifacts/current_task.json", "/artifacts/test_results.json"],
      pipeline_id: PIPELINE_ID,
    }, ctx);

    const chatCall = mocks.chatJson.mock.calls[0];
    const userMsg = (chatCall[0] as Array<{ role: string; content: string }>).find((m) => m.role === "user")!;
    expect(userMsg.content).toContain("incident_tier");
    expect(userMsg.content).toContain("tier-2");
    expect(userMsg.content).toContain("architecture_contract_change");
    expect(userMsg.content).toContain("fr_ids_in_scope");
  });
});
