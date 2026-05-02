import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listAwaitingPrReviewRuns = vi.fn();
  const markPrMerged = vi.fn();
  const markPrClosed = vi.fn();
  const getById = vi.fn();
  const getPullRequest = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();

  return {
    listAwaitingPrReviewRuns,
    markPrMerged,
    markPrClosed,
    getById,
    getPullRequest,
    info,
    warn,
    error,
    debug,
  };
});

vi.mock("../services/pipeline.service", () => ({
  pipelineService: {
    listAwaitingPrReviewRuns: mocks.listAwaitingPrReviewRuns,
    markPrMerged: mocks.markPrMerged,
    markPrClosed: mocks.markPrClosed,
  },
}));

vi.mock("../services/project.service", () => ({
  projectService: {
    getById: mocks.getById,
  },
}));

vi.mock("../services/github-api.service", () => ({
  githubApiService: {
    getPullRequest: mocks.getPullRequest,
  },
}));

vi.mock("../services/logger.service", () => ({
  logger: {
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
    debug: mocks.debug,
  },
}));

import { prMergePollerService } from "../services/pr-merge-poller.service";

describe("prMergePollerService merge gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.listAwaitingPrReviewRuns.mockResolvedValue([
      {
        pipeline_id: "pipe-1",
        project_id: "proj-1",
        pr_number: 4,
        sprint_branch: "feature/S01-001",
      },
    ]);

    mocks.getById.mockResolvedValue({
      project_id: "proj-1",
      repo_url: "https://github.com/rnettles/Personal-Health-Knowledge-System",
    });
  });

  it("does not close sprint while PR is still open", async () => {
    mocks.getPullRequest.mockResolvedValue({
      number: 4,
      url: "https://api.github.com/repos/rnettles/Personal-Health-Knowledge-System/pulls/4",
      html_url: "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/4",
      state: "open",
      merged: false,
    });

    await (prMergePollerService as any).tick();

    expect(mocks.markPrMerged).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      "PR merge gate waiting: merge the open sprint PR to advance the pipeline",
      expect.objectContaining({ pipeline_id: "pipe-1", pr_number: 4, sprint_branch: "feature/S01-001" })
    );
  });

  it("closes sprint after merged PR is observed", async () => {
    mocks.getPullRequest.mockResolvedValue({
      number: 4,
      url: "https://api.github.com/repos/rnettles/Personal-Health-Knowledge-System/pulls/4",
      html_url: "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/4",
      state: "closed",
      merged: true,
    });

    await (prMergePollerService as any).tick();

    expect(mocks.markPrMerged).toHaveBeenCalledWith("pipe-1");
  });

  it("auto-fails pipeline when PR is closed without merging", async () => {
    mocks.getPullRequest.mockResolvedValue({
      number: 4,
      url: "https://api.github.com/repos/rnettles/Personal-Health-Knowledge-System/pulls/4",
      html_url: "https://github.com/rnettles/Personal-Health-Knowledge-System/pull/4",
      state: "closed",
      merged: false,
    });

    await (prMergePollerService as any).tick();

    expect(mocks.markPrClosed).toHaveBeenCalledWith("pipe-1");
    expect(mocks.markPrMerged).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      "PR merge poll: PR is closed but not merged — auto-failing pipeline",
      expect.objectContaining({ pipeline_id: "pipe-1", pr_number: 4, pr_state: "closed" })
    );
  });
});
