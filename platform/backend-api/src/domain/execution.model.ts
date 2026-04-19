import { ExecutionQuery, ExecutionRecord } from "./execution.types";

export class ExecutionRecordModel {
	private readonly records = new Map<string, ExecutionRecord>();

	save(record: ExecutionRecord): ExecutionRecord {
		this.records.set(record.execution_id, record);
		return record;
	}

	getById(executionId: string): ExecutionRecord | undefined {
		return this.records.get(executionId);
	}

	query(filters: ExecutionQuery): ExecutionRecord[] {
		const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));

		return Array.from(this.records.values())
			.filter((record) => {
				if (filters.correlation_id && record.correlation_id !== filters.correlation_id) {
					return false;
				}
				if (filters.target_name && record.target.name !== filters.target_name) {
					return false;
				}
				if (filters.status && record.status !== filters.status) {
					return false;
				}
				return true;
			})
			.sort((a, b) => b.started_at.localeCompare(a.started_at))
			.slice(0, limit);
	}
}

export const executionRecordModel = new ExecutionRecordModel();
