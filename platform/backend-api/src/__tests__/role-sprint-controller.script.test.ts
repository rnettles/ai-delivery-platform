import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findFirst = vi.fn();
  const write = vi.fn();
  const getComposedPrompt = vi.fn();
  const chatJson = vi.fn();
  const forRole = vi.fn(async () => ({ chatJson }));
  const get = vi.fn();
  const setSprintBranch = vi.fn();
  const getById = vi.fn();
  const getByName = vi.fn();
  const ensureReady = vi.fn();
  const createBranch = vi.fn();
  const checkoutBranch = vi.fn();
  const setPrDetails = vi.fn();
  const createPullRequestWithRecovery = vi.fn();
  const findOpenPullRequestByHead = vi.fn();
  const requireRelevantDesignInputs = vi.fn();
  const readdir = vi.fn();
  const readFile = vi.fn();
  const writeFile = vi.fn();
  const mkdir = vi.fn();
  const commitAll = vi.fn();
  const pushBranch = vi.fn();

  return {
    findFirst,
    write,
    getComposedPrompt,
    chatJson,
    forRole,
    get,
    setSprintBranch,
    getById,
    getByName,
    ensureReady,
    createBranch,
    checkoutBranch,
    setPrDetails,
    createPullRequestWithRecovery,
    findOpenPullRequestByHead,
    requireRelevantDesignInputs,
    readdir,
    readFile,
    writeFile,
    mkdir,
    commitAll,
    pushBranch,
  };
})

vi.mock("fs/promises", () => ({
  default: {
    readdir: mocks.readdir,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
  },
}));

vi.mock("../services/artifact.service", () => ({
  artifactService: {
    findFirst: mocks.findFirst,
    write: mocks.write,
  },
}));

vi.mock("../services/governance.service", () => ({
  governanceService: {
    getComposedPrompt: mocks.getComposedPrompt,
  },
}));

vi.mock("../services/llm/llm-factory.service", () => ({
  llmFactory: {
    forRole: mocks.forRole,
  },
}));

vi.mock("../services/pipeline.service", () => ({
  pipelineService: {
    get: mocks.get,
    setSprintBranch: mocks.setSprintBranch,
    setPrDetails: mocks.setPrDetails,
  },
}));

vi.mock("../services/project.service", () => ({
  projectService: {
    getById: mocks.getById,
    getByName: mocks.getByName,
  },
}));

vi.mock("../services/project-git.service", () => ({
  projectGitService: {
    ensureReady: mocks.ensureReady,
    createBranch: mocks.createBranch,
    checkoutBranch: mocks.checkoutBranch,
    commitAll: mocks.commitAll,
    push: mocks.pushBranch,
  },
}));

vi.mock("../services/pr-remediation.service", () => ({
  prRemediationService: {
    createPullRequestWithRecovery: mocks.createPullRequestWithRecovery,
  },
}));

vi.mock("../services/github-api.service", () => ({
  githubApiService: {
    findOpenPullRequestByHead: mocks.findOpenPullRequestByHead,
  },
}));

vi.mock("../services/design-input-gate.service", () => ({
  designInputGateService: {
    requireRelevantDesignInputs: mocks.requireRelevantDesignInputs,
  },
}));

import { SprintControllerScript } from "../scripts/role-sprint-controller.script";
import { ScriptExecutionContext } from "../scripts/script.interface";

// ─── Staged sprint plan markdown fixtures ───────────────────────────────────
// Must satisfy parseActiveSprintPlan() and parseFirstTaskFromSprintPlan().
const DEFAULT_SPRINT_PLAN_MD = `# Sprint Plan: S01

**Phase:** PH-001
**Name:** Sprint 1
**Status:** staged
**Execution mode:** normal

## Goals
- Deliver feature

## Tasks
- S01-001

---

## First Task Detail: S01-001

**Implement feature** [S]

Do it.

**Files likely affected:**
- \`src/file.ts\`

**Acceptance criteria:**
- Done
`;

const FAST_TRACK_SPRINT_PLAN_MD = `# Sprint Plan: S01

**Phase:** PH-001
**Name:** Sprint 1
**Status:** staged
**Execution mode:** fast-track
**Lane:** ui-critical
**Rationale:** Deadline pressure
**Intake:** RC-042

## Goals
- Deliver feature

## Tasks
- S01-001

---

## First Task Detail: S01-001

**Implement feature** [S]

Do it.

**Files likely affected:**
- \`src/file.ts\`

**Acceptance criteria:**
- Done
`;

const FAST_TRACK_NO_LANE_SPRINT_PLAN_MD = `# Sprint Plan: S01

**Phase:** PH-001
**Name:** Sprint 1
**Status:** staged
**Execution mode:** fast-track
**Rationale:** Deadline pressure
**Intake:** RC-042

## Goals
- Deliver feature

## Tasks
- S01-001

---

## First Task Detail: S01-001

**Implement feature** [S]

Do it.

**Files likely affected:**
- \`src/file.ts\`

**Acceptance criteria:**
- Done
`;

/** Wire path-aware readdir/readFile mocks for a fresh setup (no active task, staged sprint plan present). */
function wireReadFileFreshSetup(sprintPlanMd = DEFAULT_SPRINT_PLAN_MD) {
  mocks.readdir.mockImplementation(async (dirPath: string) => {
    if (String(dirPath).includes("staged_sprints")) {
      return [{ isFile: () => true, name: "sprint_plan_s01.md" }];
    }
    return [];
  });
  mocks.readFile.mockImplementation(async (filePath: string) => {
    if (String(filePath).includes("sprint_plan_s01.md")) return sprintPlanMd;
    throw new Error("ENOENT");
  });
}

function makeContext(): ScriptExecutionContext {
  return {
    execution_id: "exec-1",
    correlation_id: "pipe-1",
    metadata: {},
    log: vi.fn(),
    notify: vi.fn(),
  };
}

