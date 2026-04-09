/**
 * Credential IPC Handlers Tests
 *
 * Tests for the credential IPC module. Verifies that all credential handlers
 * are properly registered and delegate correctly to the credential service.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock the credential module
vi.mock('../../../src/main/credential', () => ({
  generateSshKey: vi.fn<() => Promise<{ success: boolean; publicKey?: string; fingerprint?: string; error?: string }>>(),
  readPublicKey: vi.fn<() => { success: boolean; publicKey?: string; error?: string }>(),
  deleteSshKeyPair: vi.fn<() => Promise<{ success: boolean; error?: string }>>(),
  savePat: vi.fn<() => Promise<{ success: boolean; error?: string }>>(),
  getPat: vi.fn<() => { success: boolean; token?: string; error?: string }>(),
  deletePat: vi.fn<() => { success: boolean; error?: string }>(),
  getCredentialStatus: vi.fn<() => Promise<import('../../../src/main/credential/types').CredentialStatus>>(),
  getGlobalCredentialStatus: vi.fn<() => Promise<import('../../../src/main/credential/types').GlobalCredentialStatus>>(),
  configureSshForHost: vi.fn<() => Promise<{ success: boolean; error?: string }>>(),
  checkSshKeyExists: vi.fn<() => boolean>(),
}));

// Import after mocking
import { ipcMain } from 'electron';
import {
  generateSshKey,
  readPublicKey,
  deleteSshKeyPair,
  savePat,
  getPat,
  deletePat,
  getCredentialStatus,
  getGlobalCredentialStatus,
  configureSshForHost,
  checkSshKeyExists,
} from '../../../src/main/credential';
import { registerCredentialIpc } from '../../../src/main/ipc/credentialIpc';
import type { SavePatRequest } from '../../../src/main/credential';
import type { VcsProvider } from '../../../src/shared/types/vcs';

describe('registerCredentialIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all credential IPC channels', () => {
    const expectedChannels = [
      'credential:generate-ssh-key',
      'credential:get-public-key',
      'credential:delete-ssh-key',
      'credential:check-exists',
      'credential:save-pat',
      'credential:get-pat',
      'credential:delete-pat',
      'credential:get-status',
      'credential:get-global-status',
      'credential:configure-ssh-host',
    ];

    registerCredentialIpc();

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(expectedChannels.length);
    expectedChannels.forEach((channel) => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('credential:generate-ssh-key calls generateSshKey', async () => {
    const mockResult = { success: true, publicKey: 'test-key' };
    vi.mocked(generateSshKey).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:generate-ssh-key'
    )?.[1] as () => Promise<typeof mockResult>;
    const result = await handler();

    expect(generateSshKey).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResult);
  });

  test('credential:get-public-key calls readPublicKey', async () => {
    const mockResult = { success: true, publicKey: 'ssh-ed25519 AAAA...' };
    vi.mocked(readPublicKey).mockReturnValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:get-public-key'
    )?.[1] as () => typeof mockResult;
    const result = await handler();

    expect(readPublicKey).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResult);
  });

  test('credential:delete-ssh-key calls deleteSshKeyPair', async () => {
    const mockResult = { success: true };
    vi.mocked(deleteSshKeyPair).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:delete-ssh-key'
    )?.[1] as () => Promise<typeof mockResult>;
    const result = await handler();

    expect(deleteSshKeyPair).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResult);
  });

  test('credential:check-exists calls checkSshKeyExists', async () => {
    vi.mocked(checkSshKeyExists).mockReturnValue(true);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:check-exists'
    )?.[1] as () => { exists: boolean };
    const result = await handler();

    expect(checkSshKeyExists).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ exists: true });
  });

  test('credential:save-pat calls savePat with request', async () => {
    const mockRequest: SavePatRequest = { provider: 'github', token: 'test-token' };
    const mockResult = { success: true };
    vi.mocked(savePat).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:save-pat'
    )?.[1] as (_: unknown, req: SavePatRequest) => Promise<typeof mockResult>;
    const result = await handler(null, mockRequest);

    expect(savePat).toHaveBeenCalledWith(mockRequest);
    expect(result).toEqual(mockResult);
  });

  test('credential:get-pat calls getPat with provider', async () => {
    const mockResult = { success: true, token: 'test-token' };
    vi.mocked(getPat).mockReturnValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:get-pat'
    )?.[1] as (_: unknown, provider: VcsProvider) => typeof mockResult;
    const result = await handler(null, 'github' as VcsProvider);

    expect(getPat).toHaveBeenCalledWith('github');
    expect(result).toEqual(mockResult);
  });

  test('credential:delete-pat calls deletePat with provider', async () => {
    const mockResult = { success: true };
    vi.mocked(deletePat).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:delete-pat'
    )?.[1] as (_: unknown, provider: VcsProvider) => typeof mockResult;
    const result = await handler(null, 'gitlab' as VcsProvider);

    expect(deletePat).toHaveBeenCalledWith('gitlab');
    expect(result).toEqual(mockResult);
  });

  test('credential:get-status calls getCredentialStatus with args', async () => {
    const mockResult: import('../../../src/main/credential/types').CredentialStatus = {
      remoteName: 'origin',
      provider: 'github',
      hasSshKey: true,
      hasPat: false,
      credentialHelper: null,
    };
    vi.mocked(getCredentialStatus).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:get-status'
    )?.[1] as (_: unknown, remoteName: string, remoteUrl: string, provider: VcsProvider) => Promise<typeof mockResult>;
    const result = await handler(null, 'origin', 'https://github.com/user/repo', 'github' as VcsProvider);

    expect(getCredentialStatus).toHaveBeenCalledWith('origin', 'https://github.com/user/repo', 'github');
    expect(result).toEqual(mockResult);
  });

  test('credential:get-global-status calls getGlobalCredentialStatus', async () => {
    const mockResult: import('../../../src/main/credential/types').GlobalCredentialStatus = {
      defaultSshKeyPath: '/path/to/key',
      hasDefaultSshKey: true,
      storedPats: [],
      credentialHelpers: {},
    };
    vi.mocked(getGlobalCredentialStatus).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:get-global-status'
    )?.[1] as () => Promise<typeof mockResult>;
    const result = await handler();

    expect(getGlobalCredentialStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResult);
  });

  test('credential:configure-ssh-host calls configureSshForHost with hostname', async () => {
    const mockResult = { success: true };
    vi.mocked(configureSshForHost).mockResolvedValue(mockResult);

    registerCredentialIpc();
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'credential:configure-ssh-host'
    )?.[1] as (_: unknown, hostname: string) => Promise<typeof mockResult>;
    const result = await handler(null, 'github.com');

    expect(configureSshForHost).toHaveBeenCalledWith('github.com');
    expect(result).toEqual(mockResult);
  });
});
