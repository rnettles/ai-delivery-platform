import express, { Router } from "express";
import { handleSlackActions, handleSlackEvents } from "../controllers/slack.controller";
import { verifySlackSignature } from "../middleware/slack-verify.middleware";

const router = Router();

/**
 * Raw body parser for Slack webhook endpoints.
 *
 * Slack sends either application/json (Event API) or
 * application/x-www-form-urlencoded (slash commands, interactive actions).
 * We capture the raw Buffer so the signature verification middleware can
 * compute the HMAC before the body is parsed by higher-level middlewares.
 */
function captureRawBody(_req: express.Request, _res: express.Response, buf: Buffer): void {
  _req.rawBody = buf;
}

const rawJson = express.json({
  limit: "1mb",
  verify: captureRawBody,
});

const rawUrlencoded = express.urlencoded({
  extended: false,
  verify: captureRawBody,
});

/**
 * POST /slack/events
 *
 * Receives Slack Event API callbacks and slash commands.
 * Slack signature is verified before processing.
 */
router.post(
  "/slack/events",
  (req, res, next) => {
    const ct = (req.header("content-type") ?? "").toLowerCase();
    if (ct.includes("application/x-www-form-urlencoded")) {
      rawUrlencoded(req, res, next);
    } else {
      rawJson(req, res, next);
    }
  },
  verifySlackSignature,
  handleSlackEvents
);

/**
 * POST /slack/actions
 *
 * Receives Slack interactive component payloads (button clicks).
 * Always application/x-www-form-urlencoded with a JSON `payload` key.
 * Slack signature is verified before processing.
 */
router.post("/slack/actions", rawUrlencoded, verifySlackSignature, handleSlackActions);

export default router;
