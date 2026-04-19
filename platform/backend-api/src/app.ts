import cors from "cors";
import express from "express";
import executionRoutes from "./routes/execution.routes";
import coordinationRoutes from "./routes/coordination.routes";
import pipelineRoutes from "./routes/pipeline.routes";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { errorMiddleware } from "./middleware/error.middleware";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(requestIdMiddleware);

app.get("/health", (_req, res) => {
	res.status(200).json({ status: "ok" });
});

app.use(executionRoutes);
app.use(coordinationRoutes);
app.use(pipelineRoutes);

app.use(errorMiddleware);
