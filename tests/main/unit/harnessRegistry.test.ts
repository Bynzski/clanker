import { buildSessionCommand } from '../../../src/main/sessionLaunch';
import { describe, expect, it } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';
import { findHarnessProvider, getHarnessProvider, getHarnessProviders, isHarnessId } from '../../../src/main/harnesses/registry';

describe('canonical harness registry', () => {
  it('registers every ID exactly once with stable identity', () => {
    const providers = getHarnessProviders();
    expect(providers.map((provider) => provider.descriptor.id)).toEqual(KNOWN_HARNESS_IDS);
    expect(new Set(providers).size).toBe(KNOWN_HARNESS_IDS.length);
    for (const id of KNOWN_HARNESS_IDS) expect(getHarnessProvider(id)).toBe(getHarnessProvider(id));
  });
  it('rejects raw unknown IDs including inherited object keys', () => {
    for (const value of ['unknown', 'constructor', '__proto__', '', null, 60]) {
      expect(isHarnessId(value)).toBe(false);
      expect(findHarnessProvider(value)).toBeUndefined();
    }
    // @ts-expect-error Lookup requires a validated HarnessId.
    expect(() => getHarnessProvider('unknown')).toThrow('Unknown harness');
  });
});

it('represents native, emulated and unsupported session operations honestly', () => {
  for (const id of ['codex', 'claude', 'opencode', 'pi', 'omp'] as const) {
    expect(getHarnessProvider(id).sessions?.resume?.support).toBe('native');
    expect(getHarnessProvider(id).sessions?.fork?.support).toBe('native');
  }
  expect(getHarnessProvider('agy').sessions?.fork).toMatchObject({ support: 'emulated', transports: ['local'] });
  expect(getHarnessProvider('hermes').sessions).toBeUndefined();
});

it('keeps serializable descriptors aligned with implemented AI commit capabilities', async () => {
  const { AI_COMMIT_HARNESS_IDS, HARNESS_DESCRIPTORS } = await import('../../../src/shared/harnessDescriptors');
  expect(getHarnessProviders().filter((provider) => provider.aiCommit).map((provider) => provider.descriptor.id)).toEqual(AI_COMMIT_HARNESS_IDS);
  for (const provider of getHarnessProviders()) {
    expect(provider.descriptor).toBe(HARNESS_DESCRIPTORS[provider.descriptor.id]);
    expect(structuredClone(provider.descriptor)).toEqual(provider.descriptor);
  }
});

it('implements usage only for the providers with a verified structured interface', () => {
  const withUsage = getHarnessProviders().filter((provider) => provider.usage).map((provider) => provider.descriptor.id);
  expect(withUsage).toEqual(['omp', 'hermes']);
  for (const id of ['codex', 'claude', 'opencode', 'pi', 'agy'] as const) expect(getHarnessProvider(id).usage).toBeUndefined();
});

it.each([
  ['codex', ['resume', 'native-id', '-m', 'model', '--extra'], ['fork', 'native-id', '-m', 'model', '--extra']],
  ['claude', ['--resume', 'native-id', '--model', 'model', '--extra'], ['--resume', 'native-id', '--fork-session', '--model', 'model', '--extra']],
  ['opencode', ['--session', 'native-id', '--extra'], ['--session', 'native-id', '--fork', '--extra']],
  ['pi', ['--session', '/store/session.jsonl', '--model', 'provider/model', '--extra'], ['--fork', '/store/session.jsonl', '--model', 'provider/model', '--extra']],
  ['omp', ['--resume', '/store/session.jsonl', '--model', 'model', '--extra'], ['--fork', '/store/session.jsonl', '--model', 'model', '--extra']],
  ['agy', ['--conversation', 'native-id', '--model', 'model', '--extra'], ['--conversation', 'native-id', '--model', 'model', '--extra']],
] as const)('preserves exact %s resume/fork invocation', (id, resume, fork) => {
  const session = { harness: id, id: 'native-id', title: 'title', cwd: '/ws', timestamp: 0, modelId: 'model', provider: 'provider', filePath: '/store/session.jsonl' };
  for (const transport of ['local', 'ssh'] as const) {
    expect(buildSessionCommand(session, { operation: 'resume', transport, userFlags: '--extra' })).toEqual({ command: id, args: [...resume] });
    if (id === 'agy' && transport === 'ssh') {
      expect(() => buildSessionCommand(session, { operation: 'fork', transport, userFlags: '--extra' })).toThrow(expect.objectContaining({ kind: 'unsupported' }));
    } else {
      expect(buildSessionCommand(session, { operation: 'fork', transport, userFlags: '--extra' })).toEqual({ command: id, args: [...fork] });
    }
  }
});

