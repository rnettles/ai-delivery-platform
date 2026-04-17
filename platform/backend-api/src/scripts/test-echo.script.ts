import { Script } from "./script.interface";

export class TestEchoScript implements Script<Record<string, unknown>, unknown> {
  public readonly name = "test.echo";

  async run(input: Record<string, unknown>): Promise<unknown> {
    return {
      echoed: true,
      received: input
    };
  }
}
