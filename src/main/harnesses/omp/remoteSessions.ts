import { jsonlScan } from '../remoteSessionSpec';
import type { HarnessRemoteSessions } from '../types';

export const remoteSessions: HarnessRemoteSessions = {
  discoveryOrder: 3,
  fileStore: '.omp/agent/sessions',
  scan: jsonlScan({
  store: '.omp/agent/sessions',
  identity: String.raw`        if kind == 'session':
            sid, cwd = (text(event.get('id')), text(event.get('cwd')))
            when = timestamp(event.get('timestamp'), when)`,
  events: String.raw`        if kind == 'model_change':
            model = text(event.get('model')) or model
            provider = text(event.get('provider')) or provider
        if kind == 'title':
            title = text(event.get('title')).strip()[:120] or title`,
  fileTarget: true,
  }),
};
