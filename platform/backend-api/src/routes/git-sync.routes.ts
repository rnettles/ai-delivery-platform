import { Router } from "express";
import {
	triggerGitSync,
	getGitStatus,
	createAdminOpsJob,
	getAdminOpsJob,
} from "../controllers/git-sync.controller";

const router = Router();

router.post("/git/sync", triggerGitSync);
router.get("/git/status", getGitStatus);
router.post("/admin/ops", createAdminOpsJob);
router.get("/admin/ops/:jobId", getAdminOpsJob);

export default router;
