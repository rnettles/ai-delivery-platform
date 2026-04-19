import { Router } from "express";
import {
  archiveCoordinationEntry,
  createCoordinationEntry,
  getCoordinationEntry,
  patchCoordinationEntry,
  queryCoordinationEntries
} from "../controllers/coordination.controller";

const router = Router();

router.post("/coordination", createCoordinationEntry);
router.get("/coordination/:coordinationId", getCoordinationEntry);
router.patch("/coordination/:coordinationId", patchCoordinationEntry);
router.post("/coordination/query", queryCoordinationEntries);
router.delete("/coordination/:coordinationId", archiveCoordinationEntry);

export default router;