describe("SprintControllerScript open task reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.write.mockImplementation(async (_pipelineId: string, artifactName: string) => `artifacts/${artifactName}`);
    mocks.requireRelevantDesignInputs.mockResolvedValue({
      sample_files: [],
      project_name: "demo",
      clone_path: "C:/repo",
    });
    mocks.readdir.mockResolvedValue([{ isFile: () => true, name: "sprint_plan_s01.md" }]);
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("sprint_plan_s01.md")) {
        return `# Sprint Plan: S01

**Phase:** PH-UI-001
**Name:** UI foundation
**Status:** staged

## Goals
- Build the first UI slice

## Tasks
- S01-001
`;
      }
      if (filePath.endsWith("AI_IMPLEMENTATION_BRIEF.md")) {
        return `# AI Implementation Brief

**Task ID:** S01-001
**Sprint:** S01
**Phase:** PH-UI-001

## Task Description
Implement brand tokens.

## Files Likely Affected
- \`tailwind.config.js\`
- \`src/styles/globals.css\`

## Acceptance Criteria (Deliverables Checklist)
- [ ] Add brand tokens

## Task Flags
- **fr_ids_in_scope:** ["FR-1.1"]
- **architecture_contract_change:** false
- **ui_evidence_required:** true
- **incident_tier:** "none"
`;
      }
      if (filePath.endsWith("current_task.json")) {
        return JSON.stringify({
          task_id: "S01-001",
          title: "Extend Tailwind CSS theme with brand tokens",
          description: "Implement brand tokens.",
          status: "pending",
        });
      }
      throw new Error(`Unexpected file: ${filePath}`);
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo" });
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.commitAll.mockResolvedValue(undefined);
    mocks.pushBranch.mockResolvedValue(undefined);
  });

  it("reuses the existing active task package without calling the LLM or creating a branch", async () => {
    const script = new SprintControllerScript();
    const context = makeContext();
    const output = await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, context);

    expect(mocks.forRole).not.toHaveBeenCalled();
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.createPullRequestWithRecovery).not.toHaveBeenCalled();
    expect(mocks.setSprintBranch).toHaveBeenCalledWith("pipe-1", "feature/S01-001");
    expect(mocks.write).toHaveBeenCalledTimes(3);
    expect(context.notify).toHaveBeenCalledWith(
      "♻️ Task S01-001 in S01 is still open. Finish the pending task and pass its close-out gate before requesting another task package."
    );
    expect((output as { sprint_id: string; first_task: { task_id: string } }).sprint_id).toBe("S01");
    expect((output as { first_task: { task_id: string } }).first_task.task_id).toBe("S01-001");
  });

  it("rejects close-out when verifier PASS task_id does not match current task", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json"))) {
        return {
          path: "artifacts/verification_result.json",
          content: JSON.stringify({ result: "PASS", task_id: "S01-999", summary: "ok" }),
        };
      }
      if (paths.some((p) => p.includes("current_task.json"))) {
        return {
          path: "artifacts/current_task.json",
          content: JSON.stringify({ task_id: "S01-001" }),
        };
      }
      if (paths.some((p) => p.includes("implementation_summary"))) {
        return {
          path: "artifacts/implementation_summary.md",
          content: "# Implementation Summary",
        };
      }
      if (paths.some((p) => p.includes("sprint_plan_"))) {
        return {
          path: "artifacts/sprint_plan_s01.md",
          content: "# Sprint Plan: S01",
        };
      }
      return null;
    });

    const script = new SprintControllerScript();
    const context = makeContext();
    await expect(
      script.run(
        {
          pipeline_id: "pipe-1",
          previous_artifacts: [
            "artifacts/verification_result.json",
            "artifacts/current_task.json",
            "artifacts/implementation_summary.md",
            "artifacts/sprint_plan_s01.md",
          ],
        },
        context
      )
    ).rejects.toThrow("Verifier PASS does not match the active task context");

    expect(context.notify).toHaveBeenCalledWith(
      "❗ Cannot close task: verifier reported S01-999 but active task is S01-001. Complete verification for the active task before requesting sprint close-out."
    );
  });

  it("accepts close-out when verifier PASS matches current task", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json"))) {
        return {
          path: "artifacts/verification_result.json",
          content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }),
        };
      }
      if (paths.some((p) => p.includes("current_task.json"))) {
        return {
          path: "artifacts/current_task.json",
          content: JSON.stringify({ task_id: "S01-001" }),
        };
      }
      if (paths.some((p) => p.includes("implementation_summary"))) {
        return {
          path: "artifacts/implementation_summary.md",
          content: "# Implementation Summary",
        };
      }
      if (paths.some((p) => p.includes("sprint_plan_"))) {
        return {
          path: "artifacts/sprint_plan_s01.md",
          content: "# Sprint Plan: S01",
        };
      }
      return null;
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: "feature/S01-001" });

    const script = new SprintControllerScript();
    const output = await script.run(
      {
        pipeline_id: "pipe-1",
        previous_artifacts: [
          "artifacts/verification_result.json",
          "artifacts/current_task.json",
          "artifacts/implementation_summary.md",
          "artifacts/sprint_plan_s01.md",
        ],
      },
      makeContext()
    );

    const out = output as { mode: string; last_completed_task_id: string; close_out_phase_completed: string; stop_required: boolean };
    expect(out.mode).toBe("close_out");
    expect(out.last_completed_task_id).toBe("S01-001");
    expect(out.close_out_phase_completed).toBe("task_close");
    expect(out.stop_required).toBe(true);
  });
});

