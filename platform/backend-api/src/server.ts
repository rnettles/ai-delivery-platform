import express from "express";
import { randomUUID } from "crypto";
import { db } from "./db/client";
import { state, stateHistory } from "./db/schema";
import { eq } from "drizzle-orm";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const handleExecute = async (req: express.Request, res: express.Response) => {
  try {
    const { execution_id, script, input } = req.body;

    if (!script) {
      return res.status(400).json({
        error: "script is required",
      });
    }

    const execId = execution_id || randomUUID();

    if (script === "test.echo") {
      return res.status(200).json({
        execution_id: execId,
        status: "completed",
        output: input,
      });
    }

    if (script === "planner.generate_phase_plan") {
      const output = {
        phases: [
          { name: "Phase 1", goal: "Foundation" },
          { name: "Phase 2", goal: "Expansion" },
        ],
      };

      const stateId = randomUUID();
      const now = new Date();

      await db.insert(state).values({
        state_id: stateId,
        type: "workflow",
        scope: "planner",
        version: 1,
        data: output,
        created_at: now,
        updated_at: now,
      });

      return res.status(200).json({
        execution_id: execId,
        status: "completed",
        output,
        state_id: stateId,
      });
    }

    return res.status(404).json({
      error: `Unknown script: ${script}`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to execute script" });
  }
};

// -----------------------------
// Health
// -----------------------------
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// -----------------------------
// State API (REAL - POSTGRES)
// -----------------------------

// Create State
app.post("/state", async (req, res) => {
  if (req.body?.script) {
    return handleExecute(req, res);
  }

  try {
    const { state_id, type, scope, data, metadata } = req.body;

    if (!type || !scope || data === undefined) {
      return res.status(400).json({
        error: "state create requires type, scope, and data",
      });
    }

    const id = state_id || randomUUID();
    const now = new Date();

    const result = await db
      .insert(state)
      .values({
        state_id: id,
        type,
        scope,
        version: 1,
        data,
        metadata: metadata ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning();

    res.status(200).json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create state" });
  }
});

// Update State (WITH VERSIONING)
app.post("/state/update/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { data, metadata } = req.body;

    const existing = await db
      .select()
      .from(state)
      .where(eq(state.state_id, id));

    if (!existing.length) {
      return res.status(404).json({ error: "State not found" });
    }

    const current = existing[0];

    // 1. Write history
    await db.insert(stateHistory).values({
      id: randomUUID(),
      state_id: id,
      version: current.version,
      data: current.data,
      metadata: current.metadata,
    });

    // 2. Update state
    const updated = await db
      .update(state)
      .set({
        version: current.version + 1,
        data,
        metadata,
        updated_at: new Date(),
      })
      .where(eq(state.state_id, id))
      .returning();

    res.status(200).json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update state" });
  }
});

// Get Current State
app.get("/state/:id", async (req, res) => {
  try {
    const result = await db
      .select()
      .from(state)
      .where(eq(state.state_id, req.params.id));

    if (!result.length) {
      return res.status(404).json({ error: "State not found" });
    }

    res.status(200).json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch state" });
  }
});

// Get State History
app.get("/state/:id/history", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(stateHistory)
      .where(eq(stateHistory.state_id, req.params.id));

    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// -----------------------------
// Execute
// -----------------------------
app.post("/execute", async (req, res) => {
  return handleExecute(req, res);
});

// -----------------------------
app.listen(PORT, () => {
  console.log(`Execution service running on port ${PORT}`);
});