import { describe, it, expect, vi, beforeEach } from "vitest";
import { vol } from "memfs";

// ─── Mock fs/promises with memfs ────────────────────────────────────────────
vi.mock("fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = fs.promises as typeof import("fs/promises");
  return { default: promises, ...promises };
});

vi.mock("../config", () => ({
  config: { artifactBasePath: "/artifacts", artifactRetentionDays: 7 },
}));

vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { ArtifactService } from "../services/artifact.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeService() {
  return new ArtifactService();
}

beforeEach(() => {
  vol.reset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ArtifactService.cleanup()", () => {
  it("removes the pipeline artifact directory", async () => {
    const service = makeService();
    vol.fromJSON({
      "/artifacts/pipe-001/plan.md": "# Plan",
      "/artifacts/pipe-001/brief.md": "# Brief",
    });

    await service.cleanup("pipe-001");

    expect(vol.existsSync("/artifacts/pipe-001")).toBe(false);
  });

  it("is idempotent — does not throw when directory does not exist", async () => {
    const service = makeService();
    vol.fromJSON({ "/artifacts/.keep": "" }); // base dir exists, pipeline dir does not

    await expect(service.cleanup("pipe-nonexistent")).resolves.toBeUndefined();
  });

  it("does not remove other pipeline directories", async () => {
    const service = makeService();
    vol.fromJSON({
      "/artifacts/pipe-001/plan.md": "# Plan",
      "/artifacts/pipe-002/brief.md": "# Brief",
    });

    await service.cleanup("pipe-001");

    expect(vol.existsSync("/artifacts/pipe-001")).toBe(false);
    expect(vol.existsSync("/artifacts/pipe-002")).toBe(true);
  });
});

describe("ArtifactService.cleanupStale()", () => {
  it("removes directories for pipelines that are terminal-failure and past retention", async () => {
    const service = makeService();
    vol.fromJSON({ "/artifacts/pipe-old/plan.md": "# Plan" });

    // Backdate both the file and directory mtime to 8 days ago
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    vol.utimesSync("/artifacts/pipe-old/plan.md", oldTime, oldTime);
    vol.utimesSync("/artifacts/pipe-old", oldTime, oldTime);

    const isTerminalFailure = vi.fn().mockResolvedValue(true);

    await service.cleanupStale(isTerminalFailure);

    expect(vol.existsSync("/artifacts/pipe-old")).toBe(false);
    expect(isTerminalFailure).toHaveBeenCalledWith("pipe-old");
  });

  it("retains directories still within the retention window", async () => {
    const service = makeService();
    vol.fromJSON({ "/artifacts/pipe-fresh/plan.md": "# Plan" });
    // mtime defaults to now — within 7-day window

    const isTerminalFailure = vi.fn().mockResolvedValue(true);

    await service.cleanupStale(isTerminalFailure);

    expect(vol.existsSync("/artifacts/pipe-fresh")).toBe(true);
  });

  it("retains directories for pipelines not in terminal-failure state", async () => {
    const service = makeService();
    vol.fromJSON({ "/artifacts/pipe-running/plan.md": "# Plan" });

    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    vol.utimesSync("/artifacts/pipe-running/plan.md", oldTime, oldTime);
    vol.utimesSync("/artifacts/pipe-running", oldTime, oldTime);

    const isTerminalFailure = vi.fn().mockResolvedValue(false);

    await service.cleanupStale(isTerminalFailure);

    expect(vol.existsSync("/artifacts/pipe-running")).toBe(true);
  });

  it("returns early without error when base path does not exist", async () => {
    const service = makeService();
    vol.fromJSON({}); // /artifacts does not exist

    const isTerminalFailure = vi.fn();

    await expect(service.cleanupStale(isTerminalFailure)).resolves.toBeUndefined();
    expect(isTerminalFailure).not.toHaveBeenCalled();
  });
});
