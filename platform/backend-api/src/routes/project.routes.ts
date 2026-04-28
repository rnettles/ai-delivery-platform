import { Router } from "express";
import {
	assignProjectChannel,
	createProject,
	getProject,
	listProjects,
	listProjectsByChannel,
} from "../controllers/project.controller";

const router = Router();

router.get("/projects", listProjects);
router.get("/projects/by-channel", listProjectsByChannel);
router.get("/projects/:projectId", getProject);
router.post("/projects", createProject);
router.post("/projects/:projectId/channels", assignProjectChannel);

export default router;
