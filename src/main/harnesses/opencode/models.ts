import type { ModelOption } from '../types';
import { runCommandOutput } from '../modelCommand';
import { requireModelOutput, type HarnessCommandExecutor } from '../commandExecution';
import { normalizeModelLine } from '../modelParsing';

export function parseOpenCodeModels(output: string): ModelOption[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => normalizeModelLine(line))
    .filter((line) => /^[-A-Za-z0-9_./:]+$/.test(line));

  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const line of lines) {
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    models.push({ id: line, label: line });
  }

  return models;
}


export async function discoverModels(): Promise<ModelOption[]> {
  const models = parseOpenCodeModels(await runCommandOutput('opencode', ['models'], 6000));
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}

export async function discoverModelsIn(executor: HarnessCommandExecutor): Promise<ModelOption[]> {
  const output = requireModelOutput(await executor.run({ command: 'opencode', args: ['models'], timeoutMs: 6000 }), 'opencode models');
  return parseOpenCodeModels(output).filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}
