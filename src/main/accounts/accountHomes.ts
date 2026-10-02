import * as fs from 'node:fs';
import * as path from 'node:path';

/** Opaque, main-issued account IDs only; nothing renderer-supplied is ever joined into a path. */
export const MANAGED_ACCOUNT_ID_PATTERN = /^acct_[0-9a-f]{32}$/;
const HARNESS_DIRECTORY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

type PathApi = typeof path.posix;

export class UnsafeAccountPathError extends Error {
  constructor(message = 'Account storage failed a safety check') {
    super(message);
    this.name = 'UnsafeAccountPathError';
  }
}

/** True only for a strict descendant of `root` (the root itself is not "contained"). */
export function isStrictlyContained(root: string, candidate: string, pathApi: PathApi = path): boolean {
  const relative = pathApi.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative);
}

export interface AccountHomeStoreOptions {
  /** Provider-native homes that must never be touched, even if the owned root were misconfigured. */
  protectedPaths?: readonly string[];
  pathApi?: PathApi;
  platform?: NodeJS.Platform;
}

/**
 * Owns the directory tree `<root>/<harness>/<opaque-id>/`. Every path is derived here from a validated
 * harness name and a validated opaque ID. Allocation, lookup and deletion all prove, by lstat and
 * realpath, that the target is a real directory strictly inside the real owned root.
 */
export class AccountHomeStore {
  private readonly pathApi: PathApi;
  private readonly platform: NodeJS.Platform;
  private readonly protectedPaths: readonly string[];

  constructor(private readonly root: string, options: AccountHomeStoreOptions = {}) {
    this.pathApi = options.pathApi ?? path;
    this.platform = options.platform ?? process.platform;
    this.protectedPaths = options.protectedPaths ?? [];
    if (!this.pathApi.isAbsolute(root)) throw new UnsafeAccountPathError('Account root must be absolute');
  }

  /** Lexical location only; callers must go through ensure/resolve/remove. */
  public homePath(harness: string, accountId: string): string {
    if (!HARNESS_DIRECTORY_PATTERN.test(harness) || !MANAGED_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw new UnsafeAccountPathError('Invalid account identity');
    }
    const home = this.pathApi.join(this.root, harness, accountId);
    if (!isStrictlyContained(this.root, home, this.pathApi)) throw new UnsafeAccountPathError();
    return home;
  }

  /** Creates (if needed) a private account home and returns its verified real path. */
  public ensure(harness: string, accountId: string): string {
    const home = this.homePath(harness, accountId);
    const mode = this.platform === 'win32' ? undefined : 0o700;
    // Create level by level so an unexpected symlink is detected before it is followed.
    for (const directory of [this.root, this.pathApi.dirname(home), home]) {
      this.assertNotSymlink(directory, true);
      fs.mkdirSync(directory, { recursive: true, ...(mode ? { mode } : {}) });
      this.assertNotSymlink(directory, false);
      if (mode && directory !== this.root) {
        try { fs.chmodSync(directory, mode); } catch { /* best effort on exotic filesystems */ }
      }
    }
    return this.verify(harness, accountId);
  }

  /** Verified real path of an existing home. Throws if it is missing or unsafe. */
  public resolve(harness: string, accountId: string): string {
    return this.verify(harness, accountId);
  }

  /**
   * Every well-formed home under the owned root (real directories only, never links), for recovery of
   * homes that have no registry entry. Nothing outside the root is ever scanned.
   */
  public listOwnedHomes(): Array<{ harness: string; id: string; empty: boolean }> {
    const found: Array<{ harness: string; id: string; empty: boolean }> = [];
    try {
      this.assertNotSymlink(this.root, false);
      for (const harness of fs.readdirSync(this.root)) {
        if (!HARNESS_DIRECTORY_PATTERN.test(harness)) continue;
        const harnessDir = this.pathApi.join(this.root, harness);
        try {
          this.assertNotSymlink(harnessDir, false);
          for (const id of fs.readdirSync(harnessDir)) {
            if (!MANAGED_ACCOUNT_ID_PATTERN.test(id)) continue;
            const home = this.pathApi.join(harnessDir, id);
            try {
              this.assertNotSymlink(home, false);
              found.push({ harness, id, empty: fs.readdirSync(home).length === 0 });
            } catch { /* unsafe or unreadable entries are not recovered */ }
          }
        } catch { /* skip unsafe harness directory */ }
      }
    } catch { /* no owned root yet, or it is unsafe: nothing to recover */ }
    return found;
  }

  public exists(harness: string, accountId: string): boolean {
    try { return fs.lstatSync(this.homePath(harness, accountId)).isDirectory(); } catch { return false; }
  }

  /** Removes exactly one verified owned home. Never follows links; never touches protected homes. */
  public remove(harness: string, accountId: string): void {
    const home = this.homePath(harness, accountId);
    if (!fs.existsSync(home) && !this.isDanglingLink(home)) return;
    const real = this.verify(harness, accountId);
    this.assertNotProtected(real);
    fs.rmSync(real, { recursive: true, force: true });
  }

  private verify(harness: string, accountId: string): string {
    const home = this.homePath(harness, accountId);
    for (const directory of [this.root, this.pathApi.dirname(home), home]) this.assertNotSymlink(directory, false);
    const realRoot = fs.realpathSync(this.root);
    const realHome = fs.realpathSync(home);
    const expected = this.pathApi.join(realRoot, harness, accountId);
    if (!isStrictlyContained(realRoot, realHome, this.pathApi) || !this.samePath(realHome, expected)) {
      throw new UnsafeAccountPathError();
    }
    this.assertNotProtected(realHome);
    return realHome;
  }

  private assertNotSymlink(target: string, allowMissing: boolean): void {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new UnsafeAccountPathError();
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new UnsafeAccountPathError();
  }

  private isDanglingLink(target: string): boolean {
    try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
  }

  private assertNotProtected(realHome: string): void {
    for (const protectedPath of this.protectedPaths) {
      let real = protectedPath;
      try { real = fs.realpathSync(protectedPath); } catch { /* absent: lexical comparison still applies */ }
      if (this.samePath(real, realHome) || isStrictlyContained(realHome, real, this.pathApi) || isStrictlyContained(real, realHome, this.pathApi)) {
        throw new UnsafeAccountPathError('Refusing to touch a provider-native home');
      }
    }
  }

  private samePath(a: string, b: string): boolean {
    const normalize = (value: string) => this.pathApi.normalize(value);
    return this.platform === 'win32' ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
  }
}
