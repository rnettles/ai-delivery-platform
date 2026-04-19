import { NextFunction, Request, Response } from "express";

/**
 * Validates the x-api-key header against the API_KEY environment variable.
 * The /health endpoint is exempt — it must remain unauthenticated for
 * container health checks (registered before this middleware in app.ts).
 *
 * Reads API_KEY at request time so the value can be changed without
 * restarting the process (and so tests can set it via process.env).
 *
 * Returns 401 if no key is provided, 403 if the key is invalid.
 * If API_KEY is not set the middleware passes through — set it in all
 * non-development environments.
 */
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    next();
    return;
  }

  const provided = req.header("x-api-key");

  if (!provided) {
    res.status(401).json({
      error: {
        code: "MISSING_API_KEY",
        message: "x-api-key header is required.",
        request_id: req.requestId,
      },
    });
    return;
  }

  if (provided !== apiKey) {
    res.status(403).json({
      error: {
        code: "INVALID_API_KEY",
        message: "The provided API key is not valid.",
        request_id: req.requestId,
      },
    });
    return;
  }

  next();
}
