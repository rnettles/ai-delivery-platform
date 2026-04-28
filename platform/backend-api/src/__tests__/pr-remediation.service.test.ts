import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class GithubApiError extends Error {
    public readonly statusCode?: number;
    public readonly metadata: Record<string, unknown>;
    public readonly responseBody?: string;

    constructor(message: string, opts: { statusCode?: number; metadata: Record<string, unknown>; responseBody?: string }) {
      super(message);
      this.name = "GithubApiError";
      this.statusCode = opts.statusCode;
      this.metadata = opts.metadata;
      this.responseBody = opts.responseBody;
    }
  }

  return {
    GithubApiError,
    preflightPullRequest: vi.fn(),
    createPullRequest: vi.fn(),
    findOpenPullRequestByHead: vi.fn(),
    withProjectLock: vi.fn(),
    ensureReady: vi.fn(),
    push: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
});

vi.mock("../services/github-api.service", () => ({
  GithubApiError: mocks.GithubApiError,
  githubApiService: {
    preflightPullRequest: mocks.preflightPullRequest,
    createPullRequest: mocks.createPullRequest,
    findOpenPullRequestByHead: mocks.findOpenPullRequestByHead,
  },
}));

vi.mock("../services/project-git.service", () => ({
  projectGitService: {
    withProjectLock: mocks.withProjectLock,
    ensureReady: mocks.ensureReady,
    push: mocks.push,
  },
}));

vi.mock("../services/logger.service", () => ({
  logger: {
    warn: mocks.warn,
    info: mocks.info,
    error: mocks.error,
  },
}));

import { prRemediationService } from "../services/pr-remediation.service";

describe("prRemediationService.createPullRequestWithRecovery", () => {
  const project = {
    project_id: "proj-1",
    name: "phks",
    repo_url: "https://github.com/rnettles/Personal-Health-Knowledge-System",
    default_branch: "main",
    clone_path: "C:/repo",
    created_at: "2026-04-28T00:00:00.000Z",
    updated_at: "2026-04-28T00:00:00.000Z",
  };

  const existingPr = {
    number: 4,
    url: "https://api.github.com/repos/rnettles/Personal-Health-Knowledge-System/pulls/4",
    html_url: "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/4",
    state: "open",
    merged: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preflightPullRequest.mockResolvedValue({ ok: true, request_metadata: [] });
    mocks.findOpenPullRequestByHead.mockResolvedValue(null);
    mocks.createPullRequest.mockResolvedValue(existingPr);
    mocks.withProjectLock.mockImplementation(async (_projectId: string, fn: () => Promise<void>) => fn());
  });

  it("reuses existing open PR before create attempt", async () => {
    mocks.findOpenPullRequestByHead.mockResolvedValueOnce(existingPr);

    const result = await prRemediationService.createPullRequestWithRecovery(project as any, {
      title: "[S01] Stage sprint artifacts",
      body: "body",
      head: "feature/S01-001",
      base: "main",
    });

    expect(result.pr.number).toBe(4);
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
    expect(mocks.preflightPullRequest).not.toHaveBeenCalled();
  });

  it("recovers from duplicate-PR 422 by resolving existing PR", async () => {
    mocks.createPullRequest.mockRejectedValueOnce(
      new mocks.GithubApiError("GitHub request failed: 422 Unprocessable Entity", {
        statusCode: 422,
        metadata: { endpoint: "/pulls" },
        responseBody: '{"message":"Validation Failed","errors":[{"message":"A pull request already exists for rnettles:feature/S01-001."}]}',
      })
    );
    mocks.findOpenPullRequestByHead
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingPr);

    const result = await prRemediationService.createPullRequestWithRecovery(project as any, {
      title: "[S01] Stage sprint artifacts",
      body: "body",
      head: "feature/S01-001",
      base: "main",
    });

    expect(result.pr.number).toBe(4);
    expect(mocks.findOpenPullRequestByHead).toHaveBeenCalledTimes(2);
  });

  it("does not swallow unrelated 422 errors", async () => {
    mocks.createPullRequest.mockRejectedValueOnce(
      new mocks.GithubApiError("GitHub request failed: 422 Unprocessable Entity", {
        statusCode: 422,
        metadata: { endpoint: "/pulls" },
        responseBody: '{"message":"Validation Failed","errors":[{"message":"No commits between base and head"}]}',
      })
    );

    await expect(
      prRemediationService.createPullRequestWithRecovery(project as any, {
        title: "[S01] Stage sprint artifacts",
        body: "body",
        head: "feature/S01-001",
        base: "main",
      })
    ).rejects.toThrow("GitHub request failed: 422 Unprocessable Entity");
  });
});
