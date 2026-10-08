import { createHash } from 'node:crypto';
import { validateDevServiceEnvironment } from '../../shared/devServiceEnvironment';

/** Windows treats environment keys case-insensitively; avoid node-pty inheriting the wrong duplicate. */
export function applyDevServiceEnvironment(base: NodeJS.ProcessEnv, configured: Record<string, string>, platform = process.platform): Record<string, string> {
  const overridden = new Set(Object.keys(configured).map((key) => platform === 'win32' ? key.toUpperCase() : key));
  return { ...Object.fromEntries(Object.entries(base).filter((entry): entry is [string, string] => typeof entry[1] === 'string'
    && !overridden.has(platform === 'win32' ? entry[0].toUpperCase() : entry[0]))), ...configured };
}

export interface StoredDevServiceSettings { root: string; environment: Record<string, string> }

/** Physical local root is the durable identity, not the ephemeral workspace/context id or branch. */
export class DevServiceSettings {
  private memory: StoredDevServiceSettings[] = [];
  constructor(private readonly storage?: { read: () => unknown; write: (records: StoredDevServiceSettings[]) => void }) {}
  private records(): StoredDevServiceSettings[] {
    const raw = this.storage ? this.storage.read() : this.memory;
    if (!Array.isArray(raw) || raw.length > 512) throw new Error('Invalid stored dev server settings');
    const roots = new Set<string>();
    return raw.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid stored dev server settings');
      const { root, environment } = entry as StoredDevServiceSettings;
      if (typeof root !== 'string' || !root || root.length > 4096 || /[\u0000-\u001f\u007f]/.test(root) || roots.has(root)) throw new Error('Invalid stored dev server root');
      roots.add(root);
      return { root, environment: validateDevServiceEnvironment(environment) };
    });
  }
  private key(root: string): string { return process.platform === 'win32' ? root.toLowerCase() : root; }
  get(root: string): { environment: Record<string, string>; settingsRevision: string } {
    const environment = this.records().find((entry) => entry.root === this.key(root))?.environment ?? {};
    return { environment, settingsRevision: this.revision(environment) };
  }
  private revision(environment: Record<string, string>): string {
    return createHash('sha256').update(JSON.stringify(environment)).digest('hex');
  }
  set(root: string, expectedRevision: string | undefined, input: unknown): void {
    if (this.get(root).settingsRevision !== expectedRevision) throw new Error('Dev server settings changed; reopen settings and try again');
    const environment = validateDevServiceEnvironment(input);
    const records = this.records().filter((entry) => entry.root !== this.key(root));
    if (Object.keys(environment).length) records.push({ root: this.key(root), environment });
    if (records.length > 512) throw new Error('Dev server settings limit reached; clear unused settings first');
    if (this.storage) this.storage.write(records); else this.memory = records;
  }
  matches(root: string, revision: string | undefined): boolean {
    const current = this.get(root);
    // Backward-compatible unconfigured launches only; a configured launch must confirm what was discovered.
    return revision === current.settingsRevision || (revision === undefined && Object.keys(current.environment).length === 0);
  }
}
