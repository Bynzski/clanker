import type { HarnessSession } from '../../shared/types/session';
import type { SshCommandExecutor } from './sshCommandExecutor';
import { isPathContained } from './remotePaths';
import { REMOTE_CLI_PATH_SETUP } from './sshAgentAttention';
import { quotePosixCommand } from './posixQuote';
import { posix } from 'node:path';

const SUPPORTED = ['codex', 'claude', 'pi', 'omp', 'agy', 'opencode'] as const;

// Read metadata only, on the host that owns the workspace. Python's SQLite reader
// needs no installed helper and opens Antigravity's database in read-only mode.
const DISCOVER_SCRIPT = String.raw`import os, sys, json, stat, datetime, sqlite3, urllib.parse
root = sys.argv[1]
harnesses = json.loads(sys.argv[2])
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

def emit(harness, sid, cwd, title, when, model='', provider='', file=None):
    cwd = text(cwd)
    if not os.path.isabs(cwd) or not os.path.isdir(cwd): return
    cwd = os.path.realpath(cwd)
    if not contained(root, cwd) or not text(sid): return
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

for harness in harnesses:
    if harness == 'opencode':
        entries = json.loads(sys.stdin.read(1024*1024 + 1))
        if not isinstance(entries, list) or len(entries) > 4096: raise ValueError('Invalid OpenCode session list')
        for entry in entries:
            if not isinstance(entry, dict): raise ValueError('Invalid OpenCode session entry')
            emit(harness, entry.get('id'), entry.get('directory'), entry.get('title'), entry.get('updated', entry.get('created', 0)))
        continue
    if harness == 'agy':
        db = os.path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db')
        if not os.path.lexists(db): continue
        if os.path.realpath(db) != db: raise ValueError('Session database contains a symbolic link')
        with sqlite3.connect('file:' + urllib.parse.quote(db) + '?mode=ro', uri=True, timeout=2) as conn:
            conn.set_progress_handler(lambda: 1 if datetime.datetime.now().timestamp() > deadline else 0, 1000)
            deadline = datetime.datetime.now().timestamp() + 3
            query = 'SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 4097'
            rows = conn.execute(query).fetchall()
            if len(rows) > 4096: raise ValueError('Remote conversation scan limit exceeded')
            for sid, title, preview, modified, user_time, uris in rows:
                if text(modified).startswith('0001'): continue
                try: paths = json.loads(uris)
                except (ValueError, TypeError): continue
                if not isinstance(paths, list): continue
                for uri in paths:
                    if not isinstance(uri, str): continue
                    parsed = urllib.parse.urlsplit(uri)
                    if parsed.scheme == 'file' and parsed.netloc in ('', 'localhost'):
                        cwd = urllib.parse.unquote(parsed.path)
                    elif not parsed.scheme and os.path.isabs(uri):
                        cwd = uri
                    else: continue
                    if contained(root, os.path.realpath(cwd)):
                        emit(harness, sid, cwd, title or (preview if preview != '<conversation>' else ''), timestamp(modified, timestamp(user_time)))
                        break
        continue
    stores = {'codex': '.codex/sessions', 'claude': '.claude/projects', 'pi': '.pi/agent/sessions', 'omp': '.omp/agent/sessions'}
    index = {}
    if harness == 'codex':
        index_file = os.path.join(home, '.codex', 'session_index.jsonl')
        if os.path.lexists(index_file):
            for entry in records(index_file, 4*1024*1024):
                if text(entry.get('id')): index[entry['id']] = entry
    for file in files(os.path.join(home, stores[harness])):
        try:
            events = list(records(file))
            when = os.stat(file, follow_symlinks=False).st_mtime * 1000
        except FileNotFoundError: continue
        sid, cwd, title, model, provider = '', '', '', '', ''
        for event in events:
            kind = event.get('type')
            payload = event.get('payload')
            if harness == 'codex' and kind == 'session_meta' and isinstance(payload, dict):
                sid, cwd = text(payload.get('id')), text(payload.get('cwd'))
                model, provider = text(payload.get('model')), text(payload.get('model_provider'))
            elif harness in ('pi', 'omp') and kind == 'session':
                sid, cwd = text(event.get('id')), text(event.get('cwd'))
                when = timestamp(event.get('timestamp'), when)
            elif harness == 'claude':
                cwd = cwd or text(event.get('cwd'))
                sid = os.path.basename(file)[:-6]
            message = event.get('message')
            if isinstance(message, dict):
                content = message.get('content')
                if not title and (message.get('role') == 'user' or kind == 'user') and not event.get('isMeta'):
                    if isinstance(content, list): content = '\n'.join(text(part.get('text')) for part in content if isinstance(part, dict) and part.get('type') == 'text')
                    value = text(content).strip()
                    if not value.startswith(('<command', '<local-command')): title = value[:120]
                if harness == 'claude' and kind == 'assistant': model = text(message.get('model')) or model
            if harness == 'codex' and kind == 'response_item' and isinstance(payload, dict) and payload.get('role') == 'user' and not title:
                content = payload.get('content', [])
                if isinstance(content, list): title = '\n'.join(text(part.get('text')) for part in content if isinstance(part, dict))[:120]
            if harness == 'codex' and kind == 'event_msg' and isinstance(payload, dict) and payload.get('type') == 'user_message' and not title:
                title = text(payload.get('message'))[:120]
            if kind == 'model_change':
                model = text(event.get('modelId' if harness == 'pi' else 'model')) or model
                provider = text(event.get('provider')) or provider
            if harness == 'omp' and kind == 'title': title = text(event.get('title')).strip()[:120] or title
        indexed = index.get(sid, {})
        title = text(indexed.get('thread_name')).strip() or title
        when = timestamp(indexed.get('updated_at'), when)
        emit(harness, sid, cwd, title, when, model, provider, file if harness in ('pi', 'omp') else None)
print(json.dumps(sessions, ensure_ascii=True))
`;
const GUARDED_DISCOVER_SCRIPT = `try:\n${DISCOVER_SCRIPT.split('\n').map((line) => `    ${line}`).join('\n')}\nexcept Exception as error:\n    sys.exit('Remote session discovery failed: ' + str(error))\n`;

