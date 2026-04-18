# ADR-006: Adopt Drizzle ORM for Schema Management and Migrations

## Status

Accepted

---

## Context

The system introduces a shared state layer backed by PostgreSQL to support:

* Execution tracking
* Workflow / agent state
* Cross-system coordination between:

  * n8n workflows
  * Local development environments
  * API-driven execution services

The current architecture separates responsibilities across two repositories:

* **`devops`** (Terraform): infrastructure provisioning
* **`ai-project_template`**: application logic (Execution + State API)

A decision is required on:

* How to define and evolve the PostgreSQL schema
* Where schema ownership should reside
* How to manage schema changes safely across environments

---

## Problem

Without a structured schema management approach:

* Database schemas drift between environments
* Changes are not versioned or auditable
* Application code and schema become misaligned
* Rollbacks are difficult or impossible
* Agent-driven development introduces uncontrolled schema mutation risk

A migration-less approach (manual SQL or `CREATE IF NOT EXISTS`) is insufficient for a system intended to support:

* long-lived state
* agent workflows
* reproducibility
* auditability

---

## Decision

Adopt **Drizzle ORM + Drizzle Kit** as the standard for:

* Schema definition
* Migration generation
* Schema evolution

---

## Key Principles

---

### 1. Schema is Application-Owned

* Schema definitions reside in:

  ```
  ai-project_template
  ```
* Defined as TypeScript via Drizzle
* Versioned alongside application code

---

### 2. Infrastructure is Terraform-Owned

* PostgreSQL server, database, and networking are defined in:

  ```
  devops
  ```
* Terraform **does NOT manage tables or schema**

---

### 3. Migrations are Required

* All schema changes must be:

  * generated via Drizzle
  * committed to source control
  * applied via controlled deployment

---

### 4. Single Source of Truth

Schema definition is declared in:

```text id="0o6x0j"
src/db/schema.ts
```

This file defines:

* tables
* columns
* indexes
* relationships

---

## Implementation

---

### Directory Structure

```text id="a1w8mb"
ai-project_template/
  platform/backend-api/
    src/
      db/
        schema.ts
        client.ts
    drizzle/
      0000_initial.sql
      0001_add_fields.sql
    drizzle.config.ts
```

---

### Schema Definition (Example)

```ts id="a4k4s6"
import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const state = pgTable("state", {
  state_id: uuid("state_id").primaryKey(),
  type: text("type"),
  scope: text("scope"),
  data: jsonb("data"),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at"),
  updated_at: timestamp("updated_at")
});
```

---

### Migration Workflow

1. Update schema:

```ts id="5eqy6m"
schema.ts
```

2. Generate migration:

```bash id="r66tzl"
npx drizzle-kit generate
```

3. Commit migration:

```text id="r6p8tx"
drizzle/000X_*.sql
```

4. Apply migration:

```bash id="x6ec2z"
npx drizzle-kit push
```

---

### Database Connection

Configured via environment variable:

```text id="0qz87y"
DATABASE_URL
```

Set by Terraform in the execution service container.

---

## Responsibilities

| Concern             | Owner                               |
| ------------------- | ----------------------------------- |
| Postgres server     | Terraform (`devops`)                |
| Database instance   | Terraform                           |
| Schema definition   | Application (`ai-project_template`) |
| Schema evolution    | Drizzle migrations                  |
| Migration execution | CI/CD or deployment step            |

---

## Consequences

---

### Positive

#### ✅ Strong Schema Governance

* Versioned and reproducible schema changes

#### ✅ Alignment with Application Logic

* Schema evolves with API code

#### ✅ Safe Deployments

* Controlled migration application
* rollback capability

#### ✅ Agent-Safe Evolution

* Prevents uncontrolled schema mutation

#### ✅ Developer Productivity

* Type-safe schema definitions
* minimal boilerplate

---

### Negative

#### ⚠️ Additional Tooling

* Requires Drizzle setup and learning curve

#### ⚠️ Migration Discipline Required

* Developers must follow workflow

---

### Risks

* Improper migration practices could still cause drift
* Direct manual DB changes can bypass system if not controlled
* Requires CI/CD integration for best results

---

## Alternatives Considered

---

### 1. Terraform-Managed Schema

**Rejected**

* Not designed for iterative schema evolution
* Poor developer experience
* No application-level versioning

---

### 2. Manual SQL / No Migrations

**Rejected**

* No version control
* High risk of drift
* No rollback capability

---

### 3. Other ORMs (Prisma, TypeORM)

**Not Selected**

* Heavier abstraction layers
* Less control over SQL
* Drizzle better aligns with:

  * lightweight architecture
  * explicit schema control
  * TypeScript-first approach

---

## Future Considerations

---

### 1. Schema Versioning Enhancements

* Add `version` column to state
* introduce historical tables for snapshots

---

### 2. Migration Automation

* integrate migration execution into CI/CD pipeline
* enforce migration checks before deployment

---

### 3. Multi-Service Schema Sharing

* shared schema package if multiple services depend on state

---

### 4. CKS Integration

* schema evolution may expand to support knowledge graph structures

---

## Summary

This decision establishes:

```text id="2ghg2q"
Terraform → infrastructure lifecycle
Drizzle   → schema lifecycle
```

This separation ensures:

* clean architecture boundaries
* reproducible deployments
* safe schema evolution
* support for agent-driven workflows

---

## Decision Outcome

Adopt Drizzle ORM as the **standard schema management and migration solution**, with schema owned by the application and infrastructure managed by Terraform.

---