// ─── Phase 5: Task Flags and Fast-Track Controls ────────────────────────────
describe("Phase 5 — Task Flags and Fast-Track Controls", () => {
  /** Minimal valid LLM response for fresh runSetup(). */
  function makeLlmResponse(overrides: {
    task_flags?: Record<string, unknown>;
    sprint_plan?: Record<string, unknown>;
  } = {}) {
    return {
      sprint_plan: {
        sprint_id: "S01",
        phase_id: "PH-001",
        name: "Sprint 1",
        goals: ["Deliver feature"],
        tasks: ["S01-001"],
        status: "staged",
        execution_mode: "normal",
        ...overrides.sprint_plan,
      },
      first_task: {
        task_id: "S01-001",
        title: "Implement feature",
        description: "Do it.",
        acceptance_criteria: ["Done"],
        estimated_effort: "S",
        files_likely_affected: ["src/file.ts"],
        status: "pending",
      },
      task_flags: {
        fr_ids_in_scope: ["FR-1"],
        architecture_contract_change: false,
        ui_evidence_required: false,
        incident_tier: "none",
        ...overrides.task_flags,
      },
    };
  }

  /** Wire common mocks for a fresh runSetup() path (no active task, staged sprint plan present). */
  function setupFreshRun(sprintPlanMd = DEFAULT_SPRINT_PLAN_MD) {
    wireReadFileFreshSetup(sprintPlanMd);
    mocks.findFirst.mockResolvedValue(null);
    mocks.getComposedPrompt.mockResolvedValue("system prompt");
    mocks.requireRelevantDesignInputs.mockResolvedValue({
      sample_files: [],
      project_name: "demo",
      clone_path: "C:/repo",
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo", default_branch: "main" });
    mocks.createPullRequestWithRecovery.mockResolvedValue({
      pr: { number: 1, html_url: "https://github.com/test/pr/1" },
      remediation_performed: false,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pipelineId: string, artifactName: string) => `artifacts/${artifactName}`);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.commitAll.mockResolvedValue(undefined);
    mocks.pushBranch.mockResolvedValue(undefined);
  });

  // ── 5.1 Required flag validation ──────────────────────────────────────────

  it("5.1 throws MISSING_TASK_FLAGS when LLM omits incident_tier", async () => {
    setupFreshRun();
    mocks.chatJson.mockResolvedValue(
      makeLlmResponse({ task_flags: { incident_tier: undefined } })
    );

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("required task flags are missing or null");
  });

  it("5.1 throws MISSING_TASK_FLAGS when architecture_contract_change is null", async () => {
    setupFreshRun();
    mocks.chatJson.mockResolvedValue(
      makeLlmResponse({ task_flags: { architecture_contract_change: null } })
    );

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("required task flags are missing or null");
  });

  it("5.1 throws MISSING_TASK_FLAGS when fr_ids_in_scope is not an array", async () => {
    setupFreshRun();
    mocks.chatJson.mockResolvedValue(
      makeLlmResponse({ task_flags: { fr_ids_in_scope: null } })
    );

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("required task flags are missing or null");
  });

  it("5.1 accepts an empty fr_ids_in_scope array as valid", async () => {
    setupFreshRun();
    mocks.chatJson.mockResolvedValue(
      makeLlmResponse({ task_flags: { fr_ids_in_scope: [] } })
    );

    const script = new SprintControllerScript();
    // Should not throw on empty array — empty is allowed; only null/undefined is a violation.
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).resolves.toBeDefined();
  });

  // ── 5.2 Sprint-controller as sole flag authority (TFC-003) ─────────────────

  it("5.2 upstream task_flags in input are ignored; output uses LLM-generated flags (TFC-003)", async () => {
    setupFreshRun();
    const llmFlags = { fr_ids_in_scope: ["FR-99"], architecture_contract_change: true, ui_evidence_required: false, incident_tier: "p1" };
    mocks.chatJson.mockResolvedValue(makeLlmResponse({ task_flags: llmFlags }));

    const script = new SprintControllerScript();
    // Pass task_flags in raw input — sprint-controller must ignore them.
    const output = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: [], task_flags: { fr_ids_in_scope: ["FR-UPSTREAM"], incident_tier: "p0" } } as Record<string, unknown>,
      makeContext()
    );

    const out = output as { task_flags: { fr_ids_in_scope: string[]; incident_tier: string } };
    expect(out.task_flags.fr_ids_in_scope).toEqual(["FR-99"]);
    expect(out.task_flags.incident_tier).toBe("p1");
  });

  // ── 5.3 Fast-track prerequisite enforcement ───────────────────────────────

  it("5.3 throws FAST_TRACK_PREREQUISITES_MISSING when fast-track sprint plan is missing lane", async () => {
    setupFreshRun(FAST_TRACK_NO_LANE_SPRINT_PLAN_MD);
    mocks.chatJson.mockResolvedValue(makeLlmResponse());
    // next_steps.md mentions fast-track so only the lane check fails
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (String(filePath).includes("sprint_plan_")) return FAST_TRACK_NO_LANE_SPRINT_PLAN_MD;
      if (String(filePath).includes("next_steps.md")) return "This sprint runs in fast-track mode.";
      throw new Error("ENOENT");
    });

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("fast-track is blocked");
  });

  it("5.3 throws FAST_TRACK_PREREQUISITES_MISSING when next_steps.md does not mention fast-track", async () => {
    setupFreshRun(FAST_TRACK_SPRINT_PLAN_MD);
    mocks.chatJson.mockResolvedValue(makeLlmResponse());
    // next_steps.md exists but does NOT mention fast-track
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (String(filePath).includes("sprint_plan_")) return FAST_TRACK_SPRINT_PLAN_MD;
      if (String(filePath).includes("next_steps.md")) return "Next steps: implement the feature normally.";
      throw new Error("ENOENT");
    });

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("fast-track is blocked");
  });

  it("5.3 throws FAST_TRACK_PREREQUISITES_MISSING when next_steps.md is absent", async () => {
    setupFreshRun(FAST_TRACK_SPRINT_PLAN_MD);
    mocks.chatJson.mockResolvedValue(makeLlmResponse());
    // Sprint plan readable but next_steps.md throws ENOENT
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (String(filePath).includes("sprint_plan_")) return FAST_TRACK_SPRINT_PLAN_MD;
      throw new Error("ENOENT");
    });

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("fast-track is blocked");
  });

  it("5.3 normal execution mode does not invoke fast-track prerequisite check", async () => {
    setupFreshRun(); // DEFAULT_SPRINT_PLAN_MD has execution_mode: normal
    mocks.chatJson.mockResolvedValue(makeLlmResponse());
    // next_steps.md must NOT be read for normal mode — readFile will throw if called with that path

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const nextStepsCall = mocks.readFile.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("next_steps.md")
    );
    expect(nextStepsCall).toBeUndefined();
  });

  // ── 5.4 Fast Track Controls block injection ───────────────────────────────

  it("5.4 brief includes Fast Track Controls block for fast-track execution mode", async () => {
    setupFreshRun(FAST_TRACK_SPRINT_PLAN_MD);
    mocks.chatJson.mockResolvedValue(makeLlmResponse());
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (String(filePath).includes("sprint_plan_")) return FAST_TRACK_SPRINT_PLAN_MD;
      if (String(filePath).includes("next_steps.md")) return "Approved fast-track sprint for this cycle.";
      throw new Error("ENOENT");
    });

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const writeCall = mocks.write.mock.calls.find((c: unknown[]) => c[1] === "AI_IMPLEMENTATION_BRIEF.md");
    expect(writeCall).toBeDefined();
    const briefContent = writeCall![2] as string;
    expect(briefContent).toContain("## Fast Track Controls");
    expect(briefContent).toContain("fast-track (operator-approved)");
    expect(briefContent).toContain("RC-042");
    expect(briefContent).toContain("GTR-004");
    expect(briefContent).toContain("RUL-007");
  });

  it("5.4 brief does NOT include Fast Track Controls block for normal execution mode", async () => {
    setupFreshRun();
    mocks.chatJson.mockResolvedValue(makeLlmResponse({ sprint_plan: { execution_mode: "normal" } }));

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const writeCall = mocks.write.mock.calls.find((c: unknown[]) => c[1] === "AI_IMPLEMENTATION_BRIEF.md");
    expect(writeCall).toBeDefined();
    expect(writeCall![2] as string).not.toContain("## Fast Track Controls");
  });
});

