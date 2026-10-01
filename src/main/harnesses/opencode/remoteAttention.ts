import type { HarnessRemoteAttention } from '../types';

export const remote: HarnessRemoteAttention = {
  requiresNode: false,
  validate: `if (os.environ.get('OPENCODE_CONFIG_DIR') or '--pure' in args or '--attach' in args or any(a.startswith('--attach=') for a in args)):
    sys.exit('Remote attention cannot replace custom OpenCode configuration or observe an attached server')
`,
  configure: `    env['OPENCODE_CONFIG_DIR'] = os.path.join(root, 'opencode')`,
};
