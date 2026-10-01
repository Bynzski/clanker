/** Provider-qualified IDs coexist with legacy manually entered model IDs. */
export function hermesModelArgs(model: string): string[] | undefined {
  const match = /^hermes-provider:([^:]+):([^:]+)$/.exec(model);
  if (!match) return undefined;
  try {
    const provider = decodeURIComponent(match[1]);
    const selectedModel = decodeURIComponent(match[2]);
    if (provider.trim() && selectedModel.trim()) return ['-m', selectedModel, '--provider', provider];
  } catch {
    // Preserve malformed/legacy text as a literal model option.
  }
  return undefined;
}
