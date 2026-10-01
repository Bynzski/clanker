import type { HarnessRemoteAttention } from '../types';

export const remote: HarnessRemoteAttention = {
  requiresNode: true,
  validate: `if '--no-extensions' in args:
    sys.exit('Remote attention requires harness extensions')
`,
  configure: `    args += ['--extension', os.path.join(root, 'pi.ts')]`,
};
