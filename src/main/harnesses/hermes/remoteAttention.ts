import type { HarnessRemoteAttention } from '../types';

/** Provenance comes from real Hermes lifecycle data: `pre_llm_call` (turn_id, parent_session_id) opens
 * a root or child turn; `on_session_end` supplies final outcome flags and approval hooks tie back by turn_id.
 * Location: Hermes keeps a persistent shell directory (a `cd` carries over between commands) on the
 * task's terminal environment; no hook argument carries it. Root turn events report it from the
 * active environment of their task, only for a local backend (a container's path is not a host path).
 * No environment yet, another backend, or any failure reports nothing. */
export const HERMES_REMOTE_ATTENTION_PLUGIN = `import base64, json, os, sqlite3, threading

_LOCK = threading.Lock()
_ROOT = {'session': None}
_ROOT_TURNS = {}
_CHILD_TURNS = {}
_CHILD_SESSIONS = {}
_LIMIT = 64

def _track(bucket, key):
    bucket[key] = True
    while len(bucket) > _LIMIT:
        del bucket[next(iter(bucket))]

def _text(value):
    return value if isinstance(value, str) and value else None

def _location(task_id):
    try:
        from tools.terminal_tool_lifecycle import get_active_env
        env = get_active_env(task_id) if task_id else None
    except Exception:
        return None
    if env is None or type(env).__name__ != 'LocalEnvironment':
        return None
    cwd = getattr(env, 'cwd', None)
    return cwd if isinstance(cwd, str) and cwd.startswith('/') else None

def _emit(event, scope, native, session_id=None, turn_id=None, input_id=None, continues=None, cwd=None):
    token = os.environ.get('CLANKER_REMOTE_ATTENTION_TOKEN')
    if not token or os.environ.get('CLANKER_REMOTE_ATTENTION_HARNESS') != 'hermes':
        return
    payload = dict(version=1, token=token, harness='hermes', event=event, scope=scope, nativeEvent=native)
    for key, value in (('sessionId', session_id), ('turnId', turn_id), ('inputId', input_id), ('continuesSessionId', continues)):
        if value:
            payload[key] = value[:128]
    if isinstance(cwd, str) and cwd and len(cwd.encode()) <= 1024 and all(ord(c) >= 32 and ord(c) != 127 for c in cwd):
        payload['cwd'] = cwd
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

def _compression_parent(session_id):
    """Hermes records a compression rotation as a child row whose parent ended with
    end_reason='compression'. Delegation children have a different end reason."""
    try:
        try:
            from hermes_constants import get_hermes_home
            home = str(get_hermes_home())
        except Exception:
            home = os.path.join(os.path.expanduser('~'), '.hermes')
        database = sqlite3.connect('file:' + os.path.join(home, 'state.db') + '?mode=ro', uri=True, timeout=0.25)
        try:
            row = database.execute(
                'SELECT c.parent_session_id, p.end_reason FROM sessions c JOIN sessions p ON p.id = c.parent_session_id WHERE c.id = ?',
                (session_id,)).fetchone()
        finally:
            database.close()
        return row[0] if row and row[1] == 'compression' else None
    except Exception:
        return None

def _continues(root, session_id, turn_id):
    """True only when native lifecycle data proves session_id continues root's conversation:
    a turn that began under root (turn IDs are prefixed with the session current at turn
    start), or a recorded compression lineage back to root. An arbitrary new ID never qualifies."""
    if turn_id and turn_id.startswith(root + ':'):
        return True
    seen = session_id
    for _ in range(8):
        parent = _compression_parent(seen)
        if not parent:
            return False
        if parent == root:
            return True
        seen = parent
    return False

def _bind(session_id, turn_id):
    root = _ROOT['session']
    if root is None:
        _ROOT['session'] = session_id
        return session_id, None
    if root == session_id:
        return root, None
    if _continues(root, session_id, turn_id):
        _ROOT['session'] = session_id
        return session_id, root
    return None, None

def pre_llm_call(**kwargs):
    session, turn = _text(kwargs.get('session_id')), _text(kwargs.get('turn_id'))
    if not session or not turn:
        return
    with _LOCK:
        if kwargs.get('parent_session_id'):
            _track(_CHILD_TURNS, turn)
            _track(_CHILD_SESSIONS, session)
            return
        current, previous = _bind(session, turn)
        if current is None:
            return
        _track(_ROOT_TURNS, turn)
    if previous:
        _emit('session_continued', 'root', 'pre_llm_call', current, continues=previous)
    _emit('turn_started', 'root', 'pre_llm_call', current, turn, cwd=_location(_text(kwargs.get('task_id'))))

def on_session_end(**kwargs):
    # on_session_end does not carry parent_session_id, so provenance comes from the turn
    # (or session) seen at the matching pre_llm_call. An unseen turn is never reported.
    session, turn = _text(kwargs.get('session_id')), _text(kwargs.get('turn_id'))
    if not turn:
        return
    with _LOCK:
        if turn in _CHILD_TURNS or session in _CHILD_SESSIONS:
            scope, current, previous = 'child', session, None
        elif turn in _ROOT_TURNS and session:
            scope = 'root'
            current, previous = _bind(session, turn)
            if current is None:
                return
            del _ROOT_TURNS[turn]
        else:
            return
    if previous:
        _emit('session_continued', 'root', 'on_session_end', current, continues=previous)
    cwd = _location(_text(kwargs.get('task_id'))) if scope == 'root' else None
    outcome = 'turn_interrupted' if kwargs.get('interrupted') is True else 'turn_failed' if kwargs.get('failed') is True else 'turn_completed' if kwargs.get('completed') is True else None
    if not outcome:
        return
    _emit(outcome, scope, 'on_session_end', current, turn, cwd=cwd)

def _approval(event, native):
    def handler(**kwargs):
        # A smart approval is decided by an auxiliary model, not by the user. The turn_id
        # (not session_key, which can be a stale compression parent) ties it to its turn.
        if kwargs.get('surface') == 'smart':
            return
        turn = _text(kwargs.get('turn_id'))
        if not turn:
            return
        input_id = _text(kwargs.get('tool_call_id')) or _text(kwargs.get('pattern_key')) or 'approval'
        with _LOCK:
            if turn in _CHILD_TURNS:
                scope, session = 'child', None
            elif turn in _ROOT_TURNS and _ROOT['session']:
                scope, session = 'root', _ROOT['session']
            else:
                return
        _emit(event, scope, native, session, turn, input_id)
    return handler

def on_session_finalize(**kwargs):
    session = _text(kwargs.get('session_id'))
    with _LOCK:
        root = _ROOT['session']
        if not root or not session or (session != root and not _continues(root, session, None)):
            return
        _ROOT['session'] = None
        for bucket in (_ROOT_TURNS, _CHILD_TURNS, _CHILD_SESSIONS):
            bucket.clear()
    _emit('session_ended', 'root', 'on_session_finalize', root)

def register(ctx):
    ctx.register_hook('pre_llm_call', pre_llm_call)
    ctx.register_hook('on_session_end', on_session_end)
    ctx.register_hook('pre_approval_request', _approval('input_requested', 'pre_approval_request'))
    ctx.register_hook('post_approval_response', _approval('input_resolved', 'post_approval_response'))
    ctx.register_hook('on_session_finalize', on_session_finalize)
`;

