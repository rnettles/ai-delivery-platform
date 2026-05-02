import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findFirst = vi.fn();
  const write = vi.fn();
  const getComposedPrompt = vi.fn();
  const chatWithTools = vi.fn();
  const forRole = vi.fn(async () => ({ chatWithTools }));
  const get = vi.fn();
  const setSprintBranch = vi.fn();
  const setPrDetails = vi.fn();
  const getById = vi.fn();
  const getByName = vi.fn();
  const ensureReady = vi.fn();
  const checkoutBranch = vi.fn();
  const createBranch = vi.fn();
  const commitAll = vi.fn();
  const push = vi.fn();
  const requireRelevantDesignInputs = vi.fn();
  const findOpenPullRequestByHead = vi.fn();
  const createPullRequestWithRecovery = vi.fn();
  const execMock = vi.fn();

  return {
    findFirst,
    write,
    getComposedPrompt,
    chatWithTools,
    forRole,
    get,
    setSprintBranch,
    setPrDetails,
    getById,
    getByName,
    ensureReady,
    checkoutBranch,
    createBranch,
    commitAll,
    push,
    requireRelevantDesignInputs,
    findOpenPullRequestByHead,
    createPullRequestWithRecovery,
    execMock,
  };
});

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

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue(new Error("not found")),
  },
}));

import fs from "fs/promises";

vi.mock("child_process", () => ({
  exec: (...args: unknown[]) => mocks.execMock(...args),
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
    checkoutBranch: mocks.checkoutBranch,
    createBranch: mocks.createBranch,
    commitAll: mocks.commitAll,
    push: mocks.push,
  },
}));

vi.mock("../services/design-input-gate.service", () => ({
  designInputGateService: {
    requireRelevantDesignInputs: mocks.requireRelevantDesignInputs,
  },
}));

vi.mock("../services/github-api.service", () => ({
  githubApiService: {
    findOpenPullRequestByHead: mocks.findOpenPullRequestByHead,
  },
}));

vi.mock("../services/pr-remediation.service", () => ({
  prRemediationService: {
    createPullRequestWithRecovery: mocks.createPullRequestWithRecovery,
  },
}));

import { ImplementerScript } from "../scripts/role-implementer.script";
import { ScriptExecutionContext } from "../scripts/script.interface";

function makeContext(): ScriptExecutionContext {
  return {
    execution_id: "exec-1",
    correlation_id: "pipe-1",
    metadata: {},
    log: vi.fn(),
    notify: vi.fn(),
  };
}

