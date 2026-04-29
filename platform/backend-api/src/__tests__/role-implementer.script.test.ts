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

  it("commits, pushes, and keeps the sprint PR open for sprint-end merge gate", async () => {
    const script = new ImplementerScript();
    const context = makeContext();

    const output = await script.run(
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
    expect(mocks.createPullRequestWithRecovery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ head: "feature/S01-001", base: "main" })
    );
    expect(mocks.setPrDetails).toHaveBeenCalledWith(
      "pipe-1",
      42,
      "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/42",
      "feature/S01-001"
    );
    expect((output as { pr_number?: number; pr_url?: string }).pr_number).toBe(42);
    expect((output as { pr_number?: number; pr_url?: string }).pr_url).toBe(
      "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/42"
    );
  });

  it("adopts active task branch when sprint_branch is missing and reuses existing PR", async () => {
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
    mocks.findOpenPullRequestByHead.mockResolvedValue({
      number: 4,
      url: "https://api.github.com/repos/rnettles/Personal-Health-Knowledge-System/pulls/4",
      html_url: "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/4",
      state: "open",
      merged: false,
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
    expect(mocks.setPrDetails).toHaveBeenCalledWith(
      "pipe-1",
      4,
      "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/4",
      "feature/S01-001"
    );
    expect(mocks.createPullRequestWithRecovery).not.toHaveBeenCalled();
  });

  it("loads active repo task artifacts when pipeline artifacts are missing", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const readdirMock = fs.readdir as unknown as ReturnType<typeof vi.fn>;
    readdirMock.mockResolvedValue([{ isFile: () => true, name: "sprint_plan_s01.md" }]);

    const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("AI_IMPLEMENTATION_BRIEF.md")) return "# Brief from active";
      if (filePath.endsWith("current_task.json")) return JSON.stringify({ task_id: "S01-001", sprint_id: "SPR-1" });
      if (filePath.endsWith("sprint_plan_s01.md")) return "# Sprint from active";
      throw new Error("not found");
    });

    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-1", previous_artifacts: [] }, makeContext());

    expect(mocks.forRole).toHaveBeenCalled();
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

  it("writes test_results.json to repo canonical path (Phase 3.2)", async () => {
    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-2", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_2.md"] }, makeContext());

    const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
    // Verify fs.writeFile was called with the canonical repo path for test_results.json
    const testResultsCall = (writeFileMock.mock.calls as Array<[string, string, string]>).find(
      ([filePath]) => typeof filePath === "string" && filePath.endsWith("test_results.json")
    );
    expect(testResultsCall).toBeDefined();
    const payload = JSON.parse(testResultsCall![1]);
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

  it("finish not called → throws FINISH_NOT_CALLED (Phase 5.3)", async () => {
    mocks.chatWithTools.mockImplementation(async () => { /* finish never called */ });
    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "FINISH_NOT_CALLED" });
    expect(mocks.commitAll).not.toHaveBeenCalled();
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

  it("gate failure via run_command blocks handoff with GATE_FAILURE (Phase 4.3)", async () => {
    // Make execMock simulate a failing gate command
    mocks.execMock.mockImplementation(
      (_cmd: string, _opts: unknown, callback: (err: { stdout: string; stderr: string; code: number } | null, result?: unknown) => void) => {
        callback({ stdout: "", stderr: "lint error: semicolon missing", code: 1 });
      }
    );
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "run_command", arguments: { command: "npm run lint" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    await expect(
      script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext())
    ).rejects.toMatchObject({ code: "GATE_FAILURE" });
    expect(mocks.commitAll).not.toHaveBeenCalled();
  });

  it("gate success via run_command records results in test_results.json (Phase 4.2)", async () => {
    mocks.chatWithTools.mockImplementation(async (_m: unknown, _t: unknown, exec: (call: { name: string; arguments: Record<string, unknown> }) => Promise<string>) => {
      await exec({ name: "run_command", arguments: { command: "npm test" } });
      await exec({ name: "finish", arguments: { task_id: "S04-001", sprint_id: "SPR-4", summary: "Done", files_changed: "[]" } });
    });
    const script = new ImplementerScript();
    await script.run({ pipeline_id: "pipe-4", previous_artifacts: ["artifacts/AI_IMPLEMENTATION_BRIEF.md", "artifacts/current_task.json", "artifacts/sprint_plan_spr_4.md"] }, makeContext());

    const writeFileMock = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
    const testResultsCall = (writeFileMock.mock.calls as Array<[string, string]>).find(
      ([p]) => typeof p === "string" && p.endsWith("test_results.json")
    );
    expect(testResultsCall).toBeDefined();
    const payload = JSON.parse(testResultsCall![1]);
    expect(payload.gate_results).toHaveLength(1);
    expect(payload.gate_results[0]).toMatchObject({ command: "npm test", exit_code: 0 });
    expect(payload.summary).toBe("all_passed");
  });
});