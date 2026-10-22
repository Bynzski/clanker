/** Only verified interactive argv get client-local selection authority. Unknown flags,
 * positional/subcommands and noninteractive requests retain server-only observation. */
export function isOpenCodeTuiInvocation(args: readonly string[]): boolean {
  const values = new Set(['--session', '-s', '--prompt', '--log-level']);
  const switches = new Set(['--standalone', '--auto', '--continue', '-c', '--print-logs']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (switches.has(arg)) continue;
    if (values.has(arg)) {
      if (!args[++index] || args[index].startsWith('-')) return false;
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals > 0 && values.has(arg.slice(0, equals)) && arg.slice(equals + 1)) continue;
    return false;
  }
  return true;
}

/** Launch-scoped hooks and MCP credentials must run in this process's private 2.x server,
 * never a pre-existing service. Do not override an explicitly selected external server or an
 * alternate boolean spelling whose intent would conflict with the flag we add. */
export function openCodePrivateServerArgs(args: readonly string[]): string[] | null {
  if (args.some(arg => arg === '--server' || arg.startsWith('--server=') || arg.startsWith('--standalone='))) return null;
  return args.includes('--standalone') ? [...args] : ['--standalone', ...args];
}
