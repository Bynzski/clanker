import { findHarnessProvider } from '../harnesses/registry';
import { remoteAttentionScript } from '../harnesses/remoteAttentionRuntime';
export { HERMES_REMOTE_ATTENTION_PLUGIN } from '../harnesses/hermes/remoteAttention';
import * as path from 'node:path';
import { attentionAdapterSources } from '../agentAttentionAdapters';
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

// Observer-only Hermes plugin: no prompts, commands, output, or credentials leave the host.
const END_AND_CLEANUP_PYTHON = `import base64, json, os, stat, sys
root, token, harness = sys.argv[1:]
try:
    fd = os.open('/dev/tty', os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        raw = json.dumps(dict(version=1, token=token, harness=harness, event='session_ended')).encode()
        os.write(fd, b'\\x1b]777;clanker-attention;' + base64.b64encode(raw) + b'\\x07')
    finally:
        os.close(fd)
except OSError:
    pass
# Never recursively remove host data; unlink only our expected regular files.
if not os.path.isabs(root) or not os.path.basename(root).startswith('clanker-remote-attention-'):
    sys.exit(1)
try:
    info = os.lstat(root)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        sys.exit(1)
    for relative in ['command.mjs', 'observer.mjs', 'pi.ts', 'omp.ts', 'claude-settings.json',
                     'opencode/observer.mjs', 'opencode/plugins/clanker-attention.js']:
        filename = os.path.join(root, relative)
        parent = os.path.dirname(filename)
        if os.path.realpath(parent) != parent:
            continue
        try:
            info = os.lstat(filename)
            if stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid():
                os.unlink(filename)
        except FileNotFoundError:
            pass
    for relative in ['opencode/plugins', 'opencode', '']:
        try:
            os.rmdir(os.path.join(root, relative))
        except OSError:
            pass
except FileNotFoundError:
    pass
`;

export async function prepareSshAttention(
  executor: SshCommandExecutor, target: string, harness: string, args: string[], token: string,
): Promise<{ args: string[]; env: Record<string, string>; endCommand: string; release: () => Promise<void> }> {
  const capability = findHarnessProvider(harness)?.attention?.remote;
  if (!capability || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Unsupported remote attention registration');
  const plugin = capability.plugin?.();
  const result = await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand('python3', ['-c', remoteAttentionScript(capability)])}`], {
    input: JSON.stringify({ harness, args, files: attentionAdapterSources(REMOTE_ATTENTION_OBSERVER),
      ...(plugin ? { plugin, upgradeFile: plugin.upgradeFile, legacyPluginFile: plugin.legacyFile } : {}) }),
    timeoutMs: 15000, maxBuffer: 64 * 1024,
  });
  const response = JSON.parse(result.stdout) as { root: string; args: string[]; env: Record<string, string> };
  if (typeof response.root !== 'string' || !path.posix.isAbsolute(response.root)
    || path.posix.normalize(response.root) !== response.root || /[\x00-\x1f\x7f]/.test(response.root)
    || !/^clanker-remote-attention-[\w-]+$/.test(path.posix.basename(response.root))
    || !Array.isArray(response.args) || !response.args.every((arg) => typeof arg === 'string')
    || !response.env || Object.entries(response.env).some(([key, value]) =>
      !['CLANKER_REMOTE_ATTENTION_COMMAND', 'OPENCODE_CONFIG_DIR'].includes(key) || typeof value !== 'string')) {
    throw new Error('Invalid remote attention preparation response');
  }
  let disposal: Promise<void> | undefined;
  const release = () => {
    if (disposal) return disposal;
    disposal = (async () => {
    await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand('python3', ['-c', END_AND_CLEANUP_PYTHON, response.root, '', harness])}`], { timeoutMs: 5000, maxBuffer: 4096 });
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
    endCommand: quotePosixCommand('python3', ['-c', END_AND_CLEANUP_PYTHON, response.root, token, harness]),
    release,
  };
}

export function remoteAttentionEnvironment(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${quotePosixArg(value)}`).join(' ');
}
