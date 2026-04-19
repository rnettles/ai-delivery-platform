import { Router } from "express";
import {
  approvePipeline,
  createPipeline,
  getPipeline,
  handoffPipeline,
  skipPipeline,
  takeoverPipeline,
} from "../controllers/pipeline.controller";

const router = Router();

router.post("/pipeline", createPipeline);
router.get("/pipeline/:pipelineId", getPipeline);
router.post("/pipeline/:pipelineId/approve", approvePipeline);
router.post("/pipeline/:pipelineId/takeover", takeoverPipeline);
router.post("/pipeline/:pipelineId/handoff", handoffPipeline);
router.post("/pipeline/:pipelineId/skip", skipPipeline);

export default router;
