import type { HarnessRemoteAttention } from '../types';

export const remote: HarnessRemoteAttention = {
  requiresNode: true,
  validate: `if any(a in ('--bare', '--safe-mode') or a.startswith('--settings') for a in args):
    sys.exit('Remote attention cannot replace custom Claude settings')
`,
  configure: `    hook = {'hooks': [{'type': 'command', 'command': 'node ' + shlex.quote(command), 'timeout': 2}]}
    settings = {'hooks': {name: [hook] for name in ['UserPromptSubmit', 'Stop', 'PostToolUse', 'Notification', 'SessionEnd']}}
    settings_path = os.path.join(root, 'claude-settings.json')
    write_resource('claude-settings.json', json.dumps(settings))
    args += ['--settings', settings_path]`,
};
