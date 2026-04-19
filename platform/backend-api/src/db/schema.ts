import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  boolean
} from "drizzle-orm/pg-core";

export const state = pgTable(
  "state",
  {
    state_id: uuid("state_id").primaryKey().notNull(),

    type: text("type").notNull(),
    scope: text("scope").notNull(),

    version: integer("version").default(1).notNull(),

    data: jsonb("data").notNull(),
    metadata: jsonb("metadata"),

    status: text("status"), // optional: active, archived, failed

    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    scopeIdx: index("idx_state_scope").on(table.scope),
  })
);



export const stateHistory = pgTable(
  "state_history",
  {
    id: uuid("id").primaryKey().notNull(),

    state_id: uuid("state_id").notNull(),

    version: integer("version").notNull(),

    data: jsonb("data").notNull(),
    metadata: jsonb("metadata"),

    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    stateIdx: index("idx_state_history_state").on(table.state_id),
  })
);

// Pipeline runs — one row per pipeline execution
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    pipeline_id: uuid("pipeline_id").primaryKey().notNull(),
    entry_point: text("entry_point").notNull(),
    current_step: text("current_step").notNull(),
    status: text("status").notNull(),
    // steps: full ordered history of step records (jsonb array)
    steps: jsonb("steps").notNull().$type<object[]>().default([]),
    // metadata: slack_channel, slack_user, slack_thread_ts, source, etc.
    metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
    // input provided at pipeline creation
    input: jsonb("input").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("idx_pipeline_runs_status").on(table.status),
    channelIdx: index("idx_pipeline_runs_channel").on(table.metadata),
  })
);