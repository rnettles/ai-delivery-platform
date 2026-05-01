import { RequestHandler } from "express";
import * as crypto from "crypto";
import { config } from "../config";

const SLACK_SIGNATURE_VERSION = "v0";
const MAX_AGE_SECONDS = 300; // 5 minutes

/**
 * Verifies Slack request signatures using HMAC-SHA256.
 * Rejects requests older than 5 minutes (replay protection).
 * Must be used with express.raw() body parser so the raw buffer is available.
 */
export const slackSignatureMiddleware: RequestHandler = (req, res, next) => {
  const signingSecret = config.slackSigningSecret;

  if (!signingSecret) {
    // If no signing secret is configured, allow through in development only
    if (config.nodeEnv !== "development") {
      res.status(500).json({ error: "Slack signing secret not configured" });
      return;
    }
    next();
    return;
  }

  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];

  if (typeof timestamp !== "string" || typeof slackSignature !== "string") {
    res.status(400).json({ error: "Missing Slack signature headers" });
    return;
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    res.status(400).json({ error: "Invalid timestamp header" });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_AGE_SECONDS) {
    res.status(400).json({ error: "Request timestamp too old" });
    return;
  }

  // req.body is a Buffer when express.raw() is used
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sigBasestring = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;

  const mySignature =
    SLACK_SIGNATURE_VERSION +
    "=" +
    crypto.createHmac("sha256", signingSecret).update(sigBasestring, "utf8").digest("hex");

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(slackSignature, "utf8");
  const myBuffer = Buffer.from(mySignature, "utf8");

  if (sigBuffer.length !== myBuffer.length || !crypto.timingSafeEqual(sigBuffer, myBuffer)) {
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  next();
};
