/** Launch-scoped hooks and MCP credentials must run in this process's private 2.x server,
 * never a pre-existing service. Do not override an explicitly selected external server or an
 * alternate boolean spelling whose intent would conflict with the flag we add. */
export function openCodePrivateServerArgs(args: readonly string[]): string[] | null {
  if (args.some(arg => arg === '--server' || arg.startsWith('--server=') || arg.startsWith('--standalone='))) return null;
  return args.includes('--standalone') ? [...args] : ['--standalone', ...args];
}