// ─── Phase 6: Input/Output Contract Reconciliation ──────────────────────────
describe("Phase 6 — Input/Output Contract Reconciliation", () => {
  function makeValidLlmResponse() {
    return {
      sprint_plan: {
        sprint_id: "S01",
        phase_id: "PH-001",
        name: "Sprint 1",
        goals: ["Deliver feature"],
        tasks: ["S01-001"],
        status: "staged",
        execution_mode: "normal",
      },
      first_task: {
        task_id: "S01-001",
        title: "Implement feature",
        description: "Do it.",
        acceptance_criteria: ["Done"],
        estimated_effort: "S",
        files_likely_affected: ["src/file.ts"],
        status: "pending",
      },
      task_flags: {
        fr_ids_in_scope: ["FR-1"],
        architecture_contract_change: false,
        ui_evidence_required: false,
        incident_tier: "none",
      },
    };
  }

  function wireSetupRun() {
    wireReadFileFreshSetup();
    mocks.findFirst.mockResolvedValue(null);
    mocks.getComposedPrompt.mockResolvedValue("system prompt");
    mocks.requireRelevantDesignInputs.mockResolvedValue({
      sample_files: [],
      project_name: "demo",
      clone_path: "C:/repo",
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo", default_branch: "main" });
    mocks.createPullRequestWithRecovery.mockResolvedValue({
      pr: { number: 7, html_url: "https://github.com/test/pr/7" },
      remediation_performed: false,
    });
  }

  function wireCloseOutRun() {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json"))) {
        return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }) };
      }
      if (paths.some((p) => p.includes("current_task.json"))) {
        return { path: "artifacts/current_task.json", content: JSON.stringify({ task_id: "S01-001" }) };
      }
      if (paths.some((p) => p.includes("implementation_summary"))) {
        return { path: "artifacts/implementation_summary.md", content: "# Implementation Summary" };
      }
      if (paths.some((p) => p.includes("sprint_plan_"))) {
        return { path: "artifacts/sprint_plan_s01.md", content: "# Sprint Plan: S01" };
      }
      return null;
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: "feature/S01-001" });
  }

  const CLOSE_OUT_ARTIFACTS = [
    "artifacts/verification_result.json",
    "artifacts/current_task.json",
    "artifacts/implementation_summary.md",
    "artifacts/sprint_plan_s01.md",
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pipelineId: string, artifactName: string) => `artifacts/${artifactName}`);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.commitAll.mockResolvedValue(undefined);
    mocks.pushBranch.mockResolvedValue(undefined);
  });

  // ── 6.1 Setup-mode output alignment ──────────────────────────────────────

  it("6.1 setup output carries mode='setup', non-empty sprint_state_path, pr_number, pr_url", async () => {
    wireSetupRun();
    mocks.chatJson.mockResolvedValue(makeValidLlmResponse());

    const script = new SprintControllerScript();
    const output = await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext()) as Record<string, unknown>;

    expect(output.mode).toBe("setup");
    expect(typeof output.sprint_state_path).toBe("string");
    expect(output.sprint_state_path).not.toBe("");
    expect(output.pr_number).toBe(7);
    expect(output.pr_url).toBe("https://github.com/test/pr/7");
  });

  it("6.1 sprint_state_path is included in artifact_paths", async () => {
    wireSetupRun();
    mocks.chatJson.mockResolvedValue(makeValidLlmResponse());

    const script = new SprintControllerScript();
    const output = await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext()) as Record<string, unknown>;

    const paths = output.artifact_paths as string[];
    expect(paths).toContain(output.sprint_state_path as string);
  });

  it("6.1 sprint_state.json written to repo with sprint_id, active_task_id, and empty completed_tasks", async () => {
    wireSetupRun();
    mocks.chatJson.mockResolvedValue(makeValidLlmResponse());

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const stateWriteCall = mocks.writeFile.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("sprint_state.json")
    );
    expect(stateWriteCall).toBeDefined();
    const written = JSON.parse(stateWriteCall![1] as string);
    expect(written.sprint_id).toBe("S01");
    expect(written.active_task_id).toBe("S01-001");
    expect(Array.isArray(written.completed_tasks)).toBe(true);
    expect(written.completed_tasks).toHaveLength(0);
  });

  // ── 6.2 Close-out output alignment ───────────────────────────────────────

  it("6.2 close-out output carries mode='close_out', non-empty closeout_path, last_completed_task_id, sprint_complete_artifacts", async () => {
    wireCloseOutRun();

    const script = new SprintControllerScript();
    const output = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: CLOSE_OUT_ARTIFACTS },
      makeContext()
    ) as Record<string, unknown>;

    expect(output.mode).toBe("close_out");
    expect(typeof output.closeout_path).toBe("string");
    expect(output.closeout_path).not.toBe("");
    expect(output.last_completed_task_id).toBe("S01-001");
    expect(Array.isArray(output.sprint_complete_artifacts)).toBe(true);
    expect((output.sprint_complete_artifacts as string[]).length).toBeGreaterThan(0);
  });

  it("6.2 close-out output does not contain placeholder brief_path, task_flags, or first_task", async () => {
    wireCloseOutRun();

    const script = new SprintControllerScript();
    const output = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: CLOSE_OUT_ARTIFACTS },
      makeContext()
    );

    expect(output).not.toHaveProperty("brief_path");
    expect(output).not.toHaveProperty("task_flags");
    expect(output).not.toHaveProperty("first_task");
  });

  // ── 6.3 closeout_path is a formal output field ────────────────────────────

  it("6.3 closeout_path appears in artifact_paths when close-out succeeds", async () => {
    wireCloseOutRun();

    const script = new SprintControllerScript();
    const output = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: CLOSE_OUT_ARTIFACTS },
      makeContext()
    ) as Record<string, unknown>;

    const paths = output.artifact_paths as string[];
    expect(paths).toContain(output.closeout_path as string);
  });

  // ── 6.4 Mode discriminant distinguishes setup vs close-out ───────────────

  it("6.4 mode discriminant is 'setup' for staging and 'close_out' for close-out; values are distinct", async () => {
    wireSetupRun();
    mocks.chatJson.mockResolvedValue(makeValidLlmResponse());
    const script = new SprintControllerScript();

    const setupOut = await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext()) as Record<string, unknown>;
    expect(setupOut.mode).toBe("setup");

    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pid: string, name: string) => `artifacts/${name}`);
    wireCloseOutRun();
    const closeOut = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: CLOSE_OUT_ARTIFACTS },
      makeContext()
    ) as Record<string, unknown>;
    expect(closeOut.mode).toBe("close_out");
    expect(closeOut.mode).not.toBe(setupOut.mode);
  });
});