describe("ImplementerScript post-commit PR flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockRejectedValue(new Error("not found"));
    const readdirMock = fs.readdir as unknown as ReturnType<typeof vi.fn>;
    readdirMock.mockRejectedValue(new Error("not found"));
    const mkdirMock = fs.mkdir as unknown as ReturnType<typeof vi.fn>;
    mkdirMock.mockResolvedValue(undefined);
    const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
    writeFileMock.mockResolvedValue(undefined);
    const accessMock = fs.access as unknown as ReturnType<typeof vi.fn>;
    // Default: UX artifacts not found (access rejects)
    accessMock.mockRejectedValue(new Error("not found"));

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))) {
        return { path: "artifacts/AI_IMPLEMENTATION_BRIEF.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      }
      if (paths.some((p) => p.includes("current_task"))) {
        return {
          path: "artifacts/current_task.json",
          content: JSON.stringify({ task_id: "S01-001", sprint_id: "SPR-1" }),
        };
      }
      if (paths.some((p) => p.includes("sprint_plan"))) {
        return { path: "artifacts/sprint_plan_spr_1.md", content: "# Sprint" };
      }
      return null;
    });

    mocks.get.mockResolvedValue({
      project_id: "proj-1",
      sprint_branch: "feature/S01-001",
    });
    mocks.getById.mockResolvedValue({
      project_id: "proj-1",
      name: "demo",
      repo_url: "https://github.com/rnettles/Personal-Health-Knowledge-System",
      clone_path: "C:/repo",
      default_branch: "main",
    });
    mocks.ensureReady.mockResolvedValue(undefined);
    mocks.checkoutBranch.mockResolvedValue(undefined);
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo" });
    mocks.getComposedPrompt.mockResolvedValue("prompt");
    mocks.chatWithTools.mockImplementation(async (_messages: unknown, _tools: Array<{ name: string }>, toolExecutor: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await toolExecutor({
        name: "finish",
        arguments: {
          task_id: "S01-001",
          sprint_id: "SPR-1",
          summary: "Implement feature",
          files_changed: JSON.stringify([
            { path: "src/index.ts", action: "Modify", description: "Updated implementation" },
          ]),
        },
      });
    });
    mocks.commitAll.mockResolvedValue("abcdef1234567890");
    mocks.push.mockResolvedValue(undefined);
    mocks.findOpenPullRequestByHead.mockResolvedValue(null);
    mocks.createPullRequestWithRecovery.mockResolvedValue({
      pr: {
        number: 42,
        url: "https://api.github.com/repos/rnettles/Personal-Health-Knowledge-System/pulls/42",
        html_url: "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/42",
        state: "open",
        merged: false,
      },
      preflight_metadata: [],
      remediation_performed: false,
    });
    // Return distinct artifact paths per call to support artifact_paths assertions
    let writeCallCount = 0;
    mocks.write.mockImplementation(async (_pipelineId: string, name: string) => {
      writeCallCount++;
      return `artifacts/${writeCallCount}_${name}`;
    });
    // Default: exec resolves with success (no gate runs unless test overrides chatWithTools)
    mocks.execMock.mockImplementation(
      (_cmd: string, _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: "ok", stderr: "" });
      }
    );
  });

  it("commits and pushes to sprint branch (PR creation is Sprint Controller's responsibility)", async () => {
    const script = new ImplementerScript();
    const context = makeContext();

    await script.run(
      {
        pipeline_id: "pipe-1",
        previous_artifacts: [
          "artifacts/AI_IMPLEMENTATION_BRIEF.md",
          "artifacts/current_task.json",
          "artifacts/sprint_plan_spr_1.md",
        ],
      },
      context
    );

    expect(mocks.commitAll).toHaveBeenCalledWith(expect.anything(), "feature/S01-001", expect.stringContaining("feat(S01-001): Implement feature"));
    expect(mocks.push).toHaveBeenCalledWith(expect.anything(), "feature/S01-001");
    expect(mocks.createPullRequestWithRecovery).not.toHaveBeenCalled();
    expect(mocks.setPrDetails).not.toHaveBeenCalled();
  });

  it("adopts active task branch when sprint_branch is missing", async () => {
    const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.includes("project_work") && filePath.includes("current_task.json")) {
        return JSON.stringify({ task_id: "S01-001" });
      }
      throw new Error("not found");
    });

    mocks.get.mockResolvedValue({
      project_id: "proj-1",
      sprint_branch: null,
    });

    const script = new ImplementerScript();
    await script.run(
      {
        pipeline_id: "pipe-1",
        previous_artifacts: [
          "artifacts/AI_IMPLEMENTATION_BRIEF.md",
          "artifacts/current_task.json",
          "artifacts/sprint_plan_spr_1.md",
        ],
      },
      makeContext()
    );

    expect(mocks.createBranch).toHaveBeenCalledWith(expect.anything(), "feature/S01-001");
    expect(mocks.setSprintBranch).toHaveBeenCalledWith("pipe-1", "feature/S01-001");
    expect(mocks.createPullRequestWithRecovery).not.toHaveBeenCalled();
    expect(mocks.setPrDetails).not.toHaveBeenCalled();
  });

  it("ADR-035: sprint plan falls back to staged_sprints/ but brief/task must be in previous_artifacts", async () => {
    // With ADR-035, brief and task MUST come from previous_artifacts (artifact service).
    // Only sprint plan can still be loaded from staged_sprints/ in the repo.
    mocks.findFirst.mockResolvedValue(null); // no artifacts in pipeline store

    const readdirMock = fs.readdir as unknown as ReturnType<typeof vi.fn>;
    readdirMock.mockResolvedValue([{ isFile: () => true, name: "sprint_plan_s01.md" }]);

    const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("sprint_plan_s01.md")) return "# Sprint from staged";
      throw new Error("not found");
    });

    const script = new ImplementerScript();
    // Sprint plan found from staged_sprints/, but brief and task not found → should fail
    await expect(
      script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())
    ).rejects.toThrow("Implementer requires an active task package");
    expect(mocks.forRole).not.toHaveBeenCalled();
  });

  it("fails fast when no governed task package exists", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const script = new ImplementerScript();
    await expect(script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext())).rejects.toThrow(
      "Implementer requires an active task package"
    );
    expect(mocks.forRole).not.toHaveBeenCalled();
  });
});

