import type Store from 'electron-store';
import type { StoreSchema } from '../../shared/types/store';
import { LOCAL_ENVIRONMENT_ID, type WorkspaceEnvironmentId } from '../../shared/types/environments';
import type { WorkspaceEnvironment } from './workspaceEnvironment';
import { LocalEnvironment } from './localEnvironment';
import { SshEnvironment } from '../remote/sshEnvironment';
import { SshCommandExecutor } from '../remote/sshCommandExecutor';

export class EnvironmentManager {
  private readonly localEnvironment = new LocalEnvironment();
  private readonly sshEnvironments = new Map<string, SshEnvironment>();
  private readonly sshExecutor: SshCommandExecutor;

  constructor(
    private readonly getStore: () => Store<StoreSchema>,
    sshExecutor?: SshCommandExecutor
  ) {
    this.sshExecutor = sshExecutor ?? new SshCommandExecutor();
  }

  public async getEnvironment(id: WorkspaceEnvironmentId): Promise<WorkspaceEnvironment | null> {
    if (!id || id === LOCAL_ENVIRONMENT_ID) {
      return this.localEnvironment;
    }

    const cached = this.sshEnvironments.get(id);
    if (cached) {
      return cached;
    }

    const configs = this.getStore().get('sshEnvironments') || [];
    const config = configs.find((c) => c.id === id);
    if (!config) {
      return null;
    }

    const env = new SshEnvironment(config, this.sshExecutor);
    this.sshEnvironments.set(id, env);
    return env;
  }

  public invalidateSshEnvironment(id: string): void {
    this.sshEnvironments.delete(id);
  }

  public getSshExecutor(): SshCommandExecutor {
    return this.sshExecutor;
  }
}
