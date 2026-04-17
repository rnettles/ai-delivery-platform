export interface ExecutionRequest {
  execution_id?: string;
  script: string;
  input: Record<string, unknown>;
  metadata?: {
    source?: string;
    correlation_id?: string;
    [key: string]: unknown;
  };
}

export interface ExecutionResult {
  execution_id: string;
  status: "completed" | "failed";
  script: string;
  started_at: string;
  completed_at: string;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}
