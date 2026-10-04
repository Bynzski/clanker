import type { HarnessRemoteSessions } from '../types';

export const remoteSessions: HarnessRemoteSessions = {
  discoveryOrder: 4, scan: String.raw`db = os.path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db')
if not os.path.lexists(db): return
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
            if in_scope(os.path.realpath(cwd)):
                emit(harness, sid, cwd, title or (preview if preview != '<conversation>' else ''), timestamp(modified, timestamp(user_time)))
                break
return
` };
