import type { HarnessRemoteSessions } from '../types';

export const remoteSessions: HarnessRemoteSessions = {
  command: { command: 'opencode', args: ['session', 'list', '--format', 'json', '--max-count', '4097'] },
  scan: String.raw`entries = json.loads(sys.stdin.read(1024*1024 + 1))
if not isinstance(entries, list) or len(entries) > 4096: raise ValueError('Invalid OpenCode session list')
for entry in entries:
    if not isinstance(entry, dict): raise ValueError('Invalid OpenCode session entry')
    emit(harness, entry.get('id'), entry.get('directory'), entry.get('title'), entry.get('updated', entry.get('created', 0)))
`,
};
