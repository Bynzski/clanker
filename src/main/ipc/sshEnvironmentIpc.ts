import { ipcMain } from 'electron';
import type Store from 'electron-store';
import type { StoreSchema } from '../../shared/types/store';
import type { EnvironmentManager } from '../environment/environmentManager';
import { WorkspacePersistenceService } from '../workspacePersistence';
import {
  SSH_ENVIRONMENT_LIST,
  SSH_ENVIRONMENT_SAVE,
  SSH_ENVIRONMENT_DELETE,
  SSH_ENVIRONMENT_TEST,
  GET_ENVIRONMENT_HARNESS_OPTIONS,
} from '../../shared/ipcChannels';

export interface RegisterSshEnvironmentIpcDeps {
  getStore: () => Store<StoreSchema>;
  getEnvironmentManager: () => EnvironmentManager;
}

export function registerSshEnvironmentIpc(deps: RegisterSshEnvironmentIpcDeps): void {
  const { getStore, getEnvironmentManager } = deps;
  const persistence = new WorkspacePersistenceService(getStore);

  ipcMain.handle(SSH_ENVIRONMENT_LIST, () => {
    return persistence.getAllSshEnvironments();
  });

  ipcMain.handle(SSH_ENVIRONMENT_SAVE, (_, payload: unknown) => {
    try {
      const saved = persistence.saveSshEnvironment(payload);
      getEnvironmentManager().invalidateSshEnvironment(saved.id);
      return { success: true, config: saved };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(SSH_ENVIRONMENT_DELETE, (_, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      return { success: false, error: 'Invalid environment ID' };
    }

    const deleted = persistence.deleteSshEnvironment(id.trim());
    getEnvironmentManager().invalidateSshEnvironment(id.trim());
    return { success: deleted };
  });
  ipcMain.handle(SSH_ENVIRONMENT_TEST, async (_, target: unknown) => {
    let rawTarget = '';
    if (typeof target === 'string') {
      rawTarget = target;
    } else if (target && typeof target === 'object' && 'target' in target && typeof target.target === 'string') {
      rawTarget = target.target;
    }

    if (!rawTarget) {
      return { success: false, error: 'SSH target is required' };
    }

    const executor = getEnvironmentManager().getSshExecutor();
    return executor.testConnection(rawTarget);
  });

  ipcMain.handle(GET_ENVIRONMENT_HARNESS_OPTIONS, async (_, environmentId: unknown) => {
    const envId = typeof environmentId === 'string' ? environmentId : 'local';
    const env = await getEnvironmentManager().getEnvironment(envId);
    if (!env) {
      return {};
    }
    return env.getHarnessOptions();
  });
}
