import type { ModelOption } from '../types';
import { runCommandOutput } from '../modelCommand';
import { normalizeModelLine } from '../modelParsing';
import { HarnessCapabilityError } from '../types';

export function parseAgyModels(output: string): ModelOption[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => normalizeModelLine(line))
    .filter(Boolean);

  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const line of lines) {
    if (/fetching available models/i.test(line)) continue;
    const parts = line.split(/\t+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const modelId = parts[0];
    if (!modelId || !/^[-A-Za-z0-9_./:]+$/.test(modelId) || seen.has(modelId)) continue;
    seen.add(modelId);
    const label = parts.length > 1 && parts[1] ? parts[1] : modelId;
    models.push({ id: modelId, label });
  }

  return models;
}


export async function discoverModels(): Promise<ModelOption[]> {
  const models = parseAgyModels(await runCommandOutput('agy', ['models'], 8000));
  if (!models.length) throw new HarnessCapabilityError('parse-failure', 'No models discovered for agy');
  return models.filter((model, index, entries) => index === entries.findIndex((entry) => entry.id === model.id));
}
