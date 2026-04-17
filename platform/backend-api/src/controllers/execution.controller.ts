import { Request, Response, NextFunction } from "express";
import { validationService } from "../services/validation.service";
import { executionService } from "../services/execution.service";
import { scriptRegistry } from "../services/script-registry.service";

export async function executeScript(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = validationService.validateExecutionRequestBody(req.body);
    const result = await executionService.execute(payload, req.requestId);
    res.status(result.status === "completed" ? 200 : 500).json(result);
  } catch (error) {
    next(error);
  }
}

export function listScripts(_req: Request, res: Response): void {
  res.status(200).json({
    scripts: scriptRegistry.list()
  });
}
