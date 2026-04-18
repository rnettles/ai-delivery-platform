import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index
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