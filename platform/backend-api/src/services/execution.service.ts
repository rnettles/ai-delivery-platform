import { randomUUID } from "crypto";
import { executionRecordModel } from "../domain/execution.model";
import { ExecutionQuery, ExecutionRecord, ExecutionRequestEnvelope, ExecutionResponseEnvelope } from "../domain/execution.types";
import { logger } from "./logger.service";
import { HttpError } from "../utils/http-error";
import { gitSyncService } from "./git-sync.service";
import { scriptRunnerService } from "./script-runner.service";

export class ExecutionService {
	async execute(
		payload: ExecutionRequestEnvelope,
		requestId?: string,
		replayOfExecutionId?: string
	): Promise<ExecutionResponseEnvelope> {
		const executionId = randomUUID();
		const startedAt = Date.now();
		const gitSync = gitSyncService.getContext();
		let resolvedTarget = payload.target;

		try {
			const runResult = await scriptRunnerService.run(payload, {
				execution_id: executionId,
				correlation_id: payload.correlation_id,
				request_id: requestId,
				metadata: payload.metadata ?? {},
				log: (message: string, context?: Record<string, unknown>) => {
					logger.info(message, {
						execution_id: executionId,
						script: `${resolvedTarget.name}@${resolvedTarget.version}`,
						...context
					});
				}
			});

			resolvedTarget = runResult.resolvedTarget;
			const output = runResult.output;

			const completedAt = Date.now();

			const response: ExecutionResponseEnvelope = {
				ok: true,
				execution_id: executionId,
				request_id: payload.request_id ?? requestId,
				correlation_id: payload.correlation_id,
				target: resolvedTarget,
				artifacts: [],
				output,
				errors: []
			};

			const record: ExecutionRecord = {
				...response,
				status: "completed",
				started_at: new Date(startedAt).toISOString(),
				completed_at: new Date(completedAt).toISOString(),
				duration_ms: completedAt - startedAt,
				input: payload.input,
				metadata: payload.metadata ?? {},
				replay_of_execution_id: replayOfExecutionId,
				git_sync: gitSync
			};

			await executionRecordModel.save(record);
			return response;
		} catch (error) {
			const completedAt = Date.now();
			const message = error instanceof Error ? error.message : String(error);
			const code = error instanceof HttpError ? error.code : "EXECUTION_ERROR";
			const details = error instanceof HttpError ? error.details : undefined;

			const record: ExecutionRecord = {
				ok: false,
				execution_id: executionId,
				request_id: payload.request_id ?? requestId,
				correlation_id: payload.correlation_id,
				target: resolvedTarget,
				artifacts: [],
				errors: [
					{
						code,
						message,
						details
					}
				],
				status: "failed",
				started_at: new Date(startedAt).toISOString(),
				completed_at: new Date(completedAt).toISOString(),
				duration_ms: completedAt - startedAt,
				input: payload.input,
				metadata: payload.metadata ?? {},
				replay_of_execution_id: replayOfExecutionId,
				git_sync: gitSync
			};

			await executionRecordModel.save(record);

			return {
				ok: false,
				execution_id: executionId,
				request_id: payload.request_id ?? requestId,
				correlation_id: payload.correlation_id,
				target: resolvedTarget,
				artifacts: [],
				errors: [
					{
						code,
						message,
						details
					}
				]
			};
		}
	}

	async getExecutionRecord(executionId: string): Promise<ExecutionRecord> {
		const record = await executionRecordModel.getById(executionId);
		if (!record) {
			throw new HttpError(404, "EXECUTION_NOT_FOUND", `Execution record not found: ${executionId}`);
		}
		return record;
	}

	async queryExecutions(query: ExecutionQuery): Promise<ExecutionRecord[]> {
		return executionRecordModel.query(query);
	}

	async replayExecution(executionId: string, requestId?: string): Promise<ExecutionResponseEnvelope> {
		const record = await this.getExecutionRecord(executionId);

		const replayRequest: ExecutionRequestEnvelope = {
			request_id: requestId,
			correlation_id: record.correlation_id,
			target: record.target,
			input: record.input,
			metadata: {
				...record.metadata,
				replay_of_execution_id: record.execution_id
			}
		};

		return this.execute(replayRequest, requestId, record.execution_id);
	}
}

export const executionService = new ExecutionService();
