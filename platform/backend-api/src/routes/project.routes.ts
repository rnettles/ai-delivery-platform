import { Router } from "express";
import {
	assignProjectChannel,
	createProject,
	getProject,
	getProjectDesignArtifacts,
	getProjectDesignArtifactContent,
	listProjects,
	listProjectsByChannel,
	updateProjectPromptFields,
} from "../controllers/project.controller";

const router = Router();

router.get("/projects", listProjects);
router.get("/projects/by-channel", listProjectsByChannel);
router.get("/projects/:projectId", getProject);
router.get("/projects/:projectId/design-artifacts", getProjectDesignArtifacts);
router.get("/projects/:projectId/design-artifacts/content", getProjectDesignArtifactContent);
router.post("/projects", createProject);
router.post("/projects/:projectId/channels", assignProjectChannel);
router.put("/projects/:projectId/prompt-fields", updateProjectPromptFields);

export default router;
