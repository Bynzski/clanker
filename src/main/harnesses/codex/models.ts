import { HarnessCapabilityError, type ModelOption } from '../types';
import { runCommandOutput } from '../modelCommand';
import { requireModelOutput, type HarnessCommandExecutor } from '../commandExecution';

function parseCatalog(output: string): ModelOption[] {
  try {
    const data = JSON.parse(output) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string }>;
    };
    return (data.models ?? [])
      .filter((m) => m.visibility === 'list' && m.slug)
      .map((m) => ({ id: m.slug!, label: m.display_name || m.slug! }));
  } catch (error) {
    throw new HarnessCapabilityError('parse-failure', 'Malformed Codex model catalog', error);
  }
}


/** Legacy parser surface intentionally keeps the historical empty fallback. */
export function parseCodexDebugModels(output: string): ModelOption[] {
  try { return parseCatalog(output); } catch { return []; }
}

export async function discoverModels(): Promise<ModelOption[]> {
  const models = parseCatalog(await runCommandOutput('codex', ['debug', 'models'], 8000));
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}

export async function discoverModelsIn(executor: HarnessCommandExecutor): Promise<ModelOption[]> {
  const output = requireModelOutput(await executor.run({ command: 'codex', args: ['debug', 'models'], timeoutMs: 8000 }), 'codex debug models');
  return parseCatalog(output).filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}