// ─── Phase 3: Output contract tests ─────────────────────────────────────────

describe("ImplementerScript output contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.readFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.readdir as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.mkdir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.access as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S02-001", sprint_id: "SPR-2", status: "in_progress" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });

    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: "feature/S02-001" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", name: "demo", repo_url: "https://github.com/x/y", clone_path: "C:/repo", default_branch: "main" });
    mocks.ensureReady.mockResolvedValue(undefined);
    mocks.checkoutBranch.mockResolvedValue(undefined);
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo" });
    mocks.getComposedPrompt.mockResolvedValue("prompt");
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "finish", arguments: { task_id: "S02-001", sprint_id: "SPR-2", summary: "Done", files_changed: JSON.stringify([{ path: "src/a.ts", action: "Modify", description: "x" }]) } });
    });
    mocks.commitAll.mockResolvedValue("sha1");
    mocks.push.mockResolvedValue(undefined);
    mocks.findOpenPullRequestByHead.mockResolvedValue(null);
    mocks.createPullRequestWithRecovery.mockResolvedValue({ pr: { number: 1, url: "u", html_url: "hu", state: "open", merged: false }, preflight_metadata: [], remediation_performed: false });
    let wc = 0;
    mocks.write.mockImplementation(async (_: string, name: string) => `artifacts/${++wc}_${name}`);
    mocks.execMock.mockImplementation((_: string, __: unknown, cb: (...a: unknown[]) => void) => cb(null, { stdout: "ok", stderr: "" }));
  });

  it("sets current_task.json status to ready_for_verification (IMP-001)", async () => {
    const script = new ImplementerScript();
    const out = await script.run({ pipeline_id: "pipe-2", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_2.md"] }, makeContext()) as Record<string, unknown>;

    // current_task.json write is the second artifactService.write call
    const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
    const ctWriteCall = (mocks.write.mock.calls as Array<[string, string, string]>).find(([, name]) => name === "current_task.json");
    expect(ctWriteCall).toBeDefined();
    const writtenJson = JSON.parse(ctWriteCall![2] as string);
    expect(writtenJson.status).toBe("ready_for_verification");
    // Also assert current_task_path is in artifact_paths
    expect((out.artifact_paths as string[]).some((p) => p.includes("current_task.json"))).toBe(true);
    // Suppress unused var warning
    void writeFileMock;
  });

  it("writes test_results.json via artifact service (ADR-035 Phase 3.2)", async () => {
    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-2", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_2.md"] }, makeContext());

    // ADR-035: test_results.json is written via artifactService.write(), not fs.writeFile
    const testResultsCall = mocks.write.mock.calls.find(
      ([, name]: string[]) => typeof name === "string" && name === "test_results.json"
    );
    expect(testResultsCall).toBeDefined();
    const payload = JSON.parse(testResultsCall![2] as string);
    expect(payload).toMatchObject({ task_id: "S02-001", sprint_id: "SPR-2" });
    expect(payload).toHaveProperty("executed_at");
    expect(payload).toHaveProperty("gate_results");
  });

  it("includes test_results_path in artifact_paths (Phase 3.3)", async () => {
    const script = new ImplementerScript();
    const out = await script.run({ pipeline_id: "pipe-2", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_2.md"] }, makeContext()) as Record<string, unknown>;

    expect((out.artifact_paths as string[]).some((p) => p.includes("test_results.json"))).toBe(true);
    expect(out.test_results_path).toBeDefined();
  });
});

// ─── Phase 2: Input enforcement / hard-stop tests ────────────────────────────

