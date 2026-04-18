import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index
} from "drizzle-orm/pg-core";

export const state = pgTable(
  "state",
  {
    state_id: uuid("state_id").primaryKey().notNull(),

    type: text("type").notNull(),
    scope: text("scope").notNull(),

    data: jsonb("data").notNull(),
    metadata: jsonb("metadata"),

    created_at: timestamp("created_at").notNull(),
    updated_at: timestamp("updated_at").notNull(),
  },
  (table) => ({
    scopeIdx: index("idx_state_scope").on(table.scope),
  })
);