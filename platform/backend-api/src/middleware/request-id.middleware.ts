import { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header("x-request-id") || uuidv4();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}
