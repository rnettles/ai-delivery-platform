import { Router } from "express";
import { triggerGitSync, getGitStatus } from "../controllers/git-sync.controller";

const router = Router();

router.post("/git/sync", triggerGitSync);
router.get("/git/status", getGitStatus);

export default router;
