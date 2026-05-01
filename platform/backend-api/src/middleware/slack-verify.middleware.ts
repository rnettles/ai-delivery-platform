import { createHmac, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { config } from "../config";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

/**
 * Verifies the X-Slack-Signature header on inbound Slack webhook requests.
 *
 * Slack signs every request with HMAC-SHA256 over:
 *   v0:{x-slack-request-timestamp}:{raw body bytes}
 *
 * This middleware must run AFTER a body parser that captures rawBody
 * (express.json / express.urlencoded with a verify callback).
 *
 * When SLACK_SIGNING_SECRET is not configured the check is skipped so that
 * local development and test environments work without Slack credentials.
 */
export function verifySlackSignature(req: Request, res: Response, next: NextFunction): void {
  const signingSecret = config.slackSigningSecret;

  if (!signingSecret) {
    next();
    return;
  }

  const timestamp = req.header("x-slack-request-timestamp") ?? "";
  const slackSig = req.header("x-slack-signature") ?? "";

  if (!timestamp || !slackSig) {
    res.status(403).json({ error: "Missing Slack signature headers" });
    return;
  }

  // Reject requests older than 5 minutes to prevent replay attacks
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) {
    res.status(403).json({ error: "Request timestamp too old" });
    return;
  }

  const rawBody = req.rawBody instanceof Buffer ? req.rawBody.toString("utf-8") : "";
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const computed = `v0=${createHmac("sha256", signingSecret).update(sigBase).digest("hex")}`;

  const computedBuf = Buffer.from(computed, "utf-8");
  const providedBuf = Buffer.from(slackSig, "utf-8");

  if (computedBuf.length !== providedBuf.length || !timingSafeEqual(computedBuf, providedBuf)) {
    res.status(403).json({ error: "Invalid Slack signature" });
    return;
  }

  next();
}
