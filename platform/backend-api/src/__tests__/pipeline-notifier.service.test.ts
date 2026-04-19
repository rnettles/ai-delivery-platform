import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../config", () => ({
  config: { n8nCallbackUrl: "https://n8n.example.com" },
}));

import { PipelineNotifierService } from "../services/pipeline-notifier.service";
import { PipelineNotification } from "../domain/pipeline.types";
import { config } from "../config";

const baseNotification: PipelineNotification = {
  pipeline_id: "pipe-2026-04-19-test1234",
  step: "planner",
  status: "awaiting_approval",
  gate_required: true,
  artifact_paths: ["artifacts/plan.md"],
  metadata: { source: "slack" },
};

describe("PipelineNotifierService", () => {
  let service: PipelineNotifierService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new PipelineNotifierService();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    (config as { n8nCallbackUrl: string }).n8nCallbackUrl = "https://n8n.example.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the notification to the correct N8N webhook URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await service.notify(baseNotification);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://n8n.example.com/webhook/pipeline-notify");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toMatchObject({
      pipeline_id: "pipe-2026-04-19-test1234",
      step: "planner",
      gate_required: true,
    });
  });

  it("strips trailing slash from callback URL before appending path", async () => {
    (config as { n8nCallbackUrl: string }).n8nCallbackUrl = "https://n8n.example.com/";

    mockFetch.mockResolvedValueOnce({ ok: true });
    await service.notify(baseNotification);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://n8n.example.com/webhook/pipeline-notify");
  });

  it("does not throw when fetch fails (best-effort)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    // Should resolve without throwing
    await expect(service.notify(baseNotification)).resolves.toBeUndefined();
  });

  it("does not throw when N8N responds with non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(service.notify(baseNotification)).resolves.toBeUndefined();
  });

  it("skips the call when N8N_CALLBACK_URL is not configured", async () => {
    (config as { n8nCallbackUrl: string }).n8nCallbackUrl = "";

    await service.notify(baseNotification);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
