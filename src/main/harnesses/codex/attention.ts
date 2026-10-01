import { localAttention, hookNodeExecutable } from '../localAttention';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';


export const local = localAttention(({ args, env, files: adapterFiles, platform }) => {
    const configPath = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    if (/^\s*notify\s*=/m.test(config)
      || args.some((arg) => /(?:^|\.)notify\s*=/.test(arg) || arg === '-p' || arg === '--profile')) return null;
    const configArgs = ['-c', `notify=${JSON.stringify([hookNodeExecutable(platform), adapterFiles.command])}`];
    const subcommandIndex = args.findIndex((arg) => arg === 'resume' || arg === 'fork');
    return { args: subcommandIndex < 0
      ? [...configArgs, ...args]
      : [...args.slice(0, subcommandIndex), ...configArgs, ...args.slice(subcommandIndex)], env: {} };

});
