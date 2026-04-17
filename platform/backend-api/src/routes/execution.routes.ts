import { Router } from "express";
import { executeScript, listScripts } from "../controllers/execution.controller";

const router = Router();
router.get("/scripts", listScripts);
router.post("/execute", executeScript);

export default router;
