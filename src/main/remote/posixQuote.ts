/**
 * POSIX Shell Quoting Utilities
 *
 * Provides safe escaping for remote command execution over SSH.
 * Prevents arbitrary renderer or user input from becoming unescaped shell fragments.
 */

/**
 * Escapes a single string argument for POSIX shells (sh, bash, zsh, dash).
 * Encloses the argument in single quotes and escapes embedded single quotes as '\''.
 * In POSIX shells, nothing inside single quotes is evaluated (no variable expansion,
 * no subshell evaluation, no wildcard expansion, no backslash interpretation).
 */
export function quotePosixArg(arg: string): string {
  if (arg === '') {
    return "''";
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Encodes a command and argument array into a single POSIX shell command string.
 * Example:
 *   quotePosixCommand('git', ['status', '--porcelain=v2'])
 *   => "'git' 'status' '--porcelain=v2'"
 */
export function quotePosixCommand(command: string, args: string[] = []): string {
  const parts = [command, ...args].map(quotePosixArg);
  return parts.join(' ');
}
