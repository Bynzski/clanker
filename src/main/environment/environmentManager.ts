import type Store from 'electron-store';
import type { StoreSchema } from '../../shared/types/store';
import { LOCAL_ENVIRONMENT_ID, type WorkspaceEnvironmentId } from '../../shared/types/environments';
import type { WorkspaceEnvironment } from './workspaceEnvironment';
import { LocalEnvironment } from './localEnvironment';
import { SshEnvironment } from '../remote/sshEnvironment';
import { SshCommandExecutor } from '../remote/sshCommandExecutor';
import { resolveSshTargetIdentity } from '../remote/sshTargetIdentity';

export class EnvironmentManager {
  private readonly localEnvironment = new LocalEnvironment();
  private readonly sshEnvironments = new Map<string, SshEnvironment>();
  private readonly pendingEnvironments = new Map<string, Promise<SshEnvironment>>();
  private readonly sshExecutor: SshCommandExecutor;

  constructor(
    private readonly getStore: () => Store<StoreSchema>,
    sshExecutor?: SshCommandExecutor,
    private readonly resolveTargetIdentity = resolveSshTargetIdentity,
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
    const pending = this.pendingEnvironments.get(id);
    if (pending) return pending;

    const configs = this.getStore().get('sshEnvironments') || [];
    const saved = configs.find((c) => c.id === id);
    if (!saved) {
      return null;
    }
    const config = { ...saved };

    const resolving = this.resolveTargetIdentity(config.target).then((resourceId) => {
      const env = new SshEnvironment(config, this.sshExecutor, resourceId);
      if (this.pendingEnvironments.get(id) === resolving) this.sshEnvironments.set(id, env);
      return env;
    });
    this.pendingEnvironments.set(id, resolving);
    try { return await resolving; }
    finally { if (this.pendingEnvironments.get(id) === resolving) this.pendingEnvironments.delete(id); }
  }

  public invalidateSshEnvironment(id: string): void {
    this.sshEnvironments.delete(id);
    this.pendingEnvironments.delete(id);
  }

  public getSshExecutor(): SshCommandExecutor {
    return this.sshExecutor;
  }
}
