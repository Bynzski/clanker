/** Shared host cleanup validates a private manifest, never harness filenames.
 * Keep the manifest until unknown data is removed, so cleanup can be retried. */
export const REMOTE_RESOURCE_MANIFEST = '.clanker-resources.json';
export const REMOTE_RESOURCE_CLEANUP = String.raw`
def resource_path(relative):
    if not isinstance(relative, str) or not relative or len(relative) > 512 or '\\' in relative or '\x00' in relative:
        raise ValueError('Invalid attention resource path')
    if any(part in ('', '.', '..') for part in relative.split('/')):
        raise ValueError('Invalid attention resource path')
    return os.path.join(root, relative)

def checked_resource(relative, directory=False):
    filename = resource_path(relative)
    parent = os.path.dirname(filename)
    while parent != root:
        try:
            info = os.lstat(parent)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
                raise ValueError('Unsafe attention resource parent')
        except FileNotFoundError:
            pass
        parent = os.path.dirname(parent)
    try:
        info = os.lstat(filename)
    except FileNotFoundError:
        return filename
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600):
        raise ValueError('Unsafe attention resource')
    return filename

def cleanup_resources(manifest):
    if not isinstance(manifest, dict) or set(manifest) != {'files', 'directories'}:
        raise ValueError('Invalid attention resource manifest')
    for kind in ('files', 'directories'):
        entries = manifest[kind]
        if not isinstance(entries, list) or len(entries) > 128 or any(not isinstance(item, str) for item in entries) or len(set(entries)) != len(entries):
            raise ValueError('Invalid attention resource manifest')
    if '${REMOTE_RESOURCE_MANIFEST}' in manifest['files'] or set(manifest['files']) & set(manifest['directories']):
        raise ValueError('Invalid attention resource manifest')
    # Validate everything before removing anything; symlinks/types/modes fail closed.
    files = [checked_resource(name) for name in manifest['files']]
    directories = [checked_resource(name, True) for name in manifest['directories']]
    for filename in files:
        try:
            os.unlink(filename)
        except FileNotFoundError:
            pass
    for directory in sorted(directories, key=lambda value: value.count('/'), reverse=True):
        try:
            os.rmdir(directory)
        except OSError:
            pass
`;
// String.raw keeps Python escapes; the manifest name is shared infrastructure.
export const REMOTE_END_AND_CLEANUP = `import base64, json, os, stat, sys
root, token, harness = sys.argv[1:]
try:
    fd = os.open('/dev/tty', os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        raw = json.dumps(dict(version=1, token=token, harness=harness, event='agent_exited')).encode()
        os.write(fd, b'\\x1b]777;clanker-attention;' + base64.b64encode(raw) + b'\\x07')
    finally:
        os.close(fd)
except OSError:
    pass
if not os.path.isabs(root) or os.path.realpath(root) != root or not os.path.basename(root).startswith('clanker-remote-attention-'):
    sys.exit(1)
${REMOTE_RESOURCE_CLEANUP}
try:
    info = os.lstat(root)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        sys.exit(1)
    manifest_path = checked_resource('${REMOTE_RESOURCE_MANIFEST}')
    fd = os.open(manifest_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as stream:
        data = stream.read(65537)
    if len(data) > 65536:
        raise ValueError('Invalid attention resource manifest')
    cleanup_resources(json.loads(data))
    if os.listdir(root) == ['${REMOTE_RESOURCE_MANIFEST}']:
        os.unlink(manifest_path)
        os.rmdir(root)
except FileNotFoundError:
    if os.path.lexists(root):
        sys.exit('Missing attention resource manifest')
except (ValueError, OSError) as error:
    sys.exit(str(error))
`;
