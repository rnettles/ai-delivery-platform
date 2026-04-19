export type TargetType = "script" | "role";

export interface ExecutionTarget {
	type: TargetType;
	name: string;
	version: string;
}

export interface ExecutionRequestEnvelope {
	request_id?: string;
	correlation_id?: string;
	target: ExecutionTarget;
	input: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ExecutionError {
	code: string;
	message: string;
	details?: unknown;
}

export type ExecutionStatus = "completed" | "failed";

export interface ExecutionResponseEnvelope {
	ok: boolean;
	execution_id: string;
	request_id?: string;
	correlation_id?: string;
	target: ExecutionTarget;
	artifacts: string[];
	output?: unknown;
	errors: ExecutionError[];
}

export interface GitSyncContext {
	repo_path: string;
	head_commit?: string;
	is_repo_accessible: boolean;
}

export interface ExecutionRecord extends ExecutionResponseEnvelope {
	status: ExecutionStatus;
	started_at: string;
	completed_at: string;
	duration_ms: number;
	input: Record<string, unknown>;
	metadata: Record<string, unknown>;
	replay_of_execution_id?: string;
	git_sync: GitSyncContext;
}

export interface ExecutionQuery {
	correlation_id?: string;
	target_name?: string;
	status?: ExecutionStatus;
	limit?: number;
}

export interface ScriptDiscovery {
	type: "script";
	name: string;
	version: string;
	description: string;
	input_schema?: Record<string, unknown>;
	output_schema?: Record<string, unknown>;
	tags: string[];
}

export interface RoleDiscovery {
	type: "role";
	name: string;
	version: string;
	script: {
		name: string;
		version: string;
	};
}

export interface ScriptsDiscoveryResponse {
	scripts: ScriptDiscovery[];
	roles: RoleDiscovery[];
}

export interface CoordinationEntry {
	coordination_id: string;
	kind: "workflow" | "agent" | "session";
	scope: string;
	data: Record<string, unknown>;
	metadata: Record<string, unknown>;
	status: "active" | "archived";
	expires_at?: string;
	created_at: string;
	updated_at: string;
}

export interface CoordinationCreateInput {
	coordination_id?: string;
	kind: CoordinationEntry["kind"];
	scope: string;
	data: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	expires_at?: string;
}

export interface CoordinationPatchInput {
	data?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	expires_at?: string;
	status?: CoordinationEntry["status"];
}

export interface CoordinationQueryInput {
	kind?: CoordinationEntry["kind"];
	scope?: string;
	status?: CoordinationEntry["status"];
	limit?: number;
}
