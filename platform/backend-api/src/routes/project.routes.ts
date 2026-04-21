import { Router } from "express";
import { assignProjectChannel, createProject } from "../controllers/project.controller";

const router = Router();

router.post("/projects", createProject);
router.post("/projects/:projectId/channels", assignProjectChannel);

export default router;
