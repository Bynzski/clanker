import { findHarnessProvider } from '../harnesses/registry';
import type { AttentionPreparationContext } from '../harnesses/types';
import { remoteAttentionScript } from '../harnesses/remoteAttentionRuntime';
export { HERMES_REMOTE_ATTENTION_PLUGIN } from '../harnesses/hermes/remoteAttention';
import * as path from 'node:path';
import { COMMAND } from '../harnesses/attentionSources';
import { REMOTE_END_AND_CLEANUP } from '../harnesses/remoteAttentionCleanup';
import type { SshCommandExecutor } from './sshCommandExecutor';
import { quotePosixArg, quotePosixCommand } from './posixQuote';
import { REMOTE_ATTENTION_OBSERVER } from './remoteAttentionTransport';

// Source the POSIX login profile and add user CLI paths for noninteractive SSH.
export const REMOTE_CLI_PATH_SETUP = [
  'if [ -r "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null; fi',
  'for clanker_bin in "$HOME/bin" "$HOME/.npm-packages/bin" "$HOME/.local/bin" "$HOME/.npm-global/bin"; do',
  '  case ":$PATH:" in *":$clanker_bin:"*) ;; *) PATH="$clanker_bin:$PATH" ;; esac',
  'done',
  'export PATH',
].join('\n');

export async function prepareSshAttention(
  executor: SshCommandExecutor, target: string, harness: string, args: string[], token: string,
  context: AttentionPreparationContext = {},
): Promise<{ args: string[]; env: Record<string, string>; endCommand: string; release: () => Promise<void> }> {
  const capability = findHarnessProvider(harness)?.attention?.remote;
  if (!capability || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Unsupported remote attention registration');
  const plugin = capability.plugin?.();
  const interpreter = findHarnessProvider(harness)?.attention?.interpreter;
  const result = await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand('python3', ['-c', remoteAttentionScript(capability)])}`], {
    input: JSON.stringify({ harness, args, files: { 'observer.mjs': REMOTE_ATTENTION_OBSERVER, 'command.mjs': COMMAND, ...(interpreter ? { 'interpreter.mjs': interpreter } : {}), ...capability.resources?.(REMOTE_ATTENTION_OBSERVER) },
      ...(context.rootSessionId ? { rootSessionId: context.rootSessionId } : {}),
      ...(plugin ? { plugin, upgradeFile: plugin.upgradeFile, legacyPluginFiles: plugin.legacyFiles } : {}) }),
    timeoutMs: 15000, maxBuffer: 64 * 1024,
  });
  const response = JSON.parse(result.stdout) as { root: string; args: string[]; env: Record<string, string> };
  if (typeof response.root !== 'string' || !path.posix.isAbsolute(response.root)
    || path.posix.normalize(response.root) !== response.root || /[\x00-\x1f\x7f]/.test(response.root)
    || !/^clanker-remote-attention-[\w-]+$/.test(path.posix.basename(response.root))
    || !Array.isArray(response.args) || !response.args.every((arg) => typeof arg === 'string')
    || !response.env || response.env.CLANKER_REMOTE_ATTENTION_COMMAND !== path.posix.join(response.root, 'command.mjs') || Object.entries(response.env).some(([key, value]) =>
      !['CLANKER_REMOTE_ATTENTION_COMMAND', ...(capability.environmentKeys ?? [])].includes(key) || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || typeof value !== 'string')) {
    throw new Error('Invalid remote attention preparation response');
  }
  let disposal: Promise<void> | undefined;
  const release = () => {
    if (disposal) return disposal;
    disposal = (async () => {
    await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand('python3', ['-c', REMOTE_END_AND_CLEANUP, response.root, '', harness])}`], { timeoutMs: 5000, maxBuffer: 4096 });
    })().finally(() => { disposal = undefined; });
    return disposal;
  };
  if (capability.enableCommand) {
    try {
      await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand(capability.enableCommand.command, capability.enableCommand.args)}`], { timeoutMs: 15000, maxBuffer: 64 * 1024 });
    } catch (error) {
      await release().catch(() => undefined);
      throw new Error(`Could not enable the remote ${findHarnessProvider(harness)?.descriptor.name} observer plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    args: response.args,
    env: { ...response.env, CLANKER_REMOTE_ATTENTION_TOKEN: token, CLANKER_REMOTE_ATTENTION_HARNESS: harness },
    endCommand: quotePosixCommand('python3', ['-c', REMOTE_END_AND_CLEANUP, response.root, token, harness]),
    release,
  };
}

export function remoteAttentionEnvironment(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${quotePosixArg(value)}`).join(' ');
}