describe("ImplementerScript input enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.readFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.readdir as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.mkdir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.access as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: "feature/S03-001" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", name: "demo", repo_url: "https://github.com/x/y", clone_path: "C:/repo", default_branch: "main" });
    mocks.ensureReady.mockResolvedValue(undefined);
    mocks.checkoutBranch.mockResolvedValue(undefined);
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo" });
    mocks.execMock.mockImplementation((_: string, __: unknown, cb: (...a: unknown[]) => void) => cb(null, { stdout: "ok", stderr: "" }));
  });

  it("UX hard-stop: throws UX_HARD_STOP when ui_evidence_required=true and no user_flow.md (IMP-002)", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: true\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S03-001", sprint_id: "SPR-3" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });
    // access always rejects (default) — no user_flow.md in repo
    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-3", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_3.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "UX_HARD_STOP" });
    expect(mocks.forRole).not.toHaveBeenCalled();
  });

  it("UX hard-stop: proceeds when ui_evidence_required=true and user_flow.md exists (IMP-002)", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: true\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S03-001", sprint_id: "SPR-3" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });
    // Make user_flow.md accessible at the first search path
    const accessMock = fs.access as unknown as ReturnType<typeof vi.fn>;
    accessMock.mockImplementation(async (p: string) => {
      if (typeof p === "string" && p.endsWith("user_flow.md")) return undefined;
      throw new Error("not found");
    });
    mocks.getComposedPrompt.mockResolvedValue("prompt");
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "finish", arguments: { task_id: "S03-001", sprint_id: "SPR-3", summary: "UI done", files_changed: "[]" } });
    });
    mocks.commitAll.mockResolvedValue("sha2");
    mocks.push.mockResolvedValue(undefined);
    mocks.findOpenPullRequestByHead.mockResolvedValue(null);
    mocks.createPullRequestWithRecovery.mockResolvedValue({ pr: { number: 2, url: "u", html_url: "hu", state: "open", merged: false }, preflight_metadata: [], remediation_performed: false });
    let wc = 0;
    mocks.write.mockImplementation(async (_: string, name: string) => `artifacts/${++wc}_${name}`);

    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-3", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_3.md"] }, makeContext())
    ).resolves.toBeDefined();
    expect(mocks.forRole).toHaveBeenCalled();
  });

  it("branch policy: throws BRANCH_POLICY_VIOLATION when no sprint_branch and no resolvable task_id (IMP-003)", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S03-002", sprint_id: "SPR-3" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: null });
    // readFile for resolveActiveTaskBranch → no task_id
    const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockImplementation(async (p: string) => {
      if (typeof p === "string" && p.includes("project_work") && p.includes("current_task.json"))
        return JSON.stringify({ task_id: "" }); // empty task_id
      throw new Error("not found");
    });

    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-3", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_3.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "BRANCH_POLICY_VIOLATION" });
  });
});

// ─── Phase 4: Gate execution and forbidden writes ────────────────────────────

