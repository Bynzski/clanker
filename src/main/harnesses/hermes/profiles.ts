import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isValidHarnessProfileName } from '../../../shared/harnessProfiles';
import { requireSuccess, type HarnessCommandExecutor, type HarnessCommandRequest } from '../commandExecution';
import { classifyHarnessFailure, HarnessCapabilityError, type HarnessProfilesCapability } from '../types';

// Assistants profiles are local-only in this release, so canonical homes are resolved with the main
// process's own filesystem APIs; no external `node` executable is needed. Only path metadata is
// inspected: no Hermes config, credential, database or conversation file is ever read.
const PROBE_SELECTOR_KEYS = ['HERMES_CONFIG', 'HERMES_ENV', 'HERMES_CONFIG_PATH', 'HERMES_ENV_PATH',
  'HERMES_PROFILE_NAME', 'HERMES_PROFILE', 'HERMES_RESUME', 'HERMES_YOLO_MODE',
  'TERMINAL_CWD', 'TERMINAL_ENV', 'TERMINAL_BACKEND', 'HERMES_TERMINAL_BACKEND'] as const;
const SELECTOR_KEYS = [...PROBE_SELECTOR_KEYS, 'HERMES_HOME'] as const;

function validateName(name: string): void {
  if (!isValidHarnessProfileName(name)) {
    throw new HarnessCapabilityError('parse-failure', 'Invalid Hermes profile name');
  }
}

async function probe(executor: HarnessCommandExecutor, request: HarnessCommandRequest): Promise<string> {
  try {
    return requireSuccess(await executor.run({ ...request, timeoutMs: 5000, maxOutputBytes: 32768 }), 'Hermes profile probe').replace(/\r?\n$/, '');
  } catch (error) {
    throw new HarnessCapabilityError(classifyHarnessFailure(error).kind, 'Hermes profile probe failed');
  }
}

function nativePath(value: string): typeof path.posix {
  const paths = /^[A-Za-z]:[\\/]|^\\\\[^\\]+\\[^\\]+/.test(value) ? path.win32 : path.posix;
  if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) || !paths.isAbsolute(value)
    || value.split(paths === path.win32 ? /[\\/]/ : /\//).some((part) => part === '.' || part === '..')) {
    throw new HarnessCapabilityError('parse-failure', 'Invalid Hermes native path');
  }
  return paths;
}

function configHome(config: string): string {
  const paths = nativePath(config);
  if (paths.basename(config) !== 'config.yaml') throw new HarnessCapabilityError('parse-failure', 'Invalid Hermes config path');
  return paths.dirname(config);
}

async function canonicalHome(home: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(home);
    if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory');
  } catch {
    // Deliberately generic: raw fs errors embed host paths and must not reach renderer-visible state.
    throw new HarnessCapabilityError('command-failed', 'Hermes profile directory is unavailable');
  }
  nativePath(canonical);
  return canonical;
}

export const hermesProfiles: HarnessProfilesCapability = {
  probeUnsetEnvironmentKeys: PROBE_SELECTOR_KEYS,
  async resolve(executor, name) {
    validateName(name);
    const config = await probe(executor, { command: 'hermes', args: ['-p', name, 'config', 'path'] });
    const selectedHome = configHome(config);
    const backend = await probe(executor, { command: 'hermes', args: ['-p', name, 'config', 'get', 'terminal.backend'] });
    if (backend !== 'local') throw new HarnessCapabilityError('unsupported', 'Hermes profiles require the local terminal backend');
    const help = (await probe(executor, { command: 'hermes', args: ['-p', name, '--help'] })).replace(/\u001b\[[0-9;]*m/g, '');
    if (!/(?:^|[\s,])--in(?=[\s,=]|$)/.test(help) || !/(?:^|[\s,])--tui(?=[\s,=]|$)/.test(help)) {
      throw new HarnessCapabilityError('unsupported', 'Hermes CLI does not support the required launch flags');
    }
    // A symlinked named home's canonical target may be outside the native root.
    // Discover the root via the public default-profile CLI, never infer it from that target.
    const rootConfig = name === 'default' ? config
      : await probe(executor, { command: 'hermes', args: ['-p', 'default', 'config', 'path'] });
    const rootHome = await canonicalHome(configHome(rootConfig));
    const home = name === 'default' ? rootHome : await canonicalHome(selectedHome);
    return { name, label: name, home, rootHome };
  },
  async discover(executor) {
    const output = await probe(executor, { command: 'hermes', args: ['profile', 'list'] });
    const lines = output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    // Version-specific native table, not a stable API. Unknown versions fail closed;
    // callers may offer manual name selection through resolve(), never guessed defaults.
    const invalidTable = () => new HarnessCapabilityError('parse-failure', 'Incompatible Hermes profile table; select a profile by name');
    if (!/^Profile\s+Model\s+Gateway\s+Alias\s+Distribution$/.test(lines[0] ?? '')) throw invalidTable();
    if (!/^[─\s]+$/.test(lines[1] ?? '') || lines.length < 2 || lines.length > 34) throw invalidTable();
    const names = lines.slice(2).map((line) => {
      const cells = line.replace(/^◆\s*/, '').split(/\s{2,}/);
      if (cells.length !== 5) throw invalidTable();
      validateName(cells[0]);
      return cells[0];
    });
    if (new Set(names).size !== names.length) throw invalidTable();
    const profiles = [];
    for (const name of names) profiles.push(await hermesProfiles.resolve(executor, name));
    return profiles;
  },
  buildLaunch(profile, cwd) {
    validateName(profile.name);
    nativePath(profile.home);
    const rootHome = profile.rootHome ?? (profile.name === 'default' ? profile.home : undefined);
    if (!rootHome) throw new HarnessCapabilityError('not-configured', 'Hermes profile root must be re-resolved');
    nativePath(rootHome);
    nativePath(cwd);
    return {
      command: 'hermes', args: ['-p', profile.name, '--tui', '--in', cwd],
      env: { HERMES_HOME: rootHome, HERMES_PROFILE_NAME: profile.name, TERMINAL_CWD: cwd,
        TERMINAL_ENV: 'local', TERMINAL_BACKEND: 'local', HERMES_TERMINAL_BACKEND: 'local' },
      unsetEnvironmentKeys: SELECTOR_KEYS,
    };
  },
};
