import Ajv, { ErrorObject, JSONSchemaType, ValidateFunction } from "ajv";
import {
	CoordinationCreateInput,
	CoordinationPatchInput,
	CoordinationQueryInput,
	ExecutionRequestEnvelope
} from "../domain/execution.types";
import { HttpError } from "../utils/http-error";

const ajv = new Ajv({ allErrors: true, strict: false });

type JsonRecord = Record<string, unknown>;

const executionRequestSchema: JSONSchemaType<ExecutionRequestEnvelope> = {
	type: "object",
	additionalProperties: false,
	required: ["target", "input"],
	properties: {
		request_id: { type: "string", nullable: true },
		correlation_id: { type: "string", nullable: true },
		target: {
			type: "object",
			additionalProperties: false,
			required: ["type", "name", "version"],
			properties: {
				type: { type: "string", enum: ["script", "role"] },
				name: { type: "string", minLength: 1 },
				version: { type: "string", minLength: 1 }
			}
		},
		input: {
			type: "object",
			additionalProperties: true,
			required: []
		},
		metadata: {
			type: "object",
			additionalProperties: true,
			required: [],
			nullable: true
		}
	}
};

const coordinationCreateSchema: JSONSchemaType<CoordinationCreateInput> = {
	type: "object",
	additionalProperties: false,
	required: ["kind", "scope", "data"],
	properties: {
		coordination_id: { type: "string", nullable: true },
		kind: { type: "string", enum: ["workflow", "agent", "session"] },
		scope: { type: "string", minLength: 1 },
		data: { type: "object", additionalProperties: true, required: [] },
		metadata: {
			type: "object",
			additionalProperties: true,
			required: [],
			nullable: true
		},
		expires_at: { type: "string", nullable: true }
	}
};

const coordinationPatchSchema: JSONSchemaType<CoordinationPatchInput> = {
	type: "object",
	additionalProperties: false,
	required: [],
	properties: {
		data: {
			type: "object",
			additionalProperties: true,
			required: [],
			nullable: true
		},
		metadata: {
			type: "object",
			additionalProperties: true,
			required: [],
			nullable: true
		},
		expires_at: { type: "string", nullable: true },
		status: { type: "string", enum: ["active", "archived"], nullable: true }
	}
};

const coordinationQuerySchema: JSONSchemaType<CoordinationQueryInput> = {
	type: "object",
	additionalProperties: false,
	required: [],
	properties: {
		kind: { type: "string", enum: ["workflow", "agent", "session"], nullable: true },
		scope: { type: "string", nullable: true },
		status: { type: "string", enum: ["active", "archived"], nullable: true },
		limit: { type: "number", nullable: true }
	}
};

function formatAjvErrors(errors: ErrorObject[] | null | undefined): JsonRecord {
	return {
		validation_errors:
			errors?.map((error) => ({
				instance_path: error.instancePath,
				message: error.message,
				keyword: error.keyword,
				params: error.params
			})) ?? []
	};
}

export class ValidationService {
	private readonly validateExecutionRequest: ValidateFunction<ExecutionRequestEnvelope>;
	private readonly validateCoordinationCreate: ValidateFunction<CoordinationCreateInput>;
	private readonly validateCoordinationPatch: ValidateFunction<CoordinationPatchInput>;
	private readonly validateCoordinationQuery: ValidateFunction<CoordinationQueryInput>;

	constructor() {
		this.validateExecutionRequest = ajv.compile(executionRequestSchema);
		this.validateCoordinationCreate = ajv.compile(coordinationCreateSchema);
		this.validateCoordinationPatch = ajv.compile(coordinationPatchSchema);
		this.validateCoordinationQuery = ajv.compile(coordinationQuerySchema);
	}

	validateExecutionRequestBody(payload: unknown): ExecutionRequestEnvelope {
		if (!this.validateExecutionRequest(payload)) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				"Execution request payload is invalid.",
				formatAjvErrors(this.validateExecutionRequest.errors)
			);
		}

		if (payload.target.version === "latest" || payload.target.version === "stable") {
			throw new HttpError(
				400,
				"VERSION_RESOLUTION_ERROR",
				"Floating aliases are not allowed. Provide an explicit immutable version."
			);
		}

		return {
			...payload,
			metadata: payload.metadata ?? {}
		};
	}

	validateScriptOutput(outputSchema: Record<string, unknown> | undefined, output: unknown): void {
		if (!outputSchema) {
			return;
		}

		const validate = ajv.compile(outputSchema);
		if (!validate(output)) {
			throw new HttpError(
				500,
				"VALIDATION_ERROR",
				"Script output failed schema validation.",
				formatAjvErrors(validate.errors)
			);
		}
	}

	validateCoordinationCreateBody(payload: unknown): CoordinationCreateInput {
		if (!this.validateCoordinationCreate(payload)) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				"Coordination create payload is invalid.",
				formatAjvErrors(this.validateCoordinationCreate.errors)
			);
		}
		return payload;
	}

	validateCoordinationPatchBody(payload: unknown): CoordinationPatchInput {
		if (!this.validateCoordinationPatch(payload)) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				"Coordination patch payload is invalid.",
				formatAjvErrors(this.validateCoordinationPatch.errors)
			);
		}
		return payload;
	}

	validateCoordinationQueryBody(payload: unknown): CoordinationQueryInput {
		if (!this.validateCoordinationQuery(payload)) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				"Coordination query payload is invalid.",
				formatAjvErrors(this.validateCoordinationQuery.errors)
			);
		}
		return payload;
	}
}

export const validationService = new ValidationService();
