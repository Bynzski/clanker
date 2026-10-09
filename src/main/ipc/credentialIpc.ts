/**
 * Credential IPC Handlers
 *
 * Registers all credential-related IPC handlers. Extracted from main.ts per S2.5.
 */

import { ipcMain } from 'electron';
import {
  generateSshKey,
  readPublicKey,
  deleteSshKeyPair,
  savePat,
  restoreApprovedGitLabInstances,
  deletePat,
  getCredentialStatus,
  getGlobalCredentialStatus,
  configureSshForHost,
  checkSshKeyExists,
  type SavePatRequest,
} from '../credential';
import type { VcsProvider } from '../../shared/types/vcs';
import {
  CREDENTIAL_GENERATE_SSH_KEY,
  CREDENTIAL_GET_PUBLIC_KEY,
  CREDENTIAL_DELETE_SSH_KEY,
  CREDENTIAL_CHECK_EXISTS,
  CREDENTIAL_SAVE_PAT,
  CREDENTIAL_GET_PAT,
  CREDENTIAL_DELETE_PAT,
  CREDENTIAL_GET_STATUS,
  CREDENTIAL_GET_GLOBAL_STATUS,
  CREDENTIAL_CONFIGURE_SSH_HOST,
} from '../../shared/ipcChannels';

export function registerCredentialIpc(): void {
  restoreApprovedGitLabInstances();
  ipcMain.handle(CREDENTIAL_GENERATE_SSH_KEY, async () => {
    return generateSshKey();
  });

  ipcMain.handle(CREDENTIAL_GET_PUBLIC_KEY, async () => {
    return readPublicKey();
  });

  ipcMain.handle(CREDENTIAL_DELETE_SSH_KEY, async () => {
    return deleteSshKeyPair();
  });

  ipcMain.handle(CREDENTIAL_CHECK_EXISTS, async () => {
    return { exists: checkSshKeyExists() };
  });

  ipcMain.handle(CREDENTIAL_SAVE_PAT, async (_, request: SavePatRequest) => {
    return savePat(request);
  });

  // Deny the legacy channel too, including callers bypassing the preload API.
  ipcMain.handle(CREDENTIAL_GET_PAT, async () => {
    return { success: false, error: 'Stored tokens are available only to main-process provider requests.' };
  });

  ipcMain.handle(CREDENTIAL_DELETE_PAT, async (_, provider: VcsProvider) => {
    return deletePat(provider);
  });

  ipcMain.handle(CREDENTIAL_GET_STATUS, async (_, remoteName: string, remoteUrl: string, provider: VcsProvider) => {
    return getCredentialStatus(remoteName, remoteUrl, provider);
  });

  ipcMain.handle(CREDENTIAL_GET_GLOBAL_STATUS, async () => {
    return await getGlobalCredentialStatus();
  });

  ipcMain.handle(CREDENTIAL_CONFIGURE_SSH_HOST, async (_, hostname: string) => {
    return configureSshForHost(hostname);
  });
}
