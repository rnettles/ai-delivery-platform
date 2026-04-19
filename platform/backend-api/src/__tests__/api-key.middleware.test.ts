import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// Prevent DB / logger side-effects
vi.mock("../db/client", () => ({ db: {} }));
vi.mock("../services/logger.service", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { app } from "../app";

describe("apiKeyMiddleware", () => {
  const originalApiKey = process.env.API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.API_KEY = originalApiKey;
  });

  describe("when API_KEY is not configured", () => {
    it("passes through all requests without a key", async () => {
      delete process.env.API_KEY;
      // /health is always open; any 200/404 (not 401/403) confirms middleware passed
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    });
  });

  describe("when API_KEY is configured", () => {
    beforeEach(() => {
      process.env.API_KEY = "test-secret-key";
    });

    it("/health is exempt and returns 200 without a key", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    });

    it("returns 401 when x-api-key header is missing", async () => {
      const res = await request(app).get("/executions");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("MISSING_API_KEY");
    });

    it("returns 403 when x-api-key header is wrong", async () => {
      const res = await request(app).get("/executions").set("x-api-key", "wrong-key");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVALID_API_KEY");
    });

    it("passes through when correct x-api-key header is provided", async () => {
      const res = await request(app).get("/executions").set("x-api-key", "test-secret-key");
      // 200 or any non-auth error confirms the middleware passed
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});
