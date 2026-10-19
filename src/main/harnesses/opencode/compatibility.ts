import { HarnessCapabilityError } from '../types';
import { openCodeMajorVersion } from './version';

/** Installed 2.0.26 has neither TUI model/fork flags nor run --pure. Never silently
 * drop a requested model, resume instead of forking, or weaken commit isolation. */
export function assertLocalOpenCodeOperation(operation: 'model' | 'fork' | 'commit'): void {
  if (openCodeMajorVersion(process.env) !== 2) return;
  const guidance = {
    model: 'OpenCode 2.x does not support a startup model flag. Clear the Clanker model selection and choose a model inside OpenCode with /models.',
    fork: 'OpenCode 2.x does not support TUI --fork. Resume the conversation and use its native fork controls instead; Clanker has not resumed or changed the original session.',
    commit: 'OpenCode 2.x does not support run --pure. AI commit generation is unavailable until equivalent isolation is verified. Choose another AI commit provider in Settings.',
  };
  throw new HarnessCapabilityError('unsupported', guidance[operation]);
}

export function modelArgs(model: string, modelArg = '-m', transport: 'local' | 'ssh' = 'local'): string[] {
  if (transport === 'local') assertLocalOpenCodeOperation('model');
  return [modelArg, model];
}
