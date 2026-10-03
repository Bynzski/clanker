import { ipcMain } from 'electron';
import {
  HARNESS_ACCOUNTS_ADD_START,
  HARNESS_ACCOUNTS_AUTH_CANCEL,
  HARNESS_ACCOUNTS_AUTH_STATE,
  HARNESS_ACCOUNTS_LIST,
  HARNESS_ACCOUNTS_RECONNECT,
  HARNESS_ACCOUNTS_REMOVE,
  HARNESS_ACCOUNTS_RENAME,
  HARNESS_ACCOUNTS_SELECT,
} from '../../shared/ipcChannels';
import { HarnessAccountError, type HarnessAccountService } from '../accounts/harnessAccountService';

export interface RegisterAccountIpcDeps {
  getAccountService: () => HarnessAccountService;
}

/**
 * Narrow account IPC. Every argument is a plain string validated by the service; the renderer can
 * never supply a path, token, SSH target, auth URL or environment map. Only fixed product messages
 * cross back: anything else collapses to a generic error.
 */
async function safely<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(error instanceof HarnessAccountError ? error.message : 'The account operation failed.');
  }
}

export function registerAccountIpc(deps: RegisterAccountIpcDeps): void {
  const service = () => deps.getAccountService();
  ipcMain.handle(HARNESS_ACCOUNTS_LIST, (_event, environmentId: unknown, harness: unknown) =>
    safely(() => service().list(environmentId, harness)));
  ipcMain.handle(HARNESS_ACCOUNTS_SELECT, (_event, environmentId: unknown, harness: unknown, accountId: unknown) =>
    safely(() => service().select(environmentId, harness, accountId)));
  ipcMain.handle(HARNESS_ACCOUNTS_ADD_START, (_event, environmentId: unknown, harness: unknown, label?: unknown) =>
    safely(() => service().startAdd(environmentId, harness, label)));
  ipcMain.handle(HARNESS_ACCOUNTS_RECONNECT, (_event, environmentId: unknown, harness: unknown, accountId: unknown) =>
    safely(() => service().reconnect(environmentId, harness, accountId)));
  ipcMain.handle(HARNESS_ACCOUNTS_AUTH_CANCEL, (_event, flowId: unknown) =>
    safely(() => service().cancelAuth(flowId)));
  ipcMain.handle(HARNESS_ACCOUNTS_REMOVE, (_event, environmentId: unknown, harness: unknown, accountId: unknown) =>
    safely(() => service().remove(environmentId, harness, accountId)));
  ipcMain.handle(HARNESS_ACCOUNTS_RENAME, (_event, environmentId: unknown, harness: unknown, accountId: unknown, label: unknown) =>
    safely(() => service().rename(environmentId, harness, accountId, label)));
  // Main -> renderer progress events; registered so channel completeness can be verified.
  ipcMain.on(HARNESS_ACCOUNTS_AUTH_STATE, () => { });
}