/** Exact checkpoint-2 artifact accepted for owned-plugin upgrade only. */
export const PRE_SETTLEMENT_HERMES_REMOTE_ATTENTION_PLUGIN = `import base64, json, os, sqlite3, threading

_LOCK = threading.Lock()
_ROOT = {'session': None}
_ROOT_TURNS = {}
_CHILD_TURNS = {}
_CHILD_SESSIONS = {}
_LIMIT = 64

def _track(bucket, key):
    bucket[key] = True
    while len(bucket) > _LIMIT:
        del bucket[next(iter(bucket))]

def _text(value):
    return value if isinstance(value, str) and value else None

def _location(task_id):
    try:
        from tools.terminal_tool_lifecycle import get_active_env
        env = get_active_env(task_id) if task_id else None
    except Exception:
        return None
    if env is None or type(env).__name__ != 'LocalEnvironment':
        return None
    cwd = getattr(env, 'cwd', None)
    return cwd if isinstance(cwd, str) and cwd.startswith('/') else None

def _emit(event, scope, native, session_id=None, turn_id=None, input_id=None, continues=None, cwd=None):
    token = os.environ.get('CLANKER_REMOTE_ATTENTION_TOKEN')
    if not token or os.environ.get('CLANKER_REMOTE_ATTENTION_HARNESS') != 'hermes':
        return
    payload = dict(version=1, token=token, harness='hermes', event=event, scope=scope, nativeEvent=native)
    for key, value in (('sessionId', session_id), ('turnId', turn_id), ('inputId', input_id), ('continuesSessionId', continues)):
        if value:
            payload[key] = value[:128]
    if isinstance(cwd, str) and cwd and len(cwd.encode()) <= 1024 and all(ord(c) >= 32 and ord(c) != 127 for c in cwd):
        payload['cwd'] = cwd
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

def _compression_parent(session_id):
    """Hermes records a compression rotation as a child row whose parent ended with
    end_reason='compression'. Delegation children have a different end reason."""
    try:
        try:
            from hermes_constants import get_hermes_home
            home = str(get_hermes_home())
        except Exception:
            home = os.path.join(os.path.expanduser('~'), '.hermes')
        database = sqlite3.connect('file:' + os.path.join(home, 'state.db') + '?mode=ro', uri=True, timeout=0.25)
        try:
            row = database.execute(
                'SELECT c.parent_session_id, p.end_reason FROM sessions c JOIN sessions p ON p.id = c.parent_session_id WHERE c.id = ?',
                (session_id,)).fetchone()
        finally:
            database.close()
        return row[0] if row and row[1] == 'compression' else None
    except Exception:
        return None

def _continues(root, session_id, turn_id):
    """True only when native lifecycle data proves session_id continues root's conversation:
    a turn that began under root (turn IDs are prefixed with the session current at turn
    start), or a recorded compression lineage back to root. An arbitrary new ID never qualifies."""
    if turn_id and turn_id.startswith(root + ':'):
        return True
    seen = session_id
    for _ in range(8):
        parent = _compression_parent(seen)
        if not parent:
            return False
        if parent == root:
            return True
        seen = parent
    return False

def _bind(session_id, turn_id):
    root = _ROOT['session']
    if root is None:
        _ROOT['session'] = session_id
        return session_id, None
    if root == session_id:
        return root, None
    if _continues(root, session_id, turn_id):
        _ROOT['session'] = session_id
        return session_id, root
    return None, None

def pre_llm_call(**kwargs):
    session, turn = _text(kwargs.get('session_id')), _text(kwargs.get('turn_id'))
    if not session or not turn:
        return
    with _LOCK:
        if kwargs.get('parent_session_id'):
            _track(_CHILD_TURNS, turn)
            _track(_CHILD_SESSIONS, session)
            return
        current, previous = _bind(session, turn)
        if current is None:
            return
        _track(_ROOT_TURNS, turn)
    if previous:
        _emit('session_continued', 'root', 'pre_llm_call', current, continues=previous)
    _emit('turn_started', 'root', 'pre_llm_call', current, turn, cwd=_location(_text(kwargs.get('task_id'))))

def post_llm_call(**kwargs):
    # post_llm_call does not carry parent_session_id, so provenance comes from the turn
    # (or session) seen at the matching pre_llm_call. An unseen turn is never reported.
    session, turn = _text(kwargs.get('session_id')), _text(kwargs.get('turn_id'))
    if not turn:
        return
    with _LOCK:
        if turn in _CHILD_TURNS or session in _CHILD_SESSIONS:
            scope, current, previous = 'child', session, None
        elif turn in _ROOT_TURNS and session:
            scope = 'root'
            current, previous = _bind(session, turn)
            if current is None:
                return
            del _ROOT_TURNS[turn]
        else:
            return
    if previous:
        _emit('session_continued', 'root', 'post_llm_call', current, continues=previous)
    cwd = _location(_text(kwargs.get('task_id'))) if scope == 'root' else None
    _emit('turn_completed', scope, 'post_llm_call', current, turn, cwd=cwd)

def _approval(event, native):
    def handler(**kwargs):
        # A smart approval is decided by an auxiliary model, not by the user. The turn_id
        # (not session_key, which can be a stale compression parent) ties it to its turn.
        if kwargs.get('surface') == 'smart':
            return
        turn = _text(kwargs.get('turn_id'))
        if not turn:
            return
        input_id = _text(kwargs.get('tool_call_id')) or _text(kwargs.get('pattern_key')) or 'approval'
        with _LOCK:
            if turn in _CHILD_TURNS:
                scope, session = 'child', None
            elif turn in _ROOT_TURNS and _ROOT['session']:
                scope, session = 'root', _ROOT['session']
            else:
                return
        _emit(event, scope, native, session, turn, input_id)
    return handler

def on_session_finalize(**kwargs):
    session = _text(kwargs.get('session_id'))
    with _LOCK:
        root = _ROOT['session']
        if not root or not session or (session != root and not _continues(root, session, None)):
            return
        _ROOT['session'] = None
        for bucket in (_ROOT_TURNS, _CHILD_TURNS, _CHILD_SESSIONS):
            bucket.clear()
    _emit('session_ended', 'root', 'on_session_finalize', root)

def register(ctx):
    ctx.register_hook('pre_llm_call', pre_llm_call)
    ctx.register_hook('post_llm_call', post_llm_call)
    ctx.register_hook('pre_approval_request', _approval('input_requested', 'pre_approval_request'))
    ctx.register_hook('post_approval_response', _approval('input_resolved', 'post_approval_response'))
    ctx.register_hook('on_session_finalize', on_session_finalize)
`;


