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

export function quoteShellArg(arg: string): string {
  if (arg.length === 0) {
    return "''";
  }

  if (/^[A-Za-z0-9_\/=:@%+.,-]+$/.test(arg)) {
    return arg;
  }

  if (process.platform === 'win32') {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }

  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function buildHarnessCommand(config: HarnessConfig, model?: string): string {
  const parts = [config.command];

  if (model) {
    parts.push(config.modelArg ?? '--model', model);
  }

  parts.push(...config.args);

  return parts.map((part, index) => (index === 0 ? part : quoteShellArg(part))).join(' ');
}
