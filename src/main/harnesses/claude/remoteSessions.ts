import { jsonlScan } from '../remoteSessionSpec';
import type { HarnessRemoteSessions } from '../types';

export const remoteSessions: HarnessRemoteSessions = {
  discoveryOrder: 1,
  scan: jsonlScan({
  store: '.claude/projects',
  identity: String.raw`        cwd = cwd or text(event.get('cwd'))
        sid = os.path.basename(file)[:-6]`,
  events: String.raw`        if isinstance(message, dict) and kind == 'assistant': model = text(message.get('model')) or model
        if kind == 'model_change':
            model = text(event.get('model')) or model
            provider = text(event.get('provider')) or provider`,
  }),
};
