import type { HarnessProvider } from './types';

const RUNTIME = String.raw`import os, sys, json, stat, datetime, sqlite3, urllib.parse
root = sys.argv[1]
harnesses = json.loads(sys.argv[2])
scopes = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
if not isinstance(scopes, list) or len(scopes) > 64 or not all(isinstance(s, str) and os.path.isabs(s) and os.path.normpath(s) == s and s != '/' for s in scopes):
    sys.exit('Invalid session scan scopes')
home = os.path.realpath(os.path.expanduser('~'))
if not os.path.isdir(root) or os.path.realpath(root) != root:
    sys.exit('Workspace root is no longer canonical')
sessions = []
budget = 16 * 1024 * 1024

def text(value):
    return value if isinstance(value, str) else ''

def timestamp(value, fallback=0):
    try:
        return datetime.datetime.fromisoformat(text(value).replace('Z', '+00:00')).timestamp() * 1000
    except (ValueError, OverflowError, OSError):
        return fallback

def contained(parent, child):
    return child == parent or child.startswith(parent.rstrip('/') + '/')

def in_scope(path):
    return contained(root, path) or any(contained(scope, path) for scope in scopes)

def emit(harness, sid, cwd, title, when, model='', provider='', file=None):
    cwd = text(cwd)
    if not os.path.isabs(cwd): return
    if os.path.isdir(cwd):
        cwd = os.path.realpath(cwd)
    else:
        # A removed worktree: reported (as recorded) only inside a main-provided scope, never inside the workspace itself.
        cwd = os.path.normpath(cwd)
        if contained(root, cwd) or not any(contained(scope, cwd) for scope in scopes): return
    if not in_scope(cwd) or not text(sid): return
    item = dict(harness=harness, id=sid, cwd=cwd, title=text(title)[:120] or harness + ' session', timestamp=when)
    if model: item['modelId'] = text(model)[:128]
    if provider: item['provider'] = text(provider)[:128]
    if file: item['filePath'] = file
    sessions.append(item)
    if len(sessions) > 512: raise ValueError('Too many matching remote sessions (limit 512)')

def records(file, limit=256*1024):
    global budget
    if os.path.realpath(file) != file: raise ValueError('Session store contains a symbolic link')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): raise ValueError('Invalid session file')
        data = stream.read(limit + 1)
    budget -= len(data)
    if budget < 0: raise ValueError('Remote session metadata read limit exceeded')
    for line in data[:limit].splitlines():
        if len(line) > 65536: continue
        try:
            value = json.loads(line)
            if isinstance(value, dict): yield value
        except (ValueError, UnicodeError): pass

def files(store):
    if not os.path.lexists(store): return
    if os.path.realpath(store) != store: raise ValueError('Session store contains a symbolic link')
    count = 0
    entries = 0
    def onerror(error): raise error
    for directory, dirs, names in os.walk(store, followlinks=False, onerror=onerror):
        count += 1
        entries += len(dirs) + len(names)
        if count > 4096 or entries > 8192: raise ValueError('Remote session scan limit exceeded')
        dirs[:] = sorted(d for d in dirs if not os.path.islink(os.path.join(directory, d)))
        for name in sorted(names):
            if name.endswith('.jsonl'):
                yield os.path.join(directory, name)

`;

export function remoteSessionScript(providers: readonly HarnessProvider[]): string {
  const scans = providers.filter((provider) => provider.sessions?.remote);
  const definitions = scans.map((provider, index) => `def scan_${index}(harness):\n${provider.sessions!.remote!.scan.split('\n').map((line) => `    ${line}`).join('\n')}`).join('\n');
  const dispatch = scans.map((provider, index) => `${JSON.stringify(provider.descriptor.id)}: scan_${index}`).join(', ');
  const script = `${RUNTIME}\n${definitions}\nscanners = {${dispatch}}\nfor harness in harnesses:\n    scanners[harness](harness)\nprint(json.dumps(sessions, ensure_ascii=True))`;
  return `try:\n${script.split('\n').map((line) => `    ${line}`).join('\n')}\nexcept Exception as error:\n    sys.exit('Remote session discovery failed: ' + str(error))\n`;
}