export async function discoverSshSessions(executor: SshCommandExecutor, target: string, workspacePath: string, harnessIds: string[]): Promise<HarnessSession[]> {
  const harnesses = SUPPORTED.filter((id) => harnessIds.includes(id));
  if (!workspacePath.startsWith('/') || workspacePath.includes('\0') || posix.normalize(workspacePath) !== workspacePath || Buffer.byteLength(workspacePath) > 4096) throw new Error('Invalid remote workspace path');
  const scans: Promise<string>[] = [];
  if (harnesses.some((id) => id !== 'opencode')) scans.push(executor.exec(target, 'python3', ['-c', GUARDED_DISCOVER_SCRIPT, workspacePath, JSON.stringify(harnesses.filter((id) => id !== 'opencode'))], { timeoutMs: 20000, maxBuffer: 1024 * 1024 }).then((result) => result.stdout));
  if (harnesses.includes('opencode')) scans.push(executor.exec(target, 'sh', ['-c', `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand('opencode', ['session', 'list', '--format', 'json'])}`], { cwd: workspacePath, timeoutMs: 20000, maxBuffer: 1024 * 1024 }).then(async (result) => {
    let raw: unknown;
    try { raw = JSON.parse(result.stdout); }
    catch { raw = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    const entries = Array.isArray(raw) ? raw : [raw];
    if (entries.length > 4096) throw new Error('Remote OpenCode session scan limit exceeded');
    const validated = await executor.exec(target, 'python3', ['-c', GUARDED_DISCOVER_SCRIPT, workspacePath, '["opencode"]'], { input: JSON.stringify(entries), timeoutMs: 10000, maxBuffer: 1024 * 1024 });
    return validated.stdout;
  }));
  const sessions: HarnessSession[] = [];
  const seen = new Set<string>();
  for (const output of await Promise.all(scans)) {
    const entries: unknown = JSON.parse(output);
    if (!Array.isArray(entries)) throw new Error('Invalid remote session response');
    for (const item of entries) {
      if (!item || typeof item !== 'object') throw new Error('Invalid remote session response');
      const session = item as HarnessSession;
      if (!harnesses.includes(session.harness as typeof SUPPORTED[number]) || typeof session.id !== 'string' || !session.id || session.id.length > 256
        || typeof session.cwd !== 'string' || !session.cwd.startsWith('/') || session.cwd.includes('\0')
        || typeof session.title !== 'string' || session.title.length > 120 || !Number.isFinite(session.timestamp)
        || [session.modelId, session.provider, session.filePath].some((value) => value !== undefined && (typeof value !== 'string' || value.includes('\0')))) throw new Error('Invalid remote session response');
      if (!isPathContained(workspacePath, session.cwd)) continue;
      const key = `${session.harness}\0${session.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sessions.push(session);
      if (sessions.length > 512) throw new Error('Too many matching remote sessions (limit 512)');
    }
  }
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}
