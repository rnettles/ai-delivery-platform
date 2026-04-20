import { ExecutionRequestEnvelope, ExecutionTarget } from "../domain/execution.types";
import { ScriptExecutionContext } from "../scripts/script.interface";
import { scriptRegistry } from "./script-registry.service";
import { validationService } from "./validation.service";

export interface ScriptRunnerResult {
	output: unknown;
	resolvedTarget: ExecutionTarget;
}

class ScriptRunnerService {
	async run(payload: ExecutionRequestEnvelope, context: ScriptExecutionContext): Promise<ScriptRunnerResult> {
		const { script, resolvedTarget } = scriptRegistry.resolveTarget(payload.target);

		const output = await script.run(payload.input, context);
		validationService.validateScriptOutput(script.descriptor.output_schema, output);

		return { output, resolvedTarget };
	}
}

export const scriptRunnerService = new ScriptRunnerService();
