import { CLAUDE_HOOK_EVENTS } from './attention';
import type { HarnessRemoteAttention } from '../types';

export const remote: HarnessRemoteAttention = {
  requiresNode: true,
  validate: `if any(a in ('--bare', '--safe-mode') or a.startswith('--settings') for a in args):
    sys.exit('Remote attention cannot replace custom Claude settings')
`,
  configure: `    interpreter = os.path.join(root, 'interpreter.mjs')
    settings = {'hooks': {name: [{'hooks': [{'type': 'command', 'command': 'node ' + shlex.quote(command) + ' ' + shlex.quote(interpreter) + ' ' + name, 'timeout': 2}]}] for name in ${JSON.stringify([...CLAUDE_HOOK_EVENTS])}}}
    settings_path = os.path.join(root, 'claude-settings.json')
    write_resource('claude-settings.json', json.dumps(settings))
    args += ['--settings', settings_path]`,
};
