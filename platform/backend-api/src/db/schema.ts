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

// Execution records — one row per governed script/role execution (ADR-019)
export const executionRecords = pgTable(
  "execution_records",
  {
    execution_id: uuid("execution_id").primaryKey().notNull(),
    ok: boolean("ok").notNull(),
    request_id: text("request_id"),
    correlation_id: text("correlation_id"),
    // Flattened target fields for indexed querying
    target_type: text("target_type").notNull(),
    target_name: text("target_name").notNull(),
    target_version: text("target_version").notNull(),
    // Execution payload
    artifacts: jsonb("artifacts").notNull().$type<string[]>().default([]),
    output: jsonb("output").$type<unknown>(),
    errors: jsonb("errors").notNull().$type<object[]>().default([]),
    // Status and timing
    status: text("status").notNull(),
    started_at: timestamp("started_at").notNull(),
    completed_at: timestamp("completed_at").notNull(),
    duration_ms: integer("duration_ms").notNull(),
    // Input / metadata
    input: jsonb("input").notNull().$type<Record<string, unknown>>().default({}),
    metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
    // Replay linkage and git context
    replay_of_execution_id: text("replay_of_execution_id"),
    git_sync: jsonb("git_sync").notNull().$type<object>().default({}),
  },
  (table) => ({
    correlationIdx: index("idx_execution_records_correlation").on(table.correlation_id),
    targetNameIdx: index("idx_execution_records_target_name").on(table.target_name),
    statusIdx: index("idx_execution_records_status").on(table.status),
    startedAtIdx: index("idx_execution_records_started_at").on(table.started_at),
  })
);

// Projects — one row per managed codebase (ADR-027)
export const projects = pgTable(
  "projects",
  {
    project_id: uuid("project_id").primaryKey().notNull(),
    name: text("name").notNull().unique(),
    repo_url: text("repo_url").notNull(),
    default_branch: text("default_branch").notNull().default("main"),
    clone_path: text("clone_path").notNull(), // e.g. /mnt/repo/{name}/
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("idx_projects_name").on(table.name),
  })
);

// Project channel mappings — associates a Slack channel with a project (ADR-027)
export const projectChannels = pgTable(
  "project_channels",
  {
    channel_id: text("channel_id").primaryKey().notNull(), // Slack channel ID (1:1 with project)
    project_id: uuid("project_id").notNull().references(() => projects.project_id),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index("idx_project_channels_project").on(table.project_id),
  })
);

// Pipeline runs — one row per pipeline execution
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    pipeline_id: text("pipeline_id").primaryKey().notNull(),
    entry_point: text("entry_point").notNull(),
    current_step: text("current_step").notNull(),
    status: text("status").notNull(), // includes: awaiting_pr_review
    // project linkage (ADR-027) — null for legacy/default-project runs
    project_id: uuid("project_id").references(() => projects.project_id),
    // sprint branch created by Sprint Controller (ADR-030)
    sprint_branch: text("sprint_branch"),
    // GitHub PR tracking (ADR-030)
    pr_number: integer("pr_number"),
    pr_url: text("pr_url"),
    // implementer retry count (ADR-030) — max 3 attempts
    implementer_attempts: integer("implementer_attempts").notNull().default(0),
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
    projectIdx: index("idx_pipeline_runs_project").on(table.project_id),
  })
);