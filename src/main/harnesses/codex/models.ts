import type { ModelOption } from '../types';
import { runCommandOutput } from '../modelCommand';

export function parseCodexDebugModels(output: string): ModelOption[] {
  try {
    const data = JSON.parse(output) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string }>;
    };
    return (data.models ?? [])
      .filter((m) => m.visibility === 'list' && m.slug)
      .map((m) => ({ id: m.slug!, label: m.display_name || m.slug! }));
  } catch {
    return [];
  }
}


export async function discoverModels(): Promise<ModelOption[]> {
  const models = parseCodexDebugModels(await runCommandOutput('codex', ['debug', 'models'], 8000));
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}
