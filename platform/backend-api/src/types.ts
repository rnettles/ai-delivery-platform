export {
  CoordinationCreateInput,
  CoordinationEntry,
  CoordinationPatchInput,
  CoordinationQueryInput,
  ExecutionError,
  ExecutionQuery,
  ExecutionRecord,
  ExecutionRequestEnvelope,
  ExecutionResponseEnvelope,
  ExecutionStatus,
  ExecutionTarget,
  GitSyncContext,
  RoleDiscovery,
  ScriptDiscovery,
  ScriptsDiscoveryResponse,
  TargetType
} from "./domain/execution.types";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}
