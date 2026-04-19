import { Script, ScriptExecutionContext } from "./script.interface";

export class TestEchoScript implements Script<Record<string, unknown>, unknown> {
  public readonly descriptor = {
    name: "test.echo",
    version: "2026.04.18",
    description: "Echoes structured input and execution context for contract testing.",
    input_schema: {
      type: "object",
      additionalProperties: true
    },
    output_schema: {
      type: "object",
      required: ["echoed", "received", "execution"],
      additionalProperties: true
    },
    tags: ["test", "diagnostic"]
  };

  async run(input: Record<string, unknown>, context: ScriptExecutionContext): Promise<unknown> {
    context.log("Running test.echo", {
      has_input: Object.keys(input).length > 0
    });

    return {
      echoed: true,
      received: input,
      execution: {
        execution_id: context.execution_id,
        correlation_id: context.correlation_id
      }
    };
  }
}
