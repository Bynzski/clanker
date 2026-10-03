import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const { mockHandle, mockOn } = vi.hoisted(() => ({ mockHandle: vi.fn(), mockOn: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle, on: mockOn } }));

import { registerAccountIpc } from '../../../../src/main/ipc/accountIpc';
import {
  ALL_IPC_CHANNELS, HARNESS_ACCOUNTS_ADD_START, HARNESS_ACCOUNTS_AUTH_CANCEL, HARNESS_ACCOUNTS_AUTH_STATE, HARNESS_ACCOUNTS_LIST,
  HARNESS_ACCOUNTS_RECONNECT, HARNESS_ACCOUNTS_REMOVE, HARNESS_ACCOUNTS_RENAME, HARNESS_ACCOUNTS_SELECT,
} from '../../../../src/shared/ipcChannels';
import { HARNESS_DESCRIPTORS, ACCOUNT_HARNESS_IDS } from '../../../../src/shared/harnessDescriptors';
import { getHarnessProviders } from '../../../../src/main/harnesses/registry';
import { addAccount, createHarness, type Harness } from './accountFixtures';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
let h: Harness;
beforeEach(() => {
  handlers.clear();
  mockHandle.mockReset().mockImplementation((channel: string, handler: Handler) => { handlers.set(channel, handler); });
  h = createHarness();
  registerAccountIpc({ getAccountService: () => h.service });
});
afterEach(() => { fs.rmSync(h.root, { recursive: true, force: true }); });
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('account IPC', () => {
  it('registers every account channel (handlers plus the one-way auth-state event)', () => {
    for (const channel of [HARNESS_ACCOUNTS_LIST, HARNESS_ACCOUNTS_SELECT, HARNESS_ACCOUNTS_ADD_START, HARNESS_ACCOUNTS_RECONNECT, HARNESS_ACCOUNTS_AUTH_CANCEL, HARNESS_ACCOUNTS_REMOVE, HARNESS_ACCOUNTS_RENAME]) {
      expect(handlers.has(channel)).toBe(true);
      expect(ALL_IPC_CHANNELS).toContain(channel);
    }
    expect(mockOn).toHaveBeenCalledWith(HARNESS_ACCOUNTS_AUTH_STATE, expect.any(Function));
    expect(ALL_IPC_CHANNELS).toContain(HARNESS_ACCOUNTS_AUTH_STATE);
  });

  it('rejects hostile inputs with fixed text and no side effects', async () => {
    const account = await addAccount(h, 'codex', 'W');
    for (const value of [null, undefined, 42, {}, [], { path: '/etc' }]) {
      await expect(call(HARNESS_ACCOUNTS_LIST, value, 'codex')).rejects.toThrow('Invalid account request');
      await expect(call(HARNESS_ACCOUNTS_LIST, 'local', value)).rejects.toThrow(/not available for this harness/);
      await expect(call(HARNESS_ACCOUNTS_SELECT, 'local', 'codex', value)).rejects.toThrow('Invalid account request');
      await expect(call(HARNESS_ACCOUNTS_REMOVE, 'local', 'codex', value)).rejects.toThrow();
      await expect(call(HARNESS_ACCOUNTS_AUTH_CANCEL, value)).rejects.toThrow('Invalid account request');
    }
    // A path-like string is only ever an opaque environment key: it can never resolve to anything local.
    await expect(call(HARNESS_ACCOUNTS_ADD_START, '../../.codex', 'codex')).rejects.toThrow('not available for SSH environments');
    await expect(call(HARNESS_ACCOUNTS_REMOVE, 'local', 'codex', '../../.codex')).rejects.toThrow('not available for this harness');
    expect(h.service.managedAccounts('local').map((r) => r.id)).toEqual([account.id]);
    expect(fs.readdirSync(path.join(h.root, 'harness-accounts', 'codex'))).toEqual([account.id]);
  });

  it('cannot invent, cross-select or delete the default account', async () => {
    const account = await addAccount(h, 'codex', 'W');
    await expect(call(HARNESS_ACCOUNTS_SELECT, 'local', 'claude', account.id)).rejects.toThrow('not available for this harness');
    await expect(call(HARNESS_ACCOUNTS_SELECT, 'ssh-1', 'codex', account.id)).rejects.toThrow('not available for this harness');
    await expect(call(HARNESS_ACCOUNTS_SELECT, 'local', 'codex', `acct_${'7'.repeat(32)}`)).rejects.toThrow('not available for this harness');
    await expect(call(HARNESS_ACCOUNTS_REMOVE, 'local', 'codex', 'default')).rejects.toThrow('default account cannot be removed');
    expect(h.service.getSelectedAccountId('local', 'codex')).toBe('default');
  });

  it('extra renderer arguments (paths, env maps, auth URLs, targets) are ignored by every handler', async () => {
    const result = await call(HARNESS_ACCOUNTS_ADD_START, 'local', 'codex', 'Label', { CODEX_HOME: '/tmp/evil' }, '/etc', 'ssh://host') as { flowId: string };
    await vi.waitFor(() => expect(h.service.managedAccounts('local')).toHaveLength(1));
    const [record] = h.service.managedAccounts('local');
    expect(h.homes.resolve('codex', record.id).startsWith(fs.realpathSync(path.join(h.root, 'harness-accounts')))).toBe(true);
    expect(result.flowId).toMatch(/^flow_/);
    expect(JSON.stringify(h.capabilities.codex.authenticate.mock.calls)).not.toContain('evil');
  });

  it('SSH add is an explicit unsupported state and touches nothing locally', async () => {
    await expect(call(HARNESS_ACCOUNTS_ADD_START, 'ssh-1', 'claude')).rejects.toThrow('Managed accounts are not available for SSH environments yet.');
    const list = await call(HARNESS_ACCOUNTS_LIST, 'ssh-1', 'claude') as { managedSupported: boolean; unsupportedReason: string };
    expect(list.managedSupported).toBe(false);
    expect(fs.existsSync(path.join(h.root, 'harness-accounts'))).toBe(false);
  });

  it('only fixed product messages cross IPC: unexpected internal errors are collapsed', async () => {
    vi.spyOn(h.service, 'list').mockImplementation(() => { throw new Error('ENOENT /home/me/.codex/auth.json token=sk-LEAK'); });
    const error = await call(HARNESS_ACCOUNTS_LIST, 'local', 'codex').catch((e: Error) => e);
    expect((error as Error).message).toBe('The account operation failed.');
  });

  it('projections carry no auth material, paths or provider identifiers', async () => {
    h.capabilities.codex.authenticate.mockImplementationOnce(async (context) => {
      context.openUrl('https://auth.example.test/?state=SECRET-STATE');
      return { email: 'me@example.test', plan: 'Plus' };
    });
    await addAccount(h, 'codex', 'W');
    const list = await call(HARNESS_ACCOUNTS_LIST, 'local', 'codex');
    const text = JSON.stringify([list, h.authEvents]);
    expect(text).not.toMatch(/SECRET-STATE|https?:\/\/|harness-accounts|\/tmp|CODEX_HOME|auth\.json|token/i);
    expect(JSON.stringify(h.storage.state)).not.toMatch(/SECRET-STATE|https?:\/\//i);
  });
});

describe('architecture', () => {
  it('only Codex and Claude advertise accounts, and metadata and implementation cannot drift', () => {
    expect([...ACCOUNT_HARNESS_IDS]).toEqual(['codex', 'claude']);
    for (const provider of getHarnessProviders()) {
      expect('accounts' in provider.descriptor).toBe(Boolean(provider.accounts));
      expect(Boolean((HARNESS_DESCRIPTORS as Record<string, { accounts?: unknown }>)[provider.descriptor.id].accounts)).toBe(Boolean(provider.accounts));
    }
  });

  it('account state stays out of the renderer-writable settings map', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../../../../src/shared/types/store.ts'), 'utf8');
    expect(schema).not.toMatch(/account/i);
    const defaultsValidation = fs.readFileSync(path.resolve(__dirname, '../../../../src/main/harnessDefaultsValidation.ts'), 'utf8');
    expect(defaultsValidation).not.toMatch(/accountId|CODEX_HOME|CLAUDE_CONFIG_DIR/);
  });

  it('shared orchestration names no provider variable or harness (provider code owns those)', () => {
    const root = path.resolve(__dirname, '../../../../src/main');
    const shared = ['accounts/harnessAccountService.ts', 'accounts/accountHomes.ts', 'accounts/accountExecution.ts', 'ipc/accountIpc.ts', 'ipc/sessionIpc.ts', 'ipc/terminalIpc.ts', 'usage/harnessUsageService.ts', 'sessionHistory.ts'];
    for (const file of shared) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      expect(source, file).not.toMatch(/CODEX_HOME|CLAUDE_CONFIG_DIR/);
      expect(source, file).not.toMatch(/case 'codex'|case 'claude'/);
    }
    for (const [file, variable] of [['harnesses/codex/accounts.ts', 'CODEX_HOME'], ['harnesses/claude/accounts.ts', 'CLAUDE_CONFIG_DIR']]) {
      expect(fs.readFileSync(path.join(root, file), 'utf8')).toContain(variable);
    }
  });

  it('the preload account bridge takes only opaque IDs, a harness name and a label', () => {
    const preload = fs.readFileSync(path.resolve(__dirname, '../../../../src/main/preload.ts'), 'utf8');
    const bridge = preload.split('\n').filter((line) => /HarnessAccount/.test(line) && line.includes('=>') && !line.includes('ipcRenderer.on')).join('\n');
    expect(bridge).toContain('listHarnessAccounts');
    const parameters = [...bridge.matchAll(/\(([^)]*)\) =>/g)].flatMap((match) => match[1].split(',').map((part) => part.trim().split(/[?:]/)[0])).filter(Boolean);
    expect(new Set(parameters)).toEqual(new Set(['environmentId', 'harness', 'accountId', 'label', 'flowId', 'callback', '_event', 'data']));
  });
});
