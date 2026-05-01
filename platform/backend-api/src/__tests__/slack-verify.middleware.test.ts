import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { Request, Response, NextFunction } from "express";

vi.mock("../config", () => ({
  config: {
    slackSigningSecret: "test-signing-secret",
  },
}));

import { verifySlackSignature } from "../middleware/slack-verify.middleware";
import { config } from "../config";

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    header: vi.fn(),
    rawBody: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function validSignature(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", secret).update(base).digest("hex");
  return `v0=${hmac}`;
}

describe("verifySlackSignature middleware", () => {
  let next: NextFunction;
  const NOW_SECONDS = Math.floor(Date.now() / 1000);
  const SECRET = "test-signing-secret";

  beforeEach(() => {
    next = vi.fn();
  });

  it("calls next() when SLACK_SIGNING_SECRET is not configured", () => {
    (config as { slackSigningSecret: string }).slackSigningSecret = "";
    const req = makeRequest();
    const res = makeResponse();

    verifySlackSignature(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();

    (config as { slackSigningSecret: string }).slackSigningSecret = SECRET;
  });

  it("returns 403 when X-Slack-Signature header is missing", () => {
    const req = makeRequest({ header: vi.fn().mockReturnValue("") } as unknown as Partial<Request>);
    const res = makeResponse();

    verifySlackSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when timestamp is too old", () => {
    const oldTimestamp = String(NOW_SECONDS - 400); // 400 seconds ago
    const body = "command=%2Fplan&text=build+auth";
    const sig = validSignature(SECRET, oldTimestamp, body);

    const req = makeRequest({
      header: vi.fn((name: string) => {
        if (name === "x-slack-request-timestamp") return oldTimestamp;
        if (name === "x-slack-signature") return sig;
        return undefined;
      }) as unknown as (name: string) => string,
      rawBody: Buffer.from(body),
    });
    const res = makeResponse();

    verifySlackSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when signature is invalid", () => {
    const timestamp = String(NOW_SECONDS);
    const body = "command=%2Fplan&text=build+auth";
    const wrongSig = "v0=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const req = makeRequest({
      header: vi.fn((name: string) => {
        if (name === "x-slack-request-timestamp") return timestamp;
        if (name === "x-slack-signature") return wrongSig;
        return undefined;
      }) as unknown as (name: string) => string,
      rawBody: Buffer.from(body),
    });
    const res = makeResponse();

    verifySlackSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when signature is valid", () => {
    const timestamp = String(NOW_SECONDS);
    const body = "command=%2Fplan&text=build+auth";
    const sig = validSignature(SECRET, timestamp, body);

    const req = makeRequest({
      header: vi.fn((name: string) => {
        if (name === "x-slack-request-timestamp") return timestamp;
        if (name === "x-slack-signature") return sig;
        return undefined;
      }) as unknown as (name: string) => string,
      rawBody: Buffer.from(body),
    });
    const res = makeResponse();

    verifySlackSignature(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("handles empty rawBody gracefully when computing HMAC", () => {
    const timestamp = String(NOW_SECONDS);
    const body = "";
    const sig = validSignature(SECRET, timestamp, body);

    const req = makeRequest({
      header: vi.fn((name: string) => {
        if (name === "x-slack-request-timestamp") return timestamp;
        if (name === "x-slack-signature") return sig;
        return undefined;
      }) as unknown as (name: string) => string,
      rawBody: undefined, // rawBody not set
    });
    const res = makeResponse();

    verifySlackSignature(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
