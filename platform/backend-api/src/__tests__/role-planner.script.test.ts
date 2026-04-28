import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findFirst = vi.fn();
  const write = vi.fn();
  const getComposedPrompt = vi.fn();
  const chatJson = vi.fn();
  const forRole = vi.fn(async () => ({ chatJson }));
  const listStagedPhases = vi.fn();
  const get = vi.fn();
  const setPrDetails = vi.fn();
  const setSprintBranch = vi.fn();
  const listRepoStagedSprints = vi.fn();
  const getById = vi.fn();
  const getByName = vi.fn();
  const ensureReady = vi.fn();
  const push = vi.fn();
  const createBranch = vi.fn();
  const commitAll = vi.fn();
  const createPullRequest = vi.fn();
  const findOpenPullRequestByHead = vi.fn();
  const findOpenPullRequestByTitle = vi.fn();
  const requireRelevantDesignInputs = vi.fn();

  return {
    findFirst,
    write,
    getComposedPrompt,
    chatJson,
    forRole,
    listStagedPhases,
    get,
    setPrDetails,
    setSprintBranch,
    listRepoStagedSprints,
    getById,
    getByName,
    ensureReady,
    push,
    createBranch,
    commitAll,
    createPullRequest,
    findOpenPullRequestByHead,
    findOpenPullRequestByTitle,
    requireRelevantDesignInputs,
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
    listStagedPhases: mocks.listStagedPhases,
    get: mocks.get,
    setPrDetails: mocks.setPrDetails,
    setSprintBranch: mocks.setSprintBranch,
    listRepoStagedSprints: mocks.listRepoStagedSprints,
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
    push: mocks.push,
    createBranch: mocks.createBranch,
    commitAll: mocks.commitAll,
  },
}));

vi.mock("../services/github-api.service", () => ({
  githubApiService: {
    createPullRequest: mocks.createPullRequest,
    findOpenPullRequestByHead: mocks.findOpenPullRequestByHead,
    findOpenPullRequestByTitle: mocks.findOpenPullRequestByTitle,
  },
}));

vi.mock("../services/design-input-gate.service", () => ({
  designInputGateService: {
    requireRelevantDesignInputs: mocks.requireRelevantDesignInputs,
  },
}));

import { PlannerScript } from "../scripts/role-planner.script";
import { HttpError } from "../utils/http-error";
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

