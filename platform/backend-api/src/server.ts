import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -----------------------------
// In-Memory State (TEMPORARY)
// -----------------------------
const stateStore = new Map<string, any>();

// -----------------------------
// Health
// -----------------------------
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// -----------------------------
// State API (MINIMAL)
// -----------------------------

// Create / Update State
app.post("/state", (req, res) => {
  const { state_id, type, scope, data, metadata } = req.body;

  const id = state_id || randomUUID();

  const record = {
    state_id: id,
    type,
    scope,
    data,
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  stateStore.set(id, record);

  res.status(200).json(record);
});

// Get State
app.get("/state/:id", (req, res) => {
  const record = stateStore.get(req.params.id);

  if (!record) {
    return res.status(404).json({
      error: "State not found"
    });
  }

  res.status(200).json(record);
});

// -----------------------------
// Execute
// -----------------------------
app.post("/execute", (req, res) => {
  const { execution_id, script, input } = req.body;

  if (!script) {
    return res.status(400).json({
      error: "script is required"
    });
  }

  const execId = execution_id || randomUUID();

  // Minimal behavior
  if (script === "test.echo") {
    const result = {
      execution_id: execId,
      status: "completed",
      output: input
    };

    return res.status(200).json(result);
  }

  // Fake "planner" script (your first real step)
  if (script === "planner.generate_phase_plan") {
    const output = {
      phases: [
        { name: "Phase 1", goal: "Foundation" },
        { name: "Phase 2", goal: "Expansion" }
      ]
    };

    // 🔥 Store result in state (IMPORTANT)
    const stateId = randomUUID();

    stateStore.set(stateId, {
      state_id: stateId,
      type: "workflow",
      scope: "planner",
      data: output,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    return res.status(200).json({
      execution_id: execId,
      status: "completed",
      output,
      state_id: stateId
    });
  }

  return res.status(404).json({
    error: `Unknown script: ${script}`
  });
});

// -----------------------------
app.listen(PORT, () => {
  console.log(`Execution service running on port ${PORT}`);
});