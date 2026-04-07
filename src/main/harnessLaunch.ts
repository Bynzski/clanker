export interface HarnessConfig {
  command: string;
  args: string[];
  name: string;
  icon: string;
  env?: Record<string, string>;
  modelArg?: string;
}

export function buildHarnessSpawnArgs(config: HarnessConfig, model?: string): string[] {
  const args = [...config.args];

  if (model) {
    const modelArg = config.modelArg ?? '--model';
    args.unshift(model);
    args.unshift(modelArg);
  }

  return args;
}

export function normalizePiModelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}
