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
  const setPrDetails = vi.fn();
  const createPullRequestWithRecovery = vi.fn();
  const requireRelevantDesignInputs = vi.fn();
  const readdir = vi.fn();
  const readFile = vi.fn();

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
    setPrDetails,
    createPullRequestWithRecovery,
    requireRelevantDesignInputs,
    readdir,
    readFile,
  };
});

vi.mock("fs/promises", () => ({
  default: {
    readdir: mocks.readdir,
    readFile: mocks.readFile,
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
  },
}));

vi.mock("../services/pr-remediation.service", () => ({
  prRemediationService: {
    createPullRequestWithRecovery: mocks.createPullRequestWithRecovery,
  },
}));

vi.mock("../services/design-input-gate.service", () => ({
  designInputGateService: {
    requireRelevantDesignInputs: mocks.requireRelevantDesignInputs,
  },
}));

import { SprintControllerScript } from "../scripts/role-sprint-controller.script";
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

    expect((output as { first_task: { task_id: string } }).first_task.task_id).toBe("S01-001");
  });
});