describe("ImplementerScript gate execution and role boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.readFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.readdir as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.mkdir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.access as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S04-001", sprint_id: "SPR-4" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: "feature/S04-001" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", name: "demo", repo_url: "https://github.com/x/y", clone_path: "C:/repo", default_branch: "main" });
    mocks.ensureReady.mockResolvedValue(undefined);
    mocks.checkoutBranch.mockResolvedValue(undefined);
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo" });
    mocks.getComposedPrompt.mockResolvedValue("prompt");
    mocks.commitAll.mockResolvedValue("sha3");
    mocks.push.mockResolvedValue(undefined);
    mocks.findOpenPullRequestByHead.mockResolvedValue(null);
    mocks.createPullRequestWithRecovery.mockResolvedValue({ pr: { number: 3, url: "u", html_url: "hu", state: "open", merged: false }, preflight_metadata: [], remediation_performed: false });
    let wc = 0;
    mocks.write.mockImplementation(async (_: string, name: string) => `artifacts/${++wc}_${name}`);
    mocks.execMock.mockImplementation((_: string, __: unknown, cb: (...a: unknown[]) => void) => cb(null, { stdout: "ok", stderr: "" }));
  });

  it("finish not called → checkpoint commit pushed then throws FINISH_NOT_CALLED (Phase 5.3)", async () => {
    mocks.chatWithTools.mockImplementation(async () => { /* finish never called */ });
    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "FINISH_NOT_CALLED" });
    // Checkpoint commit is now pushed so operator can review failure state locally.
    expect(mocks.commitAll).toHaveBeenCalledWith(
      expect.anything(),
      "feature/S04-001",
      expect.stringContaining("[FINISH_NOT_CALLED]")
    );
    expect(mocks.push).toHaveBeenCalled();
  });

  it("write_file to verification_result.json returns forbidden error (POL-004)", async () => {
    let forbiddenResult: string | undefined;
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      forbiddenResult = await exec({ name: "write_file", arguments: { path: "project_work/ai_project_tasks/active/verification_result.json", content: "{}" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());
    expect(forbiddenResult).toMatch(/verifier-owned artifact/);
    // Ensure the actual fs.writeFile was NOT called for that path
    const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
    const forbiddenCall = (writeFileMock.mock.calls as Array<[string]>).find(
      ([p]) => typeof p === "string" && p.includes("verification_result.json")
    );
    expect(forbiddenCall).toBeUndefined();
  });

  it("write_file to fix_state.json returns forbidden error (POL-004)", async () => {
    let forbiddenResult: string | undefined;
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      forbiddenResult = await exec({ name: "write_file", arguments: { path: "project_work/ai_project_tasks/active/fix_state.json", content: "{}" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());
    expect(forbiddenResult).toMatch(/verifier-owned artifact/);
  });

  it("gate failure: in-loop finish guard blocks handoff; script checkpoints and throws FINISH_NOT_CALLED (Phase 4.3)", async () => {
    // Make execMock simulate a failing gate command
    mocks.execMock.mockImplementation(
      (_cmd: string, _opts: unknown, callback: (err: { stdout: string; stderr: string; code: number } | null, result?: unknown) => void) => {
        callback({ stdout: "", stderr: "lint error: semicolon missing", code: 1 });
      }
    );
    let finishToolResult: string | undefined;
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "run_command", arguments: { command: "npm run lint" } });
      // finish is blocked in-loop because gate is still failing
      finishToolResult = await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "FINISH_NOT_CALLED" });
    // In-loop guard returned an error — finish payload was never recorded
    expect(finishToolResult).toMatch(/gate\(s\) still failing/);
    // Checkpoint commit pushed so operator can review failure state locally
    expect(mocks.commitAll).toHaveBeenCalledWith(
      expect.anything(),
      "feature/S04-001",
      expect.stringContaining("[FINISH_NOT_CALLED]")
    );
  });

  it("gate retry: retried gate (exit 0) supersedes prior failure; finish succeeds (Phase 4.3 dedup)", async () => {
    let lintCallCount = 0;
    mocks.execMock.mockImplementation(
      (_cmd: string, _opts: unknown, callback: (err: { stdout: string; stderr: string; code: number } | null, result?: { stdout: string; stderr: string }) => void) => {
        lintCallCount++;
        if (lintCallCount === 1) {
          callback({ stdout: "", stderr: "lint error", code: 1 });
        } else {
          callback(null, { stdout: "ok", stderr: "" });
        }
      }
    );
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "run_command", arguments: { command: "npm run lint" } }); // exit 1
      await exec({ name: "run_command", arguments: { command: "npm run lint" } }); // exit 0 (retry after fix)
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    // Latest gate for 'npm run lint' is exit 0 — finish should be allowed
    await expect(
      script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).resolves.toBeDefined();
    // Normal success commit (not a checkpoint commit)
    expect(mocks.commitAll).toHaveBeenCalledWith(
      expect.anything(),
      "feature/S04-001",
      expect.stringContaining("feat(S04-001)")
    );
  });

  it("max iterations: checkpoint commit pushed then throws MAX_ITERATIONS", async () => {
    mocks.chatWithTools.mockImplementation(async () => {
      throw new Error("LLM tool-call loop exceeded max iterations (30)");
    });
    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "MAX_ITERATIONS" });
    expect(mocks.commitAll).toHaveBeenCalledWith(
      expect.anything(),
      "feature/S04-001",
      expect.stringContaining("[MAX_ITERATIONS]")
    );
    expect(mocks.push).toHaveBeenCalled();
    // Stable checkpoint written so next run loads prior context even if git commit fails.
    const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
    const stableWrite = (writeFileMock.mock.calls as Array<[string, string, string]>).find(
      ([p]) => typeof p === "string" && p.includes("_checkpoints")
    );
    expect(stableWrite).toBeDefined();
    const stablePayload = JSON.parse(stableWrite![1]);
    expect(stablePayload).toMatchObject({ task_id: "S04-001", stop_reason: "MAX_ITERATIONS" });
  });

  it("prior-run context: reads from stable checkpoint when repo file is absent", async () => {
    // Stable checkpoint has a prior failing gate result
    const stableContent = JSON.stringify({
      task_id: "S04-001",
      sprint_id: "SPR-4",
      executed_at: "2024-01-01T00:00:00.000Z",
      stop_reason: "MAX_ITERATIONS",
      gate_results: [{ command: "npm test", exit_code: 1, stdout: "", stderr: "test failed", timestamp: "2024-01-01T00:00:00.000Z" }],
      summary: "failed",
    });

    const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockImplementation(async (filePath: string) => {
      // Stable checkpoint contains "_checkpoints" in path; repo file does not exist
      if (typeof filePath === "string" && filePath.includes("_checkpoints")) {
        return stableContent;
      }
      throw new Error("not found");
    });

    let capturedUserContent: string | null = null;
    mocks.chatWithTools.mockImplementation(
      async (
        messages: Array<{ role: string; content: string }>,
        _tools: unknown,
        exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>
      ) => {
        capturedUserContent = messages.find((m) => m.role === "user")?.content ?? null;
        await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
      }
    );

    const script = new ImplementerScript();
    await script.run(
      { pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] },
      makeContext()
    );

    // Prior context should be injected from stable checkpoint path
    expect(capturedUserContent).toContain("Prior Run Context");
    expect(capturedUserContent).toContain("MAX_ITERATIONS");
  });

  it("gate success via run_command records results in test_results.json (Phase 4.2)", async () => {
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "run_command", arguments: { command: "npm test" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());

    // ADR-035: test_results.json is written via artifactService.write(), not fs.writeFile
    const testResultsCall = mocks.write.mock.calls.find(
      ([, name]: string[]) => typeof name === "string" && name === "test_results.json"
    );
    expect(testResultsCall).toBeDefined();
    const payload = JSON.parse(testResultsCall![2] as string);
    expect(payload.gate_results).toHaveLength(1);
    expect(payload.gate_results[0]).toMatchObject({ command: "npm test", exit_code: 0 });
    expect(payload.summary).toBe("all_passed");
  });
});

