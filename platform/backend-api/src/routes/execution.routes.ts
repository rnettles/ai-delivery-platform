import { Router } from "express";
import {
	executeScript,
	getExecutionRecord,
	listScripts,
	queryExecutionRecords,
	replayExecution
} from "../controllers/execution.controller";

const router = Router();
router.get("/scripts", listScripts);
router.post("/execute", executeScript);
router.get("/executions", queryExecutionRecords);
router.get("/executions/:executionId", getExecutionRecord);
router.post("/executions/:executionId/replay", replayExecution);

export default router;
