import { jsonlScan } from '../remoteSessionSpec';
import type { HarnessRemoteSessions } from '../types';

export const remoteSessions: HarnessRemoteSessions = {
  fileStore: '.pi/agent/sessions',
  scan: jsonlScan({
  store: '.pi/agent/sessions',
  identity: String.raw`        if kind == 'session':
            sid, cwd = (text(event.get('id')), text(event.get('cwd')))
            when = timestamp(event.get('timestamp'), when)`,
  events: String.raw`        if kind == 'model_change':
            model = text(event.get('modelId')) or model
            provider = text(event.get('provider')) or provider`,
  fileTarget: true,
  }),
};
