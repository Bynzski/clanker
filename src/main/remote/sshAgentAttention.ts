import * as path from 'node:path';
import { attentionAdapterSources, agyAttentionPlugin } from '../agentAttentionAdapters';
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
export const HERMES_REMOTE_ATTENTION_PLUGIN = `import base64, json, os

def emit(event, **kwargs):
    token = os.environ.get('CLANKER_REMOTE_ATTENTION_TOKEN')
    if not token or os.environ.get('CLANKER_REMOTE_ATTENTION_HARNESS') != 'hermes':
        return
    payload = dict(version=1, token=token, harness='hermes', event=event)
    for source, dest in [('session_id', 'sessionId'), ('turn_id', 'turnId')]:
        if isinstance(kwargs.get(source), str):
            payload[dest] = kwargs[source][:128]
    raw = json.dumps(payload).encode()
    if len(raw) > 2048:
        return
    try:
        fd = os.open('/dev/tty', os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
        try:
            os.write(fd, b'\\x1b]777;clanker-attention;' + base64.b64encode(raw) + b'\\x07')
        finally:
            os.close(fd)
    except OSError:
        pass

def register(ctx):
    for hook, event in [('pre_llm_call', 'turn_started'), ('post_llm_call', 'turn_completed'),
                        ('pre_approval_request', 'input_requested'), ('post_approval_response', 'input_resolved')]:
        ctx.register_hook(hook, lambda _event=event, **kwargs: emit(_event, **kwargs))
`;

