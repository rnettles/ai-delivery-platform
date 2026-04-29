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
  },
}));

import fs from "fs/promises";

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

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("AI_IMPLEMENTATION_BRIEF"))) {
        return { path: "artifacts/AI_IMPLEMENTATION_BRIEF.md", content: "# Brief" };
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
    mocks.write.mockResolvedValue("artifacts/implementation_summary.md");
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
});