import { jsonlScan } from '../remoteSessionSpec';
import type { HarnessRemoteSessions } from '../types';

export const remoteSessions: HarnessRemoteSessions = {
  scan: jsonlScan({
  store: '.codex/sessions',
  identity: String.raw`        if kind == 'session_meta' and isinstance(payload, dict):
            sid, cwd = (text(payload.get('id')), text(payload.get('cwd')))
            model, provider = (text(payload.get('model')), text(payload.get('model_provider')))`,
  events: String.raw`        if kind == 'response_item' and isinstance(payload, dict) and (payload.get('role') == 'user') and (not title):
            content = payload.get('content', [])
            if isinstance(content, list):
                title = '\n'.join((text(part.get('text')) for part in content if isinstance(part, dict)))[:120]
        if kind == 'event_msg' and isinstance(payload, dict) and (payload.get('type') == 'user_message') and (not title):
            title = text(payload.get('message'))[:120]
        if kind == 'model_change':
            model = text(event.get('model')) or model
            provider = text(event.get('provider')) or provider`,
  prelude: String.raw`index = {}
index_file = os.path.join(home, '.codex', 'session_index.jsonl')
if os.path.lexists(index_file):
    for entry in records(index_file, 4*1024*1024):
        if text(entry.get('id')): index[entry['id']] = entry`,
  finalize: String.raw`    indexed = index.get(sid, {})
    title = text(indexed.get('thread_name')).strip() or title
    when = timestamp(indexed.get('updated_at'), when)`,
  }),
};
