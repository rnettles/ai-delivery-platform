import { NextFunction, Request, Response } from "express";
import { coordinationService } from "../services/coordination.service";
import { validationService } from "../services/validation.service";

function getSingleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? "";
}

export function createCoordinationEntry(req: Request, res: Response, next: NextFunction): void {
  try {
    const payload = validationService.validateCoordinationCreateBody(req.body);
    const entry = coordinationService.create(payload);
    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
}

export function getCoordinationEntry(req: Request, res: Response, next: NextFunction): void {
  try {
    const entry = coordinationService.getById(getSingleParam(req.params.coordinationId));
    res.status(200).json(entry);
  } catch (error) {
    next(error);
  }
}

export function patchCoordinationEntry(req: Request, res: Response, next: NextFunction): void {
  try {
    const patch = validationService.validateCoordinationPatchBody(req.body);
    const entry = coordinationService.patch(getSingleParam(req.params.coordinationId), patch);
    res.status(200).json(entry);
  } catch (error) {
    next(error);
  }
}

export function queryCoordinationEntries(req: Request, res: Response, next: NextFunction): void {
  try {
    const payload = validationService.validateCoordinationQueryBody(req.body ?? {});
    const entries = coordinationService.query(payload);
    res.status(200).json({ entries });
  } catch (error) {
    next(error);
  }
}

export function archiveCoordinationEntry(req: Request, res: Response, next: NextFunction): void {
  try {
    const entry = coordinationService.archive(getSingleParam(req.params.coordinationId));
    res.status(200).json(entry);
  } catch (error) {
    next(error);
  }
}
