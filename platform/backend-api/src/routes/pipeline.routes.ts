import { Router } from "express";
import {
  approvePipeline,
  cancelPipeline,
  createPipeline,
  getChannelPipelineStatusList,
  getCurrentPipelineStatusSummary,
  getPipeline,
  getPipelineArtifact,
  getStagedPhases,
  getStagedSprints,
  getStagedTasks,
  getPipelineStagedPhases,
  getPipelineStagedSprints,
  getPipelineStagedTasks,
  getPipelineStatusSummary,
  handoffPipeline,
  retryPipeline,
  skipPipeline,
  takeoverPipeline,
} from "../controllers/pipeline.controller";

const router = Router();

router.post("/pipeline", createPipeline);
router.get("/pipeline/staged/phases", getStagedPhases);
router.get("/pipeline/staged/sprints", getStagedSprints);
router.get("/pipeline/staged/tasks", getStagedTasks);
router.get("/pipeline/:pipelineId", getPipeline);
router.get("/pipeline/:pipelineId/artifact", getPipelineArtifact);
router.get("/pipeline/:pipelineId/staged/phases", getPipelineStagedPhases);
router.get("/pipeline/:pipelineId/staged/sprints", getPipelineStagedSprints);
router.get("/pipeline/:pipelineId/staged/tasks", getPipelineStagedTasks);
router.get("/pipeline/:pipelineId/status-summary", getPipelineStatusSummary);
router.get("/pipeline/status-summary/current", getCurrentPipelineStatusSummary);
router.get("/pipeline/status-summary/by-channel", getChannelPipelineStatusList);
router.post("/pipeline/:pipelineId/cancel", cancelPipeline);
router.post("/pipeline/:pipelineId/approve", approvePipeline);
router.post("/pipeline/:pipelineId/takeover", takeoverPipeline);
router.post("/pipeline/:pipelineId/retry", retryPipeline);
router.post("/pipeline/:pipelineId/handoff", handoffPipeline);
router.post("/pipeline/:pipelineId/skip", skipPipeline);

export default router;
