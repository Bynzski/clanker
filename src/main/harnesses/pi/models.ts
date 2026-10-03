import type { ModelOption } from '../types';
import { runCommandOutput } from '../modelCommand';
import { requireModelOutput, type HarnessCommandExecutor } from '../commandExecution';
import { normalizeModelLine } from '../modelParsing';

export function parsePiModels(output: string): ModelOption[] {
  if (/no models available/i.test(output)) {
    return [];
  }

  const lines = output
    .split(/\r?\n/)
    .map((line) => normalizeModelLine(line))
    .filter(Boolean);

  const models: ModelOption[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (/^(warning:|provider\s+model|─|─+|-+|=+|pi\s+-\s+ai coding assistant)/i.test(line)) {
      continue;
    }

    const cols = line.split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
    if (cols.length < 2) {
      continue;
    }

    const provider = cols[0];
    const model = cols[1];
    if (!model || seen.has(model)) {
      continue;
    }

    seen.add(model);
    models.push({
      id: `${provider}/${model}`,
      label: `${provider}/${model}`,
    });
  }

  return models;
}


export async function discoverModels(): Promise<ModelOption[]> {
  const models = parsePiModels(await runCommandOutput('pi', ['--list-models'], 6000));
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}

export async function discoverModelsIn(executor: HarnessCommandExecutor): Promise<ModelOption[]> {
  const output = requireModelOutput(await executor.run({ command: 'pi', args: ['--list-models'], timeoutMs: 6000 }), 'pi --list-models');
  return parsePiModels(output).filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}
