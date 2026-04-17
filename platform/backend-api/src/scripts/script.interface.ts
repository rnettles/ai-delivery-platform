export interface Script<TInput = Record<string, unknown>, TOutput = unknown> {
  name: string;
  run(input: TInput): Promise<TOutput>;
}