// ─── Phase 7: Orchestration and Instruction Gating ──────────────────────────
describe("Phase 7 — Orchestration and Instruction Gating", () => {
  const PHASE1_CLOSEOUT_CONTENT = JSON.stringify({
    pipeline_id: "pipe-1",
    sprint_id: "S01",
    sprint_branch: "feature/S01-001",
    last_completed_task_id: "S01-001",
    closeout_role: "sprint-controller",
    closeout_scope: "task",
    gate_result: "PASS",
    close_out_phase_completed: "task_close",
    verifier_summary: "ok",
    sprint_complete_artifacts: ["artifacts/sprint_plan_s01.md"],
  });

  const PHASE2_CLOSEOUT_CONTENT = JSON.stringify({
    pipeline_id: "pipe-1",
    sprint_id: "S01",
    sprint_branch: "feature/S01-001",
    last_completed_task_id: "S01-001",
    closeout_role: "sprint-controller",
    closeout_scope: "task",
    gate_result: "PASS",
    close_out_phase_completed: "pr_confirmed",
    verifier_summary: "ok",
    sprint_complete_artifacts: ["artifacts/sprint_plan_s01.md"],
  });

  function makePhase1Artifacts() {
    return [
      "artifacts/verification_result.json",
      "artifacts/current_task.json",
      "artifacts/implementation_summary.md",
      "artifacts/sprint_plan_s01.md",
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pid: string, name: string) => `artifacts/${name}`);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.commitAll.mockResolvedValue(undefined);
    mocks.pushBranch.mockResolvedValue(undefined);
  });

  // ── 7.1 Phase 1 output carries phase-tracking fields ─────────────────────

  it("7.1 Phase 1 output sets close_out_phase_completed=task_close and stop_required=true", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json")))
        return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }) };
      if (paths.some((p) => p.includes("current_task.json")))
        return { path: "artifacts/current_task.json", content: JSON.stringify({ task_id: "S01-001" }) };
      if (paths.some((p) => p.includes("implementation_summary")))
        return { path: "artifacts/implementation_summary.md", content: "# Summary" };
      if (paths.some((p) => p.includes("sprint_plan_")))
        return { path: "artifacts/sprint_plan_s01.md", content: "# Sprint Plan: S01" };
      return null;
    });
    mocks.get.mockResolvedValue({ sprint_branch: "feature/S01-001" });

    const script = new SprintControllerScript();
    const out = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: makePhase1Artifacts() },
      makeContext()
    ) as Record<string, unknown>;

    expect(out.mode).toBe("close_out");
    expect(out.close_out_phase_completed).toBe("task_close");
    expect(out.stop_required).toBe(true);
  });

  it("7.1 sprint_closeout.json written in Phase 1 includes close_out_phase_completed=task_close and sprint_id", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json")))
        return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }) };
      if (paths.some((p) => p.includes("current_task.json")))
        return { path: "artifacts/current_task.json", content: JSON.stringify({ task_id: "S01-001" }) };
      if (paths.some((p) => p.includes("implementation_summary")))
        return { path: "artifacts/implementation_summary.md", content: "# Summary" };
      if (paths.some((p) => p.includes("sprint_plan_")))
        return { path: "artifacts/sprint_plan_s01.md", content: "# Sprint Plan: S01" };
      return null;
    });
    mocks.get.mockResolvedValue({ sprint_branch: "feature/S01-001" });

    const script = new SprintControllerScript();
    await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: makePhase1Artifacts() },
      makeContext()
    );

    const writeCall = mocks.write.mock.calls.find((c: unknown[]) => c[1] === "sprint_closeout.json");
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![2] as string);
    expect(written.close_out_phase_completed).toBe("task_close");
    expect(written.sprint_id).toBeDefined();
  });

  // ── 7.2 No implicit transition to Phase 2 or Phase 3 ─────────────────────

  it("7.2 PASS in previous_artifacts without close_out_phase token does NOT advance to Phase 3 setup", async () => {
    // Simulate a pipeline where Phase 1 already completed and sprint_closeout.json is present
    // alongside a new verification_result.json — without close_out_phase token, only Phase 1 re-runs.
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json")))
        return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }) };
      if (paths.some((p) => p.includes("current_task.json")))
        return { path: "artifacts/current_task.json", content: JSON.stringify({ task_id: "S01-001" }) };
      if (paths.some((p) => p.includes("implementation_summary")))
        return { path: "artifacts/implementation_summary.md", content: "# Summary" };
      if (paths.some((p) => p.includes("sprint_plan_")))
        return { path: "artifacts/sprint_plan_s01.md", content: "# Sprint Plan: S01" };
      return null;
    });
    mocks.get.mockResolvedValue({ sprint_branch: "feature/S01-001" });

    const script = new SprintControllerScript();
    const out = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: makePhase1Artifacts() },
      makeContext()
    ) as Record<string, unknown>;

    // Must be close_out (Phase 1), not setup (Phase 3 would be mode: "setup")
    expect(out.mode).toBe("close_out");
    expect(out.close_out_phase_completed).toBe("task_close");
    expect(mocks.forRole).not.toHaveBeenCalled(); // LLM not called — setup not triggered
  });

  // ── 7.1 Phase 2 gate enforcement ─────────────────────────────────────────

  it("7.1 Phase 2 throws CLOSE_OUT_PHASE_GATE when sprint_closeout.json is absent", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const script = new SprintControllerScript();
    await expect(
      script.run(
        { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "pr_confirmed" },
        makeContext()
      )
    ).rejects.toThrow("requires sprint_closeout.json from Phase 1");
  });

  it("7.1 Phase 2 throws CLOSE_OUT_PHASE_GATE when close_out_phase_completed != task_close", async () => {
    // Simulate Phase 2 being invoked again after it already ran (pr_confirmed state)
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json")))
        return { path: "artifacts/sprint_closeout.json", content: PHASE2_CLOSEOUT_CONTENT };
      return null;
    });

    const script = new SprintControllerScript();
    await expect(
      script.run(
        { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "pr_confirmed" },
        makeContext()
      )
    ).rejects.toThrow("Phase 1 (task_close) must be completed first");
  });

  it("7.1 Phase 2 succeeds when close_out_phase_completed=task_close and returns pr_confirmed stop output", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json")))
        return { path: "artifacts/sprint_closeout.json", content: PHASE1_CLOSEOUT_CONTENT };
      return null;
    });
    // No project_id — git write-to-main block is skipped (project is null).
    mocks.get.mockResolvedValue({ project_id: null });

    const script = new SprintControllerScript();
    const out = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "pr_confirmed" },
      makeContext()
    ) as Record<string, unknown>;

    expect(out.mode).toBe("close_out");
    expect(out.close_out_phase_completed).toBe("pr_confirmed");
    expect(out.stop_required).toBe(true);
    expect(typeof out.closeout_path).toBe("string");
    expect(out.closeout_path).not.toBe("");
  });

  // ── 7.1 Phase 3 gate enforcement ─────────────────────────────────────────

  it("7.1 Phase 3 throws CLOSE_OUT_PHASE_GATE when sprint_closeout.json is absent", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const script = new SprintControllerScript();
    await expect(
      script.run(
        { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "stage_next" },
        makeContext()
      )
    ).rejects.toThrow("requires sprint_closeout.json from Phase 1 and Phase 2");
  });

  it("7.1 Phase 3 throws CLOSE_OUT_PHASE_GATE when close_out_phase_completed=task_close (Phase 2 not done)", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json")))
        return { path: "artifacts/sprint_closeout.json", content: PHASE1_CLOSEOUT_CONTENT };
      return null;
    });

    const script = new SprintControllerScript();
    await expect(
      script.run(
        { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "stage_next" },
        makeContext()
      )
    ).rejects.toThrow("Phase 2 (pr_confirmed) must be completed first");
  });

  it("7.1/7.3 Phase 3 proceeds to setup (mode=setup) when close_out_phase_completed=pr_confirmed", async () => {
    // Phase 3 guard passes; runSetup runs through LLM and produces a setup output.
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json")))
        return { path: "artifacts/sprint_closeout.json", content: PHASE2_CLOSEOUT_CONTENT };
      // No verification_result.json, no phase plan — setup falls through to staged sprint plan
      return null;
    });
    wireReadFileFreshSetup();
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo", clone_path: "C:/repo" });
    mocks.getComposedPrompt.mockResolvedValue("system prompt");
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo", default_branch: "main" });
    mocks.chatJson.mockResolvedValue({
      task_flags: { fr_ids_in_scope: ["FR-2"], architecture_contract_change: false, ui_evidence_required: false, incident_tier: "none" },
    });
    mocks.createPullRequestWithRecovery.mockResolvedValue({
      pr: { number: 2, html_url: "https://github.com/test/pr/2" },
      remediation_performed: false,
    });

    const script = new SprintControllerScript();
    const out = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "stage_next" },
      makeContext()
    ) as Record<string, unknown>;

    expect(out.mode).toBe("setup");
    expect(mocks.forRole).toHaveBeenCalled(); // LLM was invoked for next task staging
  });
});

