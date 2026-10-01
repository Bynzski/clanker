import type { HarnessRemoteAttention } from './types';

export function remoteAttentionScript(spec: HarnessRemoteAttention): string {
  return `import fcntl, json, os, re, shlex, shutil, stat, sys, tempfile
request = json.load(sys.stdin)
harness, args = request['harness'], request['args']
home = os.path.realpath(os.environ['HOME'])
if ${spec.requiresNode ? 'True' : 'False'} and not shutil.which('node'):
    sys.exit('Remote Agent Attention requires Node.js on this host')
${spec.validate}

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
                if previous != content and not (name == request.get('upgradeFile') and previous == request.get('legacyPluginFile')):
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
    if request.get('plugin'):
        owned_plugin(request['plugin']['parts'], request['plugin']['files'])
finally:
    os.close(fd)
root = os.path.realpath(tempfile.mkdtemp(prefix='clanker-remote-attention-'))
try:
    # A setgid TMPDIR can propagate special bits despite mkdtemp's private mode.
    os.chmod(root, 0o700)
    for name, content in request['files'].items():
        filename = os.path.join(root, name)
        os.makedirs(os.path.dirname(filename), mode=0o700, exist_ok=True)
        with open(filename, 'x') as output:
            os.chmod(filename, 0o600)
            output.write(content)
    command = os.path.join(root, 'command.mjs')
    env = {'CLANKER_REMOTE_ATTENTION_COMMAND': command}
${spec.configure}
    print(json.dumps(dict(root=root, args=args, env=env)))
except BaseException:
    shutil.rmtree(root)
    raise
`;
}
