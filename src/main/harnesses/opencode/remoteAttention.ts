import { SOURCE } from './attention';
import type { HarnessRemoteAttention } from '../types';

export const remote: HarnessRemoteAttention = {
  resources: (observer: string) => ({ 'opencode/observer.mjs': observer, 'opencode/plugins/clanker-attention.js': SOURCE }),
  environmentKeys: ['OPENCODE_CONFIG_DIR', 'CLANKER_ATTENTION_SESSION_ID'],
  requiresNode: false,
  validate: `if (os.environ.get('OPENCODE_CONFIG_DIR') or '--pure' in args or '--attach' in args or any(a.startswith('--attach=') for a in args)):
    sys.exit('Remote attention cannot replace custom OpenCode configuration or observe an attached server')
`,
  configure: `    env['OPENCODE_CONFIG_DIR'] = os.path.join(root, 'opencode')
    if root_session_id:
        env['CLANKER_ATTENTION_SESSION_ID'] = root_session_id`,
};
