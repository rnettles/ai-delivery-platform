export interface ScriptDescriptor {
  name: string;
  version: string;
  description: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  tags?: string[];
}

export interface ScriptExecutionContext {
  execution_id: string;
  correlation_id?: string;
  request_id?: string;
  metadata: Record<string, unknown>;
  log: (message: string, context?: Record<string, unknown>) => void;
  /** Send a lightweight progress message to the pipeline's Slack thread. Fire-and-forget — never throws. */
  notify: (message: string) => void;
}

export interface Script<TInput = Record<string, unknown>, TOutput = unknown> {
  descriptor: ScriptDescriptor;
  run(input: TInput, context: ScriptExecutionContext): Promise<TOutput>;
}
