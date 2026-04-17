import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error";
import { logger } from "../services/logger.service";

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    logger.error("Request failed", {
      request_id: req.requestId,
      code: err.code,
      status_code: err.statusCode,
      details: err.details
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: req.requestId
      }
    });
    return;
  }

  logger.error("Unhandled error", {
    request_id: req.requestId,
    error: err instanceof Error ? err.message : String(err)
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      request_id: req.requestId
    }
  });
}
