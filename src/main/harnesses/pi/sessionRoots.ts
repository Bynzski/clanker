import * as os from 'node:os';
import * as path from 'node:path';

/** Invocation lookup honors trusted launch configuration. History retains its
 * conventional scan until a separate local/SSH storage migration. */
export function invocationSessionRoot(workspacePath: string, userFlags?: string): { root: string; flat: boolean } {
  const flags = userFlags?.trim().split(/\s+/) ?? [];
  let directory = process.env.PI_CODING_AGENT_SESSION_DIR;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--session-dir') directory = flags[++i];
    else if (flags[i].startsWith('--session-dir=')) directory = flags[i].slice('--session-dir='.length);
  }
  const expand = (value: string) => value === '~' ? os.homedir()
    : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  if (directory) return { root: path.resolve(workspacePath, expand(directory)), flat: true };
  return { root: path.resolve(workspacePath, expand(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), '.pi/agent')), 'sessions'), flat: false };
}
