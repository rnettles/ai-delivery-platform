import { Request, Response, NextFunction } from "express";
import { validationService } from "../services/validation.service";
import { executionService } from "../services/execution.service";
import { scriptRegistry } from "../services/script-registry.service";
import { ExecutionQuery } from "../domain/execution.types";

function getSingleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? "";
}

export async function executeScript(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = validationService.validateExecutionRequestBody(req.body);
    const result = await executionService.execute(payload, req.requestId);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    next(error);
  }
}

export function listScripts(_req: Request, res: Response): void {
  res.status(200).json(scriptRegistry.list());
}

export function getExecutionRecord(req: Request, res: Response, next: NextFunction): void {
  try {
    const record = executionService.getExecutionRecord(getSingleParam(req.params.executionId));
    res.status(200).json(record);
  } catch (error) {
    next(error);
  }
}

export function queryExecutionRecords(req: Request, res: Response, next: NextFunction): void {
  try {
    const query: ExecutionQuery = {
      correlation_id: typeof req.query.correlation_id === "string" ? req.query.correlation_id : undefined,
      target_name: typeof req.query.target_name === "string" ? req.query.target_name : undefined,
      status:
        req.query.status === "completed" || req.query.status === "failed"
          ? req.query.status
          : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined
    };

    const records = executionService.queryExecutions(query);
    res.status(200).json({ records });
  } catch (error) {
    next(error);
  }
}

export async function replayExecution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await executionService.replayExecution(getSingleParam(req.params.executionId), req.requestId);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    next(error);
  }
}
