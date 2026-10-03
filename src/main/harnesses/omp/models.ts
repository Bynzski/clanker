import type { ModelOption } from '../types';
import { runCommandOutput } from '../modelCommand';
import { requireModelOutput, type HarnessCommandExecutor } from '../commandExecution';
import { HarnessCapabilityError } from '../types';

function parseOmpModelCatalog(output: string): ModelOption[] | null {
  try {
    const data: unknown = JSON.parse(output);
    if (!data || typeof data !== 'object' || !('models' in data) || !Array.isArray(data.models)) return null;
    const seen = new Set<string>();
    const models: ModelOption[] = [];
    for (const entry of data.models) {
      if (!entry || typeof entry !== 'object' || entry.kind !== 'chat'
        || typeof entry.selector !== 'string' || !entry.selector || seen.has(entry.selector)) continue;
      seen.add(entry.selector);
      models.push({ id: entry.selector, label: entry.selector });
    }
    return models;
  } catch {
    return null;
  }
}

/** OMP's JSON catalog uses selector as the exact --model value. */
export function parseOmpModels(output: string): ModelOption[] {
  return parseOmpModelCatalog(output) ?? [];
}


export async function discoverModels(): Promise<ModelOption[]> {
  const models = parseOmpModelCatalog(await runCommandOutput('omp', ['models', '--json'], 8000));
  if (!models) throw new HarnessCapabilityError('parse-failure', 'Malformed OMP model catalog');
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}

export async function discoverModelsIn(executor: HarnessCommandExecutor): Promise<ModelOption[]> {
  const models = parseOmpModelCatalog(requireModelOutput(await executor.run({ command: 'omp', args: ['models', '--json'], timeoutMs: 8000 }), 'omp models'));
  if (!models) throw new HarnessCapabilityError('parse-failure', 'Malformed OMP model catalog');
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}
