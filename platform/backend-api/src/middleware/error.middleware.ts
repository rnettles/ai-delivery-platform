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

  const errorObj = err instanceof Error ? err : undefined;
  const causeObj = errorObj?.cause instanceof Error ? errorObj.cause : undefined;

  logger.error("Unhandled error", {
    request_id: req.requestId,
    error: errorObj?.message ?? String(err),
    error_name: errorObj?.name,
    error_stack: errorObj?.stack,
    cause: causeObj?.message,
    cause_name: causeObj?.name,
    cause_stack: causeObj?.stack,
    cause_raw: errorObj?.cause
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      request_id: req.requestId
    }
  });
}
