import type { HarnessRemoteAttention } from '../types';

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
if any(a in ('-p', '--profile') or a.startswith('--profile=') or (a.startswith('-p') and a != '-p') for a in args) or any(re.search(r'(?:^|\\.)\\s*(?:notify|profile)\\s*=', value) for value in overrides):
    sys.exit('Remote attention cannot replace a Codex profile or notify command')
config_path = os.path.join(os.environ.get('CODEX_HOME') or os.path.join(home, '.codex'), 'config.toml')
if os.path.exists(config_path):
    with open(config_path) as config:
        value = config.read(1048577)
    if len(value) > 1048576 or re.search(r'^\\s*(?:notify|profile)\\s*=', value, re.M):
        sys.exit('Remote attention cannot replace the host Codex notify command')`,
  configure: `    args = ['-c', 'notify=' + json.dumps(['node', command])] + args`,
};