export const PREPARE_ATTENTION_PYTHON = `import fcntl, json, os, re, shlex, shutil, stat, sys, tempfile
request = json.load(sys.stdin)
harness, args = request['harness'], request['args']
home = os.path.realpath(os.environ['HOME'])
if harness != 'opencode' and harness != 'hermes' and not shutil.which('node'):
    sys.exit('Remote Agent Attention requires Node.js on this host')
if harness == 'opencode' and (os.environ.get('OPENCODE_CONFIG_DIR') or '--pure' in args or '--attach' in args or any(a.startswith('--attach=') for a in args)):
    sys.exit('Remote attention cannot replace custom OpenCode configuration or observe an attached server')
if harness == 'claude' and any(a in ('--bare', '--safe-mode') or a.startswith('--settings') for a in args):
    sys.exit('Remote attention cannot replace custom Claude settings')
if harness in ('pi', 'omp') and '--no-extensions' in args:
    sys.exit('Remote attention requires harness extensions')
if harness == 'codex':
    overrides = []
    for index, arg in enumerate(args):
        if arg in ('-c', '--config') and index + 1 < len(args):
            overrides.append(args[index + 1])
        elif arg.startswith('--config='):
            overrides.append(arg[len('--config='):])
        elif arg.startswith('-c') and arg != '-c':
            overrides.append(arg[2:])
    if any(a in ('-p', '--profile') or a.startswith('--profile=') or (a.startswith('-p') and a != '-p') for a in args) or any(re.search(r'(?:^|\\.)\\s*(?:notify|profile)\\s*=', value) for value in overrides):
        sys.exit('Remote attention cannot replace a Codex profile or notify command')
    config_path = os.path.join(os.environ.get('CODEX_HOME') or os.path.join(home, '.codex'), 'config.toml')
    if os.path.exists(config_path):
        with open(config_path) as config:
            value = config.read(1048577)
        if len(value) > 1048576 or re.search(r'^\\s*(?:notify|profile)\\s*=', value, re.M):
            sys.exit('Remote attention cannot replace the host Codex notify command')
if harness == 'hermes' and (os.environ.get('HERMES_HOME') or os.environ.get('HERMES_PROFILE') or any(a.startswith('--profile') or a == '--ignore-user-config' for a in args)):
    sys.exit('Remote Hermes attention currently requires the default host profile')

def secure_directory(directory):
    info = os.lstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        sys.exit('Unsafe remote attention plugin directory: ' + directory)

def owned_plugin(parts, sources):
    directory = home
    secure_directory(directory)
    for part in parts:
        directory = os.path.join(directory, part)
        created = False
        try:
            os.mkdir(directory, 0o700)
            created = True
        except FileExistsError:
            pass
        secure_directory(directory)
    marker = os.path.join(directory, '.clanker-grid-owner')
    if not created:
        try:
            info = os.lstat(marker)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
                sys.exit('Unsafe remote attention ownership marker')
            with open(marker) as owner:
                if owner.read(128) != 'clanker-grid:remote-attention:v1\\n':
                    sys.exit('Refusing to overwrite an unowned remote attention plugin')
        except FileNotFoundError:
            sys.exit('Refusing to overwrite an unowned remote attention plugin')
    for name, content in sources.items():
        filename = os.path.join(directory, name)
        if os.path.lexists(filename):
            info = os.lstat(filename)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
                sys.exit('Unsafe remote attention plugin file: ' + filename)
            with open(filename) as existing:
                previous = existing.read(65537)
                if previous != content and not (harness == 'agy' and name == 'hooks.json' and previous == request['legacyAgyHooks']):
                    sys.exit('Refusing to overwrite an unowned or different remote attention plugin: ' + filename)
            if previous != content:
                # Upgrade only the exact prior owned hook payload, with an atomic replacement.
                replacement_fd, replacement = tempfile.mkstemp(prefix='.hooks-', dir=directory)
                try:
                    with os.fdopen(replacement_fd, 'w') as output:
                        output.write(content)
                    os.replace(replacement, filename)
                finally:
                    if os.path.exists(replacement):
                        os.unlink(replacement)
        else:
            fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as output:
                output.write(content)
    if created:
        with open(marker, 'x') as owner:
            os.chmod(marker, 0o600)
            owner.write('clanker-grid:remote-attention:v1\\n')

# Serialize shared plugin installation across concurrent launches and app instances.
fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY)
try:
    fcntl.flock(fd, fcntl.LOCK_EX)
    if harness == 'agy':
        owned_plugin(['.gemini', 'config', 'plugins', 'clanker-grid-remote-attention'], request['agy'])
    if harness == 'hermes':
        owned_plugin(['.hermes', 'plugins', 'clanker-grid-remote-attention'], request['hermes'])
finally:
    os.close(fd)
root = os.path.realpath(tempfile.mkdtemp(prefix='clanker-remote-attention-'))
try:
    for name, content in request['files'].items():
        filename = os.path.join(root, name)
        os.makedirs(os.path.dirname(filename), mode=0o700, exist_ok=True)
        with open(filename, 'x') as output:
            os.chmod(filename, 0o600)
            output.write(content)
    command = os.path.join(root, 'command.mjs')
    env = {'CLANKER_REMOTE_ATTENTION_COMMAND': command}
    if harness == 'claude':
        hook = {'hooks': [{'type': 'command', 'command': 'node ' + shlex.quote(command), 'timeout': 2}]}
        settings = {'hooks': {name: [hook] for name in ['UserPromptSubmit', 'Stop', 'PostToolUse', 'Notification', 'SessionEnd']}}
        settings_path = os.path.join(root, 'claude-settings.json')
        with open(settings_path, 'x') as output:
            os.chmod(settings_path, 0o600)
            json.dump(settings, output)
        args += ['--settings', settings_path]
    elif harness in ('pi', 'omp'):
        args += ['--extension', os.path.join(root, harness + '.ts')]
    elif harness == 'opencode':
        env['OPENCODE_CONFIG_DIR'] = os.path.join(root, 'opencode')
    elif harness == 'codex':
        args = ['-c', 'notify=' + json.dumps(['node', command])] + args
    print(json.dumps(dict(root=root, args=args, env=env)))
except BaseException:
    shutil.rmtree(root)
    raise
`;

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
  if (!['codex', 'claude', 'opencode', 'pi', 'omp', 'agy', 'hermes'].includes(harness)
    || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Unsupported remote attention registration');
  const agy = agyAttentionPlugin('$CLANKER_REMOTE_ATTENTION_COMMAND', 'linux');
  agy.pluginJson.name = 'clanker-grid-remote-attention';
  const legacyAgyHooks = JSON.stringify(agy.hooksJson);
  // The persistent plugin must be inert for ordinary host launches, including ask tools.
  const guardHooks = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.command === 'string') {
      record.command = `if [ -n "$CLANKER_REMOTE_ATTENTION_TOKEN" ] && [ "$CLANKER_REMOTE_ATTENTION_HARNESS" = agy ] && [ -n "$CLANKER_REMOTE_ATTENTION_COMMAND" ] && [ -r "$CLANKER_REMOTE_ATTENTION_COMMAND" ]; then ${record.command}; else printf '{}\\n'; fi`;
    }
    Object.values(record).forEach(guardHooks);
  };
  guardHooks(agy.hooksJson);
  const result = await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand('python3', ['-c', PREPARE_ATTENTION_PYTHON])}`], {
    input: JSON.stringify({ harness, args, files: attentionAdapterSources(REMOTE_ATTENTION_OBSERVER), legacyAgyHooks,
      agy: { 'plugin.json': JSON.stringify(agy.pluginJson), 'hooks.json': JSON.stringify(agy.hooksJson) },
      hermes: { 'plugin.yaml': 'name: clanker-grid-remote-attention\nversion: 1.0.0\ndescription: Clanker SSH lifecycle observer\n',
        '__init__.py': HERMES_REMOTE_ATTENTION_PLUGIN } }),
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
  const release = async () => {
    await executor.exec(target, 'python3', ['-c', END_AND_CLEANUP_PYTHON, response.root, '', harness], { timeoutMs: 5000, maxBuffer: 4096 });
  };
  if (harness === 'hermes') {
    try {
      await executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec hermes plugins enable clanker-grid-remote-attention`], { timeoutMs: 15000, maxBuffer: 64 * 1024 });
    } catch (error) {
      await release().catch(() => undefined);
      throw new Error(`Could not enable the remote Hermes observer plugin: ${error instanceof Error ? error.message : String(error)}`);
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
