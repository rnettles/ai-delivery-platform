import { randomUUID } from "crypto";
import {
  CoordinationCreateInput,
  CoordinationEntry,
  CoordinationPatchInput,
  CoordinationQueryInput
} from "../domain/execution.types";
import { HttpError } from "../utils/http-error";

export class CoordinationService {
  private readonly entries = new Map<string, CoordinationEntry>();

  create(input: CoordinationCreateInput): CoordinationEntry {
    const now = new Date().toISOString();
    const entry: CoordinationEntry = {
      coordination_id: input.coordination_id ?? randomUUID(),
      kind: input.kind,
      scope: input.scope,
      data: input.data,
      metadata: input.metadata ?? {},
      status: "active",
      expires_at: input.expires_at,
      created_at: now,
      updated_at: now
    };

    this.entries.set(entry.coordination_id, entry);
    return entry;
  }

  getById(coordinationId: string): CoordinationEntry {
    const entry = this.entries.get(coordinationId);
    if (!entry) {
      throw new HttpError(404, "COORDINATION_NOT_FOUND", `Coordination entry not found: ${coordinationId}`);
    }
    return entry;
  }

  patch(coordinationId: string, patch: CoordinationPatchInput): CoordinationEntry {
    const current = this.getById(coordinationId);
    const updated: CoordinationEntry = {
      ...current,
      data: patch.data ?? current.data,
      metadata: patch.metadata ?? current.metadata,
      expires_at: patch.expires_at ?? current.expires_at,
      status: patch.status ?? current.status,
      updated_at: new Date().toISOString()
    };
    this.entries.set(coordinationId, updated);
    return updated;
  }

  query(query: CoordinationQueryInput): CoordinationEntry[] {
    const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
    return Array.from(this.entries.values())
      .filter((entry) => {
        if (query.kind && entry.kind !== query.kind) {
          return false;
        }
        if (query.scope && entry.scope !== query.scope) {
          return false;
        }
        if (query.status && entry.status !== query.status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
  }

  archive(coordinationId: string): CoordinationEntry {
    return this.patch(coordinationId, { status: "archived" });
  }
}

export const coordinationService = new CoordinationService();