it('preserves launch metadata, environments and opaque reasoning flags for every harness', async () => {
  const { buildHarnessSpawnArgs, resolveHarnessSpawn } = await import('../../../src/main/harnessLaunch');
  for (const id of KNOWN_HARNESS_IDS) {
    const provider = getHarnessProvider(id);
    const config = { ...provider.launch, name: provider.descriptor.name, icon: provider.descriptor.legacyIcon };
    const args = buildHarnessSpawnArgs(config, 'model', '--reasoning high --effort max');
    expect(args).toEqual([provider.launch.modelArg, 'model', ...(id === 'hermes' ? ['--tui'] : []), '--reasoning', 'high', '--effort', 'max']);
    expect(resolveHarnessSpawn(provider.launch.command, args, '/wrapper')).toEqual({ spawnCmd: '/wrapper', spawnArgs: [id, ...args] });
  }
  expect(getHarnessProvider('opencode').launch.env).toEqual({ OPENCODE_PERMISSION: '{"bash":{"*":"allow"},"edit":"allow"}' });
  expect(getHarnessProvider('hermes').launch.localEnvironment?.('--yolo')).toEqual({ HERMES_YOLO_MODE: '1' });
  expect(getHarnessProvider('hermes').launch.localEnvironment?.('')).toEqual({ HERMES_YOLO_MODE: '' });
});

it('retains failure categories and native causes without claiming unsupported', async () => {
  const { classifyHarnessFailure, HarnessCapabilityError } = await import('../../../src/main/harnesses/types');
  const native = new Error('failed');
  expect(classifyHarnessFailure(native)).toMatchObject({ kind: 'command-failed', cause: native });
  const transport = Object.assign(new Error('SSH authentication failed'), { exitCode: 255 });
  expect(classifyHarnessFailure(transport, 'ssh')).toMatchObject({ kind: 'transport-failure', cause: transport });
  const command = Object.assign(new Error('host command failed'), { exitCode: 1 });
  expect(classifyHarnessFailure(command, 'ssh').kind).toBe('command-failed');
  expect(classifyHarnessFailure(new SyntaxError('invalid JSON')).kind).toBe('parse-failure');
  expect(classifyHarnessFailure(new Error('no such column: workspace_uris')).kind).toBe('storage-changed');
  const configured = new HarnessCapabilityError('not-configured', 'Authentication required', native);
  expect(classifyHarnessFailure(configured)).toBe(configured);
});

it('enforces operation transports at the canonical invocation boundary', async () => {
  const { buildSessionCommand } = await import('../../../src/main/sessionLaunch');
  const session = { harness: 'agy' as const, id: 'native-id', title: '', cwd: '/ws', timestamp: 0 };
  expect(buildSessionCommand(session, { operation: 'fork', transport: 'local' })).toEqual({ command: 'agy', args: ['--conversation', 'native-id'] });
  expect(() => buildSessionCommand(session, { operation: 'fork', transport: 'ssh' })).toThrow(expect.objectContaining({ kind: 'unsupported' }));
  expect(() => buildSessionCommand({ ...session, harness: 'hermes' }, { operation: 'resume', transport: 'local' })).toThrow(expect.objectContaining({ kind: 'unsupported' }));
});
