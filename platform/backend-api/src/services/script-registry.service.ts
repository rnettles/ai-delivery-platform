import { Script } from "../scripts/script.interface";
import { TestEchoScript } from "../scripts/test-echo.script";

export class ScriptRegistryService {
  private readonly scripts = new Map<string, Script>();

  constructor() {
    this.register(new TestEchoScript());
  }

  register(script: Script): void {
    this.scripts.set(script.name, script);
  }

  get(scriptName: string): Script | undefined {
    return this.scripts.get(scriptName);
  }

  list(): string[] {
    return Array.from(this.scripts.keys()).sort();
  }
}

export const scriptRegistry = new ScriptRegistryService();
