import type { HarnessCommandExecutor } from './commandExecution';
import type { HarnessProfilesCapability } from './types';
import { executeLocalHarnessCommand } from '../environment/localCommandExecutor';

/** Providers declare policy; the existing bounded local transport owns executable resolution. */
export function createLocalProfileExecutor(
  capability: Pick<HarnessProfilesCapability, 'probeUnsetEnvironmentKeys'>,
  execute = executeLocalHarnessCommand,
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): HarnessCommandExecutor {
  const baseEnv = { ...base };
  for (const key of capability.probeUnsetEnvironmentKeys) {
    for (const inherited of Object.keys(baseEnv)) {
      if (platform === 'win32' ? inherited.toLowerCase() === key.toLowerCase() : inherited === key) delete baseEnv[inherited];
    }
  }
  return { run: (request) => execute(request, undefined, { baseEnv }) };
}
