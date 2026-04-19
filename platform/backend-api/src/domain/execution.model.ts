import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { executionRecords } from "../db/schema";
import { ExecutionError, ExecutionQuery, ExecutionRecord, ExecutionStatus, GitSyncContext, TargetType } from "./execution.types";

type ExecutionRow = typeof executionRecords.$inferSelect;

function rowToRecord(row: ExecutionRow): ExecutionRecord {
	return {
		ok: row.ok,
		execution_id: row.execution_id,
		request_id: row.request_id ?? undefined,
		correlation_id: row.correlation_id ?? undefined,
		target: {
			type: row.target_type as TargetType,
			name: row.target_name,
			version: row.target_version,
		},
		artifacts: (row.artifacts as string[]) ?? [],
		output: row.output ?? undefined,
		errors: (row.errors as ExecutionError[]) ?? [],
		status: row.status as ExecutionStatus,
		started_at: row.started_at.toISOString(),
		completed_at: row.completed_at.toISOString(),
		duration_ms: row.duration_ms,
		input: (row.input as Record<string, unknown>) ?? {},
		metadata: (row.metadata as Record<string, unknown>) ?? {},
		replay_of_execution_id: row.replay_of_execution_id ?? undefined,
		git_sync: (row.git_sync as GitSyncContext) ?? { repo_path: "", is_repo_accessible: false },
	};
}

function recordToRow(record: ExecutionRecord) {
	return {
		execution_id: record.execution_id,
		ok: record.ok,
		request_id: record.request_id ?? null,
		correlation_id: record.correlation_id ?? null,
		target_type: record.target.type,
		target_name: record.target.name,
		target_version: record.target.version,
		artifacts: record.artifacts,
		output: record.output ?? null,
		errors: record.errors,
		status: record.status,
		started_at: new Date(record.started_at),
		completed_at: new Date(record.completed_at),
		duration_ms: record.duration_ms,
		input: record.input,
		metadata: record.metadata,
		replay_of_execution_id: record.replay_of_execution_id ?? null,
		git_sync: record.git_sync as object,
	};
}

export class ExecutionRecordModel {
	async save(record: ExecutionRecord): Promise<ExecutionRecord> {
		await db.insert(executionRecords).values(recordToRow(record));
		return record;
	}

	async getById(executionId: string): Promise<ExecutionRecord | undefined> {
		const rows = await db
			.select()
			.from(executionRecords)
			.where(eq(executionRecords.execution_id, executionId))
			.limit(1);
		return rows[0] ? rowToRecord(rows[0]) : undefined;
	}

	async query(filters: ExecutionQuery): Promise<ExecutionRecord[]> {
		const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));

		const conditions = [];
		if (filters.correlation_id) conditions.push(eq(executionRecords.correlation_id, filters.correlation_id));
		if (filters.target_name) conditions.push(eq(executionRecords.target_name, filters.target_name));
		if (filters.status) conditions.push(eq(executionRecords.status, filters.status));

		const rows = await db
			.select()
			.from(executionRecords)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(executionRecords.started_at))
			.limit(limit);

		return rows.map(rowToRecord);
	}
}

export const executionRecordModel = new ExecutionRecordModel();