// ─── ADR-033 Phase 14: implementer helpers ────────────────────────────────────

describe("ImplementerScript ADR-033 helpers (Phase 14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.readFile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.readdir as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    (fs.mkdir as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.access as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S04-001", sprint_id: "SPR-4", status: "in_progress" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });
    mocks.get.mockResolvedValue({ project_id: "proj-1", sprint_branch: "feature/S04-001" });
    mocks.getById.mockResolvedValue({ project_id: "proj-1", name: "demo", repo_url: "https://github.com/x/y", clone_path: "C:/repo", default_branch: "main" });
    mocks.ensureReady.mockResolvedValue(undefined);
    mocks.checkoutBranch.mockResolvedValue(undefined);
    mocks.requireRelevantDesignInputs.mockResolvedValue({ sample_files: [], project_name: "demo" });
    mocks.getComposedPrompt.mockResolvedValue("prompt");
    mocks.commitAll.mockResolvedValue("sha14");
    mocks.push.mockResolvedValue(undefined);
    mocks.findOpenPullRequestByHead.mockResolvedValue(null);
    mocks.createPullRequestWithRecovery.mockResolvedValue({ pr: { number: 14, url: "u", html_url: "hu", state: "open", merged: false }, preflight_metadata: [], remediation_performed: false });
    let wc = 0;
    mocks.write.mockImplementation(async (_: string, name: string) => `artifacts/${++wc}_${name}`);
    mocks.execMock.mockImplementation((_: string, __: unknown, cb: (...a: unknown[]) => void) => cb(null, { stdout: "ok", stderr: "" }));
  });

  // ─── Phase 4: set_progress tool ────────────────────────────────────────────

  it("set_progress: writes progress.json with current_focus + planned_next_action", async () => {
    let toolResult: string | undefined;
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      toolResult = await exec({
        name: "set_progress",
        arguments: {
          current_focus: "Editing role-implementer.script.ts",
          open_todos: ["wire up handler", "add tests"],
          blockers: [],
          planned_next_action: "Run tsc and re-verify",
        },
      });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-prog", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());

    expect(toolResult).toMatch(/OK/i);
    // ADR-035: progress.json is written via artifactService.write(), not fs.writeFile
    const progressCall = mocks.write.mock.calls.find(
      ([, name]: string[]) => typeof name === "string" && name === "progress.json"
    );
    expect(progressCall).toBeDefined();
    const payload = JSON.parse(progressCall![2] as string);
    expect(payload).toMatchObject({
      current_focus: "Editing role-implementer.script.ts",
      planned_next_action: "Run tsc and re-verify",
      open_todos: ["wire up handler", "add tests"],
      blockers: [],
    });
    expect(payload.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ─── Phase 4: max-iter fallback synthesis ─────────────────────────────────

  it("max-iter fallback: synthesizes progress.json when set_progress was never called", async () => {
    mocks.chatWithTools.mockImplementation(async () => {
      throw new Error("LLM tool-call loop exceeded max iterations (30)");
    });

    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-fb", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "MAX_ITERATIONS" });

    // ADR-035: progress.json is written via artifactService.write(), not fs.writeFile
    const progressCall = mocks.write.mock.calls.find(
      ([, name]: string[]) => typeof name === "string" && name === "progress.json"
    );
    expect(progressCall).toBeDefined();
    const payload = JSON.parse(progressCall![2] as string);
    expect(typeof payload.current_focus).toBe("string");
    expect(typeof payload.planned_next_action).toBe("string");
    expect(payload.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ─── Phase 6: lifecycle state-machine guard ───────────────────────────────

  it("status transition: in_progress → ready_for_verification is allowed", async () => {
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-st", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());

    const ctWriteCall = (mocks.write.mock.calls as Array<[string, string, string]>).find(
      ([, name]) => name === "current_task.json"
    );
    expect(ctWriteCall).toBeDefined();
    const written = JSON.parse(ctWriteCall![2]);
    expect(written.status).toBe("ready_for_verification");
  });

  it("status transition: invalid prior status (e.g. blocked) is preserved", async () => {
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S04-001", sprint_id: "SPR-4", status: "blocked" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      return null;
    });

    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-st2", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());

    const ctWriteCall = (mocks.write.mock.calls as Array<[string, string, string]>).find(
      ([, name]) => name === "current_task.json"
    );
    expect(ctWriteCall).toBeDefined();
    const written = JSON.parse(ctWriteCall![2]);
    expect(written.status).toBe("blocked");
  });

  // ─── Phase 5: script-templated commit message ─────────────────────────────

  it("commit message: templated as feat(<task_id>): <summary> with file body", async () => {
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({
        name: "finish",
        arguments: {
          task_id: "S04-001",
          sprint_id: "SPR-4",
          summary: "Implement set_progress tool and lifecycle guard",
          files_changed: JSON.stringify([{ path: "src/foo.ts", action: "Modify", description: "x" }]),
        },
      });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-msg", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());

    expect(mocks.commitAll).toHaveBeenCalled();
    const message = (mocks.commitAll.mock.calls[0] as unknown[])[2] as string;
    expect(message.split("\n")[0]).toMatch(/^feat\(S04-001\): /);
    expect(message).toContain("src/foo.ts");
  });

  // ─── Phase 3: extractCorrections injection ────────────────────────────────

  it("prior corrections: FAIL corrections from verification_result.json injected into context", async () => {
    const verificationResult = JSON.stringify({
      task_id: "S04-001",
      result: "FAIL",
      required_corrections: ["Fix failing tsc error in foo.ts", "Add missing test for bar()"],
    });

    // ADR-035: corrections are read from previous_artifacts via artifact service, not from readFile
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S04-001", sprint_id: "SPR-4", status: "in_progress" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      if (paths.some((p) => p.includes("verification_result")))
        return { path: "artifacts/verification_result.json", content: verificationResult };
      return null;
    });

    let captured: string | null = null;
    mocks.chatWithTools.mockImplementation(async (
      messages: Array<{ role: string; content: string }>,
      _t: unknown,
      exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>
    ) => {
      captured = messages.find((m) => m.role === "user")?.content ?? null;
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-corr", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md", "artifacts/verification_result.json"] }, makeContext());

    expect(captured).toContain("Fix failing tsc error in foo.ts");
    expect(captured).toContain("Add missing test for bar()");
  });

  // ─── Phase 9: cross-run gate evidence reuse ──────────────────────────────

  it("gate reuse: prior exit_code=0 returned as cached when no relevant files changed", async () => {
    const priorTestResults = JSON.stringify({
      task_id: "S04-001",
      sprint_id: "SPR-4",
      gate_results: [
        { command: "npm test", exit_code: 0, stdout: "ok", stderr: "", timestamp: "2024-01-01T00:00:00.000Z" },
      ],
    });

    // ADR-035: test_results are read from previous_artifacts via artifact service
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S04-001", sprint_id: "SPR-4", status: "in_progress" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      if (paths.some((p) => p.includes("test_results")))
        return { path: "artifacts/test_results.json", content: priorTestResults };
      return null;
    });

    let actualNpmTestRan = false;
    mocks.execMock.mockImplementation((cmd: string, _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
      if (typeof cmd === "string" && cmd.includes("git diff --name-status")) {
        return cb(null, { stdout: "M\tdocs/readme.md\n", stderr: "" });
      }
      if (typeof cmd === "string" && cmd.includes("git symbolic-ref")) {
        return cb(null, { stdout: "origin/main\n", stderr: "" });
      }
      if (cmd === "npm test") {
        actualNpmTestRan = true;
      }
      cb(null, { stdout: "ok", stderr: "" });
    });

    let runCommandResult: string | undefined;
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      runCommandResult = await exec({ name: "run_command", arguments: { command: "npm test" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-cache", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md", "artifacts/test_results.json"] }, makeContext());

    expect(runCommandResult).toBeDefined();
    expect(runCommandResult).toMatch(/cached/i);
    expect(actualNpmTestRan).toBe(false);
  });

  it("gate reuse: command is re-run when relevant test files changed", async () => {
    const priorTestResults = JSON.stringify({
      task_id: "S04-001",
      sprint_id: "SPR-4",
      gate_results: [
        { command: "npm test", exit_code: 0, stdout: "ok", stderr: "", timestamp: "2024-01-01T00:00:00.000Z" },
      ],
    });

    // ADR-035: test_results are read from previous_artifacts via artifact service
    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF")))
        return { path: "artifacts/brief.md", content: "# Brief\n\n## Task Flags\nfr_ids_in_scope: []\narchitecture_contract_change: false\nui_evidence_required: false\nincident_tier: none" };
      if (paths.some((p) => p.includes("current_task")))
        return { path: "artifacts/ct.json", content: JSON.stringify({ task_id: "S04-001", sprint_id: "SPR-4", status: "in_progress" }) };
      if (paths.some((p) => p.includes("sprint_plan")))
        return { path: "artifacts/sprint.md", content: "# Sprint" };
      if (paths.some((p) => p.includes("test_results")))
        return { path: "artifacts/test_results.json", content: priorTestResults };
      return null;
    });

    let actualNpmTestRan = false;
    mocks.execMock.mockImplementation((cmd: string, _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
      if (typeof cmd === "string" && cmd.includes("git diff --name-status")) {
        return cb(null, { stdout: "M\tsrc/__tests__/foo.test.ts\n", stderr: "" });
      }
      if (typeof cmd === "string" && cmd.includes("git symbolic-ref")) {
        return cb(null, { stdout: "origin/main\n", stderr: "" });
      }
      if (cmd === "npm test") {
        actualNpmTestRan = true;
        return cb(null, { stdout: "fresh run", stderr: "" });
      }
      cb(null, { stdout: "ok", stderr: "" });
    });

    let runCommandResult: string | undefined;
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      runCommandResult = await exec({ name: "run_command", arguments: { command: "npm test" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-nocache", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md", "artifacts/test_results.json"] }, makeContext());

    expect(actualNpmTestRan).toBe(true);
    expect(runCommandResult).not.toMatch(/cached/i);
  });
});