// ─── Phase 9: Verification and Regression Coverage ──────────────────────────
describe("Phase 9 — Verification and Regression Coverage", () => {
  function makeValidLlmResponse() {
    return {
      sprint_plan: { sprint_id: "S02", phase_id: "PH-002", name: "Sprint 2", goals: ["goal"], tasks: ["S02-001"], status: "staged", execution_mode: "normal" },
      first_task: { task_id: "S02-001", title: "Next feature", description: "Build it.", acceptance_criteria: ["Done"], estimated_effort: "S", files_likely_affected: ["src/f.ts"], status: "pending" },
      task_flags: { fr_ids_in_scope: ["FR-2"], architecture_contract_change: false, ui_evidence_required: false, incident_tier: "none" },
    };
  }

  function wireFreshSetup() {
    wireReadFileFreshSetup();
    mocks.findFirst.mockResolvedValue(null);
    mocks.getComposedPrompt.mockResolvedValue("system prompt");
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo", clone_path: "C:/repo" });
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo", default_branch: "main" });
    mocks.createPullRequestWithRecovery.mockResolvedValue({
      pr: { number: 3, html_url: "https://github.com/test/pr/3" },
      remediation_performed: false,
    });
    mocks.chatJson.mockResolvedValue(makeValidLlmResponse());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pid: string, name: string) => `artifacts/${name}`);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.commitAll.mockResolvedValue(undefined);
    mocks.pushBranch.mockResolvedValue(undefined);
  });

  // ── 9.1 Pre-stage status gate (SCT-A) ────────────────────────────────────

  it("9.1 ready_for_verification status is treated as open and blocks fresh staging (reuses package)", async () => {
    // Arrange: active task has status=ready_for_verification (awaiting verifier) — must block
    mocks.findFirst.mockResolvedValue(null); // no verification_result.json
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo", clone_path: "C:/repo" });
    mocks.readdir.mockResolvedValue([{ isFile: () => true, name: "sprint_plan_s01.md" }]);
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (String(filePath).endsWith("sprint_plan_s01.md")) return "# Sprint Plan: S01\n**Phase:** PH-001\n**Name:** In progress\n**Status:** staged\n## Goals\n- g\n## Tasks\n- S01-001";
      if (String(filePath).endsWith("AI_IMPLEMENTATION_BRIEF.md")) return `# AI Implementation Brief\n**Task ID:** S01-001\n**Sprint:** S01\n**Phase:** PH-001\n## Task Description\nDo it.\n## Files Likely Affected\n- \`f.ts\`\n## Acceptance Criteria (Deliverables Checklist)\n- [ ] done\n## Task Flags\n- **fr_ids_in_scope:** []\n- **architecture_contract_change:** false\n- **ui_evidence_required:** false\n- **incident_tier:** "none"`;
      if (String(filePath).endsWith("current_task.json")) return JSON.stringify({ task_id: "S01-001", status: "ready_for_verification" });
      throw new Error("ENOENT");
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo" });

    const script = new SprintControllerScript();
    const context = makeContext();
    const out = await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, context) as Record<string, unknown>;

    // Must reuse existing package (mode=setup due to active task) and NOT call LLM
    expect(mocks.forRole).not.toHaveBeenCalled();
    expect(context.notify).toHaveBeenCalledWith(expect.stringContaining("still open"));
    expect((out as { mode: string }).mode).toBe("setup");
    expect((out as { first_task: { task_id: string } }).first_task.task_id).toBe("S01-001");
  });

  // ── 9.1 Canonical brief_path invariant (PTH-001) ─────────────────────────

  it("9.1 current_task.json contains brief_path referencing canonical active brief path", async () => {
    wireFreshSetup();

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const writeCall = mocks.write.mock.calls.find((c: unknown[]) => c[1] === "current_task.json");
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![2] as string);
    expect(written.brief_path).toBeDefined();
    expect(written.brief_path).toContain("AI_IMPLEMENTATION_BRIEF.md");
    expect(written.brief_path).toContain("active");
    // Must NOT be task-suffixed
    expect(written.brief_path).not.toMatch(/AI_IMPLEMENTATION_BRIEF_S\d/);
  });

  it("9.1 brief_path in current_task.json is also persisted to repo via writeFile", async () => {
    wireFreshSetup();

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const repoWriteCall = mocks.writeFile.mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith("current_task.json")
    );
    expect(repoWriteCall).toBeDefined();
    const repoWritten = JSON.parse(repoWriteCall![1] as string);
    expect(repoWritten.brief_path).toBeDefined();
    expect(repoWritten.brief_path).toContain("AI_IMPLEMENTATION_BRIEF.md");
  });

  // ── 9.2 Full 3-phase close-out integration (STOP boundaries) ─────────────

  it("9.2 full 3-phase close-out: Phase 1 -> STOP -> Phase 2 -> STOP -> Phase 3 produces setup output", async () => {
    // Phase 1: verifier PASS -> close task
    const verContent = JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" });
    const ctContent = JSON.stringify({ task_id: "S01-001" });

    function phase1Mocks() {
      mocks.findFirst.mockImplementation(async (paths: string[]) => {
        if (paths.some((p) => p.includes("verification_result.json"))) return { path: "artifacts/verification_result.json", content: verContent };
        if (paths.some((p) => p.includes("current_task.json"))) return { path: "artifacts/current_task.json", content: ctContent };
        if (paths.some((p) => p.includes("implementation_summary"))) return { path: "artifacts/implementation_summary.md", content: "# Summary" };
        if (paths.some((p) => p.includes("sprint_plan_"))) return { path: "artifacts/sprint_plan_s01.md", content: "# Sprint Plan: S01" };
        return null;
      });
      mocks.get.mockResolvedValue({ sprint_branch: "feature/S01-001" });
    }

    const script = new SprintControllerScript();

    // Phase 1
    phase1Mocks();
    const p1Out = await script.run({ pipeline_id: "pipe-1", previous_artifacts: ["artifacts/verification_result.json", "artifacts/current_task.json", "artifacts/implementation_summary.md", "artifacts/sprint_plan_s01.md"] }, makeContext()) as Record<string, unknown>;
    expect(p1Out.mode).toBe("close_out");
    expect(p1Out.close_out_phase_completed).toBe("task_close");
    expect(p1Out.stop_required).toBe(true);

    // Phase 2: operator confirms PR merged
    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pid: string, name: string) => `artifacts/${name}`);
    const closeoutAfterP1 = JSON.stringify({ sprint_id: "S01", last_completed_task_id: "S01-001", sprint_branch: "feature/S01-001", sprint_complete_artifacts: [], close_out_phase_completed: "task_close" });
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json"))) return { path: "artifacts/sprint_closeout.json", content: closeoutAfterP1 };
      return null;
    });
    const p2Out = await script.run({ pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "pr_confirmed" }, makeContext()) as Record<string, unknown>;
    expect(p2Out.mode).toBe("close_out");
    expect(p2Out.close_out_phase_completed).toBe("pr_confirmed");
    expect(p2Out.stop_required).toBe(true);

    // Phase 3: operator stages next task
    vi.clearAllMocks();
    mocks.write.mockImplementation(async (_pid: string, name: string) => `artifacts/${name}`);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.commitAll.mockResolvedValue(undefined);
    mocks.pushBranch.mockResolvedValue(undefined);
    const closeoutAfterP2 = JSON.stringify({ sprint_id: "S01", last_completed_task_id: "S01-001", sprint_branch: "feature/S01-001", sprint_complete_artifacts: [], close_out_phase_completed: "pr_confirmed" });
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json"))) return { path: "artifacts/sprint_closeout.json", content: closeoutAfterP2 };
      return null;
    });
    wireReadFileFreshSetup();
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo", clone_path: "C:/repo" });
    mocks.getComposedPrompt.mockResolvedValue("system prompt");
    mocks.get.mockResolvedValue({ project_id: "proj-1" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", clone_path: "C:/repo", default_branch: "main" });
    mocks.chatJson.mockResolvedValue({ task_flags: { fr_ids_in_scope: ["FR-2"], architecture_contract_change: false, ui_evidence_required: false, incident_tier: "none" } });
    mocks.createPullRequestWithRecovery.mockResolvedValue({ pr: { number: 4, html_url: "https://github.com/test/pr/4" }, remediation_performed: false });

    const p3Out = await script.run({ pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "stage_next" }, makeContext()) as Record<string, unknown>;
    expect(p3Out.mode).toBe("setup");
    expect(mocks.forRole).toHaveBeenCalled();
  });

  // ── 9.3 Negative paths ────────────────────────────────────────────────────

  it("9.3 missing implementation_summary blocks Phase 1 close-out", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json"))) return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }) };
      if (paths.some((p) => p.includes("current_task.json"))) return { path: "artifacts/current_task.json", content: JSON.stringify({ task_id: "S01-001" }) };
      // implementation_summary intentionally absent
      return null;
    });
    mocks.get.mockResolvedValue({ sprint_branch: "feature/S01-001" });

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: ["artifacts/verification_result.json", "artifacts/current_task.json"] }, makeContext())
    ).rejects.toThrow("implementation_summary");
  });

  it("9.3 active-slot sprint_state.json is (re)initialized on every fresh staging run", async () => {
    wireFreshSetup();

    const script = new SprintControllerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    const stateWrites = mocks.writeFile.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith("sprint_state.json"));
    expect(stateWrites.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(stateWrites[stateWrites.length - 1][1] as string);
    expect(last.active_task_id).toBeDefined();
    expect(last.completed_tasks).toEqual([]);
  });

  it("9.3 Phase 3 gate rejects stage_next when Phase 2 has not been confirmed (task_close state)", async () => {
    const closeoutAtTaskClose = JSON.stringify({ sprint_id: "S01", close_out_phase_completed: "task_close", last_completed_task_id: "S01-001", sprint_complete_artifacts: [] });
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("sprint_closeout.json"))) return { path: "artifacts/sprint_closeout.json", content: closeoutAtTaskClose };
      return null;
    });

    const script = new SprintControllerScript();
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: ["artifacts/sprint_closeout.json"], close_out_phase: "stage_next" }, makeContext())
    ).rejects.toThrow("Phase 2 (pr_confirmed) must be completed first");
  });

  // ── 9.4 Schema completeness for both output variants ─────────────────────

  it("9.4 setup output contains all required non-empty schema fields", async () => {
    wireFreshSetup();

    const script = new SprintControllerScript();
    const out = await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext()) as Record<string, unknown>;

    expect(out.mode).toBe("setup");
    expect(typeof out.sprint_id).toBe("string"); expect(out.sprint_id).not.toBe("");
    expect(typeof out.sprint_plan_path).toBe("string"); expect(out.sprint_plan_path).not.toBe("");
    expect(typeof out.brief_path).toBe("string"); expect(out.brief_path).not.toBe("");
    expect(typeof out.current_task_path).toBe("string"); expect(out.current_task_path).not.toBe("");
    expect(typeof out.sprint_state_path).toBe("string"); expect(out.sprint_state_path).not.toBe("");
    expect(Array.isArray((out as { artifact_paths: string[] }).artifact_paths)).toBe(true);
    expect((out as { artifact_paths: string[] }).artifact_paths.length).toBeGreaterThan(0);
  });

  it("9.4 close-out output contains all required non-empty schema fields", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json"))) return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "S01-001", summary: "ok" }) };
      if (paths.some((p) => p.includes("current_task.json"))) return { path: "artifacts/current_task.json", content: JSON.stringify({ task_id: "S01-001" }) };
      if (paths.some((p) => p.includes("implementation_summary"))) return { path: "artifacts/implementation_summary.md", content: "# Summary" };
      if (paths.some((p) => p.includes("sprint_plan_"))) return { path: "artifacts/sprint_plan_s01.md", content: "# Sprint Plan: S01" };
      return null;
    });
    mocks.get.mockResolvedValue({ sprint_branch: "feature/S01-001" });

    const script = new SprintControllerScript();
    const out = await script.run(
      { pipeline_id: "pipe-1", previous_artifacts: ["artifacts/verification_result.json", "artifacts/current_task.json", "artifacts/implementation_summary.md", "artifacts/sprint_plan_s01.md"] },
      makeContext()
    ) as Record<string, unknown>;

    expect(out.mode).toBe("close_out");
    expect(typeof out.sprint_id).toBe("string"); expect(out.sprint_id).not.toBe("");
    expect(typeof out.last_completed_task_id).toBe("string"); expect(out.last_completed_task_id).not.toBe("");
    expect(typeof out.closeout_path).toBe("string"); expect(out.closeout_path).not.toBe("");
    expect(out.close_out_phase_completed).toBe("task_close");
    expect(out.stop_required).toBe(true);
    expect(Array.isArray((out as { sprint_complete_artifacts: string[] }).sprint_complete_artifacts)).toBe(true);
    expect(Array.isArray((out as { artifact_paths: string[] }).artifact_paths)).toBe(true);
    expect((out as { artifact_paths: string[] }).artifact_paths).toContain(out.closeout_path as string);
  });
});