describe("PlannerScript next-mode sequencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("verification_result.json"))) {
        return { path: "artifacts/verification_result.json", content: JSON.stringify({ result: "PASS", task_id: "T-1" }) };
      }
      if (paths.some((p) => p.includes("sprint_closeout.json"))) {
        return { path: "artifacts/sprint_closeout.json", content: JSON.stringify({ sprint_branch: "feature/t-1" }) };
      }
      return null;
    });

    mocks.listStagedPhases.mockResolvedValue({ phases: [] });
    mocks.requireRelevantDesignInputs.mockResolvedValue({
      clone_path: ".",
      project_name: "demo",
      fr_context: [{ path: "docs/functional_requirements/frd.md", content: "# FR\n**Status:** approved\nFR-1" }],
      adr_context: [],
      tdn_context: [],
    });
    mocks.getComposedPrompt.mockResolvedValue("prompt");
    mocks.chatJson.mockResolvedValue({
      phase_id: "PH-2",
      name: "Next phase",
      description: "desc",
      objectives: ["obj"],
      deliverables: ["deliv"],
      dependencies: [],
      fr_ids_in_scope: ["FR-1"],
      required_design_artifacts: [],
      status: "Draft",
    });
    mocks.write.mockResolvedValue("artifacts/phase_plan_ph_2.md");
    mocks.get.mockResolvedValue({ project_id: undefined, sprint_branch: "feature/t-1" });
    mocks.getById.mockResolvedValue(null);
    mocks.getByName.mockResolvedValue(null);
  });

  it("closeout + next + sprint-ready phase stages sprint", async () => {
    const planner = new PlannerScript();
    const context = makeContext();

    const runSprintCloseOut = vi.spyOn(planner as never, "runSprintCloseOut" as never).mockResolvedValue({
      closeout: {
        phase_id: "closeout",
        artifact_path: "artifacts/planner_sprint_closeout.json",
        closeout_mode: "sprint",
        pr_number: 9,
        pr_url: "https://example/pr/9",
        sprint_branch: "feature/t-1",
      },
      metadata: { reused_closeout_artifact: false, reused_existing_pr: false },
    } as never);

    vi.spyOn(planner as never, "resolveNextModeState" as never).mockResolvedValue({
      kind: "sprint_ready",
      phasePlan: { content: "# Phase", filePath: "phase.md" },
    } as never);

    const runSprintPlanning = vi.spyOn(planner as never, "runSprintPlanning" as never).mockResolvedValue({
      phase_id: "SPR-1",
      artifact_path: "artifacts/sprint_plan_spr_1.md",
    } as never);

    const output = await planner.run(
      {
        description: "stage next",
        pipeline_id: "pipe-1",
        execution_mode: "next",
        previous_artifacts: ["artifacts/verification_result.json", "artifacts/sprint_closeout.json"],
      },
      context
    );

    expect(runSprintCloseOut).toHaveBeenCalledOnce();
    expect(runSprintPlanning).toHaveBeenCalledOnce();
    expect((output as { phase_id?: string }).phase_id).toBe("SPR-1");
    expect(runSprintCloseOut.mock.invocationCallOrder[0]).toBeLessThan(runSprintPlanning.mock.invocationCallOrder[0]);
  });

  it("closeout + next + unclaimed FRs continues to phase planning", async () => {
    const planner = new PlannerScript();
    const context = makeContext();

    vi.spyOn(planner as never, "runSprintCloseOut" as never).mockResolvedValue({
      closeout: {
        phase_id: "closeout",
        artifact_path: "artifacts/planner_sprint_closeout.json",
        closeout_mode: "sprint",
      },
      metadata: { reused_closeout_artifact: true, reused_existing_pr: true },
    } as never);

    vi.spyOn(planner as never, "resolveNextModeState" as never)
      .mockResolvedValueOnce({ kind: "needs_fr_evaluation" } as never)
      .mockResolvedValueOnce({ kind: "phase_planning" } as never);

    vi.spyOn(planner as never, "findAllPhases" as never).mockResolvedValue([] as never);
    vi.spyOn(planner as never, "readClaimedFrIds" as never).mockResolvedValue([] as never);

    const output = await planner.run(
      {
        description: "plan next phase",
        pipeline_id: "pipe-1",
        execution_mode: "next",
        previous_artifacts: ["artifacts/verification_result.json", "artifacts/sprint_closeout.json"],
      },
      context
    );

    expect((output as { phase_id?: string }).phase_id).toBe("PH-2");
    expect(mocks.chatJson).toHaveBeenCalledOnce();
  });

  it("closeout + next + no work returns NO_WORK_AVAILABLE", async () => {
    const planner = new PlannerScript();
    const context = makeContext();

    vi.spyOn(planner as never, "runSprintCloseOut" as never).mockResolvedValue({
      closeout: {
        phase_id: "closeout",
        artifact_path: "artifacts/planner_sprint_closeout.json",
        closeout_mode: "sprint",
      },
      metadata: { reused_closeout_artifact: false, reused_existing_pr: false },
    } as never);

    vi.spyOn(planner as never, "resolveNextModeState" as never)
      .mockResolvedValueOnce({ kind: "needs_fr_evaluation" } as never)
      .mockResolvedValueOnce({ kind: "no_work" } as never);

    vi.spyOn(planner as never, "findAllPhases" as never).mockResolvedValue([] as never);
    vi.spyOn(planner as never, "readClaimedFrIds" as never).mockResolvedValue(["FR-1"] as never);

    await expect(
      planner.run(
        {
          description: "nothing left",
          pipeline_id: "pipe-1",
          execution_mode: "next",
          previous_artifacts: ["artifacts/verification_result.json", "artifacts/sprint_closeout.json"],
        },
        context
      )
    ).rejects.toMatchObject<HttpError>({ code: "NO_WORK_AVAILABLE" });
  });

  it("duplicate closeout invocation reuses existing closeout PR", async () => {
    const planner = new PlannerScript();
    const context = makeContext();

    mocks.findFirst.mockImplementation(async (paths: string[]) => {
      if (paths.some((p) => p.includes("planner_sprint_closeout.json"))) {
        return {
          path: "artifacts/planner_sprint_closeout.json",
          content: JSON.stringify({
            sprint_branch: "feature/t-1",
            pr_number: 77,
            pr_url: "https://example/pr/77",
          }),
        };
      }
      return null;
    });

    const result = await (planner as never).runSprintCloseOut(
      "pipe-1",
      ["artifacts/planner_sprint_closeout.json"],
      JSON.stringify({ result: "PASS", task_id: "T-1" }),
      JSON.stringify({ sprint_branch: "feature/t-1" }),
      context
    );

    expect(mocks.createPullRequest).not.toHaveBeenCalled();
    expect(mocks.setPrDetails).toHaveBeenCalledWith("pipe-1", 77, "https://example/pr/77", "feature/t-1");
    expect((result as { metadata: { reused_closeout_artifact: boolean } }).metadata.reused_closeout_artifact).toBe(true);
  });
});
