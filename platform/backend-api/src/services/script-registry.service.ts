import { Script } from "../scripts/script.interface";
import { TestEchoScript } from "../scripts/test-echo.script";
import { PlannerScript } from "../scripts/role-planner.script";
import { SprintControllerScript } from "../scripts/role-sprint-controller.script";
import { ImplementerScript } from "../scripts/role-implementer.script";
import { VerifierScript } from "../scripts/role-verifier.script";
import { ExecutionTarget, RoleDiscovery, ScriptDiscovery, ScriptsDiscoveryResponse } from "../domain/execution.types";
import { HttpError } from "../utils/http-error";

interface RoleBinding {
  roleName: string;
  version: string;
  scriptName: string;
  scriptVersion: string;
}

export class ScriptRegistryService {
  private readonly scripts = new Map<string, Script>();
  private readonly roleBindings = new Map<string, RoleBinding>();

  constructor() {
    this.register(new TestEchoScript());
    this.register(new PlannerScript());
    this.register(new SprintControllerScript());
    this.register(new ImplementerScript());
    this.register(new VerifierScript());

    // Legacy test binding kept for backward compat
    this.registerRoleBinding("planner", "2026.04.18", "test.echo", "2026.04.18");

    // Production role bindings — version 2026.04.19
    this.registerRoleBinding("planner", "2026.04.19", "role.planner", "2026.04.19");
    this.registerRoleBinding("sprint-controller", "2026.04.19", "role.sprint-controller", "2026.04.19");
    this.registerRoleBinding("implementer", "2026.04.19", "role.implementer", "2026.04.19");
    this.registerRoleBinding("verifier", "2026.04.19", "role.verifier", "2026.04.19");
  }

  register(script: Script): void {
    this.scripts.set(this.key(script.descriptor.name, script.descriptor.version), script);
  }

  registerRoleBinding(roleName: string, version: string, scriptName: string, scriptVersion: string): void {
    this.roleBindings.set(this.key(roleName, version), {
      roleName,
      version,
      scriptName,
      scriptVersion
    });
  }

  resolveTarget(target: ExecutionTarget): { script: Script; resolvedTarget: ExecutionTarget } {
    if (target.type === "script") {
      const script = this.scripts.get(this.key(target.name, target.version));
      if (!script) {
        throw new HttpError(404, "SCRIPT_NOT_FOUND", `Script not found: ${target.name}@${target.version}`);
      }
      return {
        script,
        resolvedTarget: target
      };
    }

    const binding = this.roleBindings.get(this.key(target.name, target.version));
    if (!binding) {
      throw new HttpError(404, "SCRIPT_NOT_FOUND", `Role target not found: ${target.name}@${target.version}`);
    }

    const script = this.scripts.get(this.key(binding.scriptName, binding.scriptVersion));
    if (!script) {
      throw new HttpError(
        500,
        "SCRIPT_NOT_FOUND",
        `Role ${target.name}@${target.version} resolves to unknown script ${binding.scriptName}@${binding.scriptVersion}`
      );
    }

    return {
      script,
      resolvedTarget: {
        type: "script",
        name: binding.scriptName,
        version: binding.scriptVersion
      }
    };
  }

  list(): ScriptsDiscoveryResponse {
    const scripts: ScriptDiscovery[] = Array.from(this.scripts.values())
      .map((script) => ({
        type: "script" as const,
        name: script.descriptor.name,
        version: script.descriptor.version,
        description: script.descriptor.description,
        input_schema: script.descriptor.input_schema,
        output_schema: script.descriptor.output_schema,
        tags: script.descriptor.tags ?? []
      }))
      .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

    const roles: RoleDiscovery[] = Array.from(this.roleBindings.values())
      .map((binding) => ({
        type: "role" as const,
        name: binding.roleName,
        version: binding.version,
        script: {
          name: binding.scriptName,
          version: binding.scriptVersion
        }
      }))
      .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

    return { scripts, roles };
  }

  private key(name: string, version: string): string {
    return `${name}@${version}`;
  }
}

export const scriptRegistry = new ScriptRegistryService();
