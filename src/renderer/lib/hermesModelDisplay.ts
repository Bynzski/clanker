import type { ModelOption } from '../types/shared';

/** Format provider-backed IDs even when the cached catalog still has provider-first labels. */
export function hermesModelDisplay(option: ModelOption): { model: string; provider: string } {
  const match = /^hermes-provider:([^:]+):(.+)$/.exec(option.id);
  if (!match) return { model: option.label, provider: '' };

  let model: string;
  let providerSlug: string;
  try {
    providerSlug = decodeURIComponent(match[1]);
    model = decodeURIComponent(match[2]);
  } catch {
    return { model: option.label, provider: '' };
  }

  const separator = ' · ';
  const provider = option.label.endsWith(`${separator}${model}`)
    ? option.label.slice(0, -(`${separator}${model}`).length)
    : option.label.startsWith(`${model}${separator}`)
      ? option.label.slice((`${model}${separator}`).length)
      : providerSlug;
  return { model, provider };
}

export function hermesModelLabel(option: ModelOption): string {
  const { model, provider } = hermesModelDisplay(option);
  return provider ? `${model} · ${provider}` : model;
}
