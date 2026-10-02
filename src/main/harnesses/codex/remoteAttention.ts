import { CODEX_HOOK_EVENTS } from './attention';
import type { HarnessRemoteAttention } from '../types';

const EVENTS = JSON.stringify([...CODEX_HOOK_EVENTS]);

export const remote: HarnessRemoteAttention = {
  requiresNode: true,
  validate: `overrides = []
for index, arg in enumerate(args):
    if arg in ('-c', '--config') and index + 1 < len(args):
        overrides.append(args[index + 1])
    elif arg.startswith('--config='):
        overrides.append(arg[len('--config='):])
    elif arg.startswith('-c') and arg != '-c':
        overrides.append(arg[2:])
if any(a in ('-p', '--profile') or a.startswith('--profile=') or (a.startswith('-p') and a != '-p') for a in args) or any(re.search(r'(?:^|\\.)\\s*(?:hooks|profile)[.=]', value) for value in overrides):
    sys.exit('Remote attention cannot replace a Codex profile or hook configuration')
codex_events = '|'.join(${EVENTS})
codex_home = os.environ.get('CODEX_HOME') or os.path.join(home, '.codex')
for name, pattern in (('config.toml', r'^\\s*\\[hooks\\]|^\\s*\\[\\[?hooks\\.(?:' + codex_events + r')\\b|^\\s*profile\\s*='), ('hooks.json', '"(?:' + codex_events + ')"')):
    config_path = os.path.join(codex_home, name)
    if os.path.exists(config_path):
        with open(config_path) as config:
            value = config.read(1048577)
        if len(value) > 1048576 or re.search(pattern, value, re.M):
            sys.exit('Remote attention cannot replace the host Codex hook configuration')`,
  configure: `    interpreter = os.path.join(root, 'interpreter.mjs')
    for name in reversed(${EVENTS}):
        hook_command = 'node ' + shlex.quote(command) + ' ' + shlex.quote(interpreter) + ' ' + name
        args = ['-c', 'hooks.' + name + '=[{hooks=[{type="command",command=' + json.dumps(hook_command) + ',timeout=2}]}]'] + args`,
};
