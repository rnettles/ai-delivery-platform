import { randomUUID } from "crypto";
import { executionRecordModel } from "../domain/execution.model";
import { ExecutionQuery, ExecutionRecord, ExecutionRequestEnvelope, ExecutionResponseEnvelope } from "../domain/execution.types";
import { scriptRegistry } from "./script-registry.service";
import { validationService } from "./validation.service";
import { logger } from "./logger.service";
import { HttpError } from "../utils/http-error";
import { gitSyncService } from "./git-sync.service";

export class ExecutionService {
	async execute(
		payload: ExecutionRequestEnvelope,
		requestId?: string,
		replayOfExecutionId?: string
	): Promise<ExecutionResponseEnvelope> {
		const executionId = randomUUID();
		const startedAt = Date.now();
		const gitSync = gitSyncService.getContext();

		const { script, resolvedTarget } = scriptRegistry.resolveTarget(payload.target);

		try {
			const output = await script.run(payload.input, {
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

			validationService.validateScriptOutput(script.descriptor.output_schema, output);

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

			executionRecordModel.save(record);
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

			executionRecordModel.save(record);

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

	getExecutionRecord(executionId: string): ExecutionRecord {
		const record = executionRecordModel.getById(executionId);
		if (!record) {
			throw new HttpError(404, "EXECUTION_NOT_FOUND", `Execution record not found: ${executionId}`);
		}
		return record;
	}

	queryExecutions(query: ExecutionQuery): ExecutionRecord[] {
		return executionRecordModel.query(query);
	}

	async replayExecution(executionId: string, requestId?: string): Promise<ExecutionResponseEnvelope> {
		const record = this.getExecutionRecord(executionId);

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