/** Previous owned plugin sources, upgraded in place only on an exact match. */
export const PREVIOUS_HERMES_REMOTE_ATTENTION_PLUGIN = `import base64, json, os

def emit(event, scope, native, session_id=None, input_id=None):
    token = os.environ.get('CLANKER_REMOTE_ATTENTION_TOKEN')
    if not token or os.environ.get('CLANKER_REMOTE_ATTENTION_HARNESS') != 'hermes':
        return
    payload = dict(version=1, token=token, harness='hermes', event=event, scope=scope, nativeEvent=native)
    if isinstance(session_id, str) and session_id:
        payload['sessionId'] = session_id[:128]
    if input_id:
        payload['inputId'] = input_id
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

def lifecycle(event, native, input_id=None):
    def handler(**kwargs):
        # A smart approval is decided by an auxiliary model, not by the user.
        if input_id and kwargs.get('surface') == 'smart':
            return
        scope = 'child' if kwargs.get('parent_session_id') else 'root'
        emit(event, scope, native, kwargs.get('session_id'), input_id)
    return handler

def register(ctx):
    for hook, event, input_id in [('pre_llm_call', 'turn_started', None), ('post_llm_call', 'turn_completed', None),
                                  ('pre_approval_request', 'input_requested', 'approval'),
                                  ('post_approval_response', 'input_resolved', 'approval'),
                                  ('on_session_finalize', 'session_ended', None)]:
        ctx.register_hook(hook, lifecycle(event, hook, input_id))
`;

export const LEGACY_HERMES_REMOTE_ATTENTION_PLUGIN = `import base64, json, os

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

export const remote: HarnessRemoteAttention = {
  requiresNode: false,
  validate: `if (os.environ.get('HERMES_HOME') or os.environ.get('HERMES_PROFILE') or any(a.startswith('--profile') or a == '--ignore-user-config' for a in args)):
    sys.exit('Remote Hermes attention currently requires the default host profile')
`,
  configure: ``,
  plugin: () => ({ parts: ['.hermes', 'plugins', 'clanker-grid-remote-attention'],
    files: { 'plugin.yaml': 'name: clanker-grid-remote-attention\nversion: 1.0.0\ndescription: Clanker SSH lifecycle observer\n', '__init__.py': HERMES_REMOTE_ATTENTION_PLUGIN },
    upgradeFile: '__init__.py', legacyFiles: [LEGACY_HERMES_REMOTE_ATTENTION_PLUGIN, PREVIOUS_HERMES_REMOTE_ATTENTION_PLUGIN, PRE_SETTLEMENT_HERMES_REMOTE_ATTENTION_PLUGIN] }),
  enableCommand: { command: 'hermes', args: ['plugins', 'enable', 'clanker-grid-remote-attention'] },
};
