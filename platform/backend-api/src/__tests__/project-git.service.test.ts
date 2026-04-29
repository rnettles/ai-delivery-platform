import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../services/logger.service", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { projectGitService } from "../services/project-git.service";
import type { Project } from "../services/project.service";

const mockExec = vi.mocked(execFileSync);

const baseProject: Project = {
  project_id: "proj-1",
  name: "phks",
  repo_url: "https://github.com/rnettles/Personal-Health-Knowledge-System.git",
  default_branch: "main",
  clone_path: "/tmp/phks",
  created_at: "2026-04-28T00:00:00.000Z",
  updated_at: "2026-04-28T00:00:00.000Z",
};

function nfRejectError(): Error & { stderr: string } {
  const err = new Error("push rejected") as Error & { stderr: string };
  err.stderr = "! [rejected] non-fast-forward";
  return err;
}

describe("projectGitService.push recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebases and retries push when remote branch ref exists", async () => {
    let pushAttempts = 0;

    mockExec.mockImplementation((_cmd, args) => {
      const gitArgs = args as string[];
      const joined = gitArgs.join(" ");

      if (joined === "push --set-upstream origin feature/S01-001") {
        pushAttempts += 1;
        if (pushAttempts === 1) throw nfRejectError();
      }

      if (joined === "show-ref --verify refs/remotes/origin/feature/S01-001") {
        return "abc123 refs/remotes/origin/feature/S01-001\n" as any;
      }

      return "" as any;
    });

    await projectGitService.push(baseProject, "feature/S01-001");

    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["rebase", "origin/feature/S01-001"],
      expect.objectContaining({ cwd: baseProject.clone_path })
    );
    expect(pushAttempts).toBe(2);
  });

  it("performs explicit branch ref fetch when remote ref is initially missing", async () => {
    let pushAttempts = 0;
    let showRefChecks = 0;

    mockExec.mockImplementation((_cmd, args) => {
      const gitArgs = args as string[];
      const joined = gitArgs.join(" ");

      if (joined === "push --set-upstream origin feature/S01-001") {
        pushAttempts += 1;
        if (pushAttempts === 1) throw nfRejectError();
      }

      if (joined === "show-ref --verify refs/remotes/origin/feature/S01-001") {
        showRefChecks += 1;
        if (showRefChecks === 1) throw new Error("missing ref");
        return "abc123 refs/remotes/origin/feature/S01-001\n" as any;
      }

      return "" as any;
    });

    await projectGitService.push(baseProject, "feature/S01-001");

    expect(mockExec).toHaveBeenCalledWith(
      "git",
      [
        "fetch",
        "origin",
        "--update-shallow",
        "+refs/heads/feature/S01-001:refs/remotes/origin/feature/S01-001",
      ],
      expect.objectContaining({ cwd: baseProject.clone_path })
    );
    expect(pushAttempts).toBe(2);
    expect(showRefChecks).toBe(2);
  });

  it("fails fast with explicit upstream-missing error when branch does not exist remotely", async () => {
    let pushAttempts = 0;

    mockExec.mockImplementation((_cmd, args) => {
      const gitArgs = args as string[];
      const joined = gitArgs.join(" ");

      if (joined === "push --set-upstream origin feature/S01-001") {
        pushAttempts += 1;
        if (pushAttempts === 1) throw nfRejectError();
      }

      if (joined === "show-ref --verify refs/remotes/origin/feature/S01-001") {
        throw new Error("missing ref");
      }

      return "" as any;
    });

    await expect(projectGitService.push(baseProject, "feature/S01-001")).rejects.toThrow(
      "upstream branch is missing on origin/feature/S01-001"
    );

    expect(mockExec).not.toHaveBeenCalledWith(
      "git",
      ["rebase", "origin/feature/S01-001"],
      expect.anything()
    );
    expect(pushAttempts).toBe(1);
  });
});

describe("projectGitService.commitAll checkout recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stashes and retries checkout when local changes would be overwritten", async () => {
    let checkoutAttempts = 0;

    mockExec.mockImplementation((_cmd, args) => {
      const gitArgs = args as string[];
      const joined = gitArgs.join(" ");

      if (joined === "checkout feature/S01-001") {
        checkoutAttempts += 1;
        if (checkoutAttempts === 1) {
          const err = new Error("checkout blocked") as Error & { stderr: string };
          err.stderr = "error: Your local changes to the following files would be overwritten by checkout";
          throw err;
        }
      }

      if (joined === "rev-parse HEAD") {
        return "abc123\n" as any;
      }

      return "" as any;
    });

    const sha = await projectGitService.commitAll(baseProject, "feature/S01-001", "feat: test");

    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["stash", "push", "-u", "-m", "autostash-feature/S01-001"],
      expect.objectContaining({ cwd: baseProject.clone_path })
    );
    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["stash", "pop"],
      expect.objectContaining({ cwd: baseProject.clone_path })
    );
    expect(checkoutAttempts).toBe(2);
    expect(sha).toBe("abc123");
  });
});
