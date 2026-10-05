/** Command-line forms Codex accepts for a config override: `-c k=v`, `-ck=v`, `--config k=v`, `--config=k=v`. */
export function codexConfigOverrides(args: readonly string[]): string[] {
  const overrides: string[] = [];
  args.forEach((arg, index) => {
    if ((arg === '-c' || arg === '--config') && index + 1 < args.length) overrides.push(args[index + 1]);
    else if (arg.startsWith('--config=')) overrides.push(arg.slice('--config='.length));
    else if (arg.startsWith('-c') && !arg.startsWith('--') && arg !== '-c') overrides.push(arg.slice(2));
  });
  return overrides;
}
