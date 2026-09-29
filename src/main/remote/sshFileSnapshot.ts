import * as path from 'node:path';
import { REMOTE_WATCH_MAX_FILES, REMOTE_WATCH_MAX_DIRECTORIES, type RemoteFileSnapshot, type RemoteFileSnapshotTargets } from '../../shared/types/remoteFileWatch';
import type { SshCommandExecutor } from './sshCommandExecutor';
import { isPathContained } from './remotePaths';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;

// Inspect only requested files and direct directory children. Never traverse a
// tree or stat a symlink destination outside the registered canonical root.
const SSH_FILE_SNAPSHOT_SCRIPT = `
import os, sys, json, stat, hashlib
root = sys.argv[1]
targets = json.load(sys.stdin)
if os.path.realpath(root) != root or not os.path.isdir(root):
  sys.exit("Workspace root is no longer canonical or accessible")
def open_directory(start_fd, parts):
  current = os.dup(start_fd)
  try:
    for part in parts:
      next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
      os.close(current)
      current = next_fd
    return current
  except BaseException:
    os.close(current)
    raise
slash_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
try:
  root_fd = open_directory(slash_fd, [part for part in root.split("/") if part])
finally:
  os.close(slash_fd)
def token(st):
  return [st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns, st.st_ino]
def fingerprint(target, directory):
  real = os.path.realpath(target)
  if not (real == root or real.startswith(root.rstrip("/") + "/")):
    raise PermissionError("Path escapes workspace root")
  relative = os.path.relpath(real, root)
  parts = [] if relative == "." else relative.split("/")
  current_fd = None
  try:
    if directory:
      current_fd = open_directory(root_fd, parts)
      st = os.fstat(current_fd)
      entries = []
      with os.scandir(current_fd) as iterator:
        for entry in iterator:
          if len(entries) >= 2000:
            raise OSError("Directory exceeds polling limit")
          try:
            entries.append([entry.name, token(entry.stat(follow_symlinks=False))])
          except (FileNotFoundError, NotADirectoryError):
            continue
      entries.sort(key=lambda entry: entry[0])
      value = [token(st), entries]
    else:
      if not parts:
        return None
      current_fd = open_directory(root_fd, parts[:-1])
      st = os.stat(parts[-1], dir_fd=current_fd, follow_symlinks=False)
      if stat.S_ISLNK(st.st_mode):
        raise PermissionError("Path changed to a symbolic link")
      if not stat.S_ISREG(st.st_mode):
        return None
      value = token(st)
    return hashlib.sha256(json.dumps(value, ensure_ascii=True).encode()).hexdigest()
  except (FileNotFoundError, NotADirectoryError):
    return None
  finally:
    if current_fd is not None:
      os.close(current_fd)
result = {"files": [], "directories": []}
for kind, paths in [("files", targets["filePaths"]), ("directories", targets["directoryPaths"])]:
  for target in paths:
    try:
      result[kind].append({"path": target, "fingerprint": fingerprint(target, kind == "directories")})
    except OSError:
      pass
print(json.dumps(result))
os.close(root_fd)
`;

export function validSnapshotPath(root: string, candidate: unknown): candidate is string {
  return typeof candidate === 'string' && path.posix.isAbsolute(candidate) &&
    path.posix.normalize(candidate) === candidate && !candidate.includes('\0') &&
    Buffer.byteLength(candidate) <= MAX_PATH_BYTES && isPathContained(root, candidate);
}

export function validateSnapshotTargets(root: string, targets: RemoteFileSnapshotTargets): boolean {
  return !!targets && Array.isArray(targets.filePaths) && Array.isArray(targets.directoryPaths) &&
    targets.filePaths.length <= REMOTE_WATCH_MAX_FILES && targets.directoryPaths.length <= REMOTE_WATCH_MAX_DIRECTORIES &&
    [...targets.filePaths, ...targets.directoryPaths].every((candidate) => validSnapshotPath(root, candidate));
}

export async function snapshotSshFiles(executor: SshCommandExecutor, target: string, root: string, targets: RemoteFileSnapshotTargets, signal?: AbortSignal): Promise<RemoteFileSnapshot> {
  if (!validSnapshotPath(root, root) || !validateSnapshotTargets(root, targets)) throw new Error('Invalid remote watch paths');
  const result = await executor.exec(target, 'python3', ['-c', SSH_FILE_SNAPSHOT_SCRIPT, root], {
    input: JSON.stringify(targets), timeoutMs: 12000, maxBuffer: MAX_RESPONSE_BYTES, signal,
  });
  const value: unknown = JSON.parse(result.stdout);
  if (!value || typeof value !== 'object') throw new Error('Invalid remote file snapshot');
  const parsed = value as Record<string, unknown>;
  const validate = (entries: unknown, requested: string[]) => {
    if (!Array.isArray(entries) || entries.length > requested.length) return false;
    const seen = new Set<string>();
    return entries.every((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return false;
      const item = entry as Record<string, unknown>;
      if (typeof item.path !== 'string' || !requested.includes(item.path) || seen.has(item.path)) return false;
      seen.add(item.path);
      return item.fingerprint === null || (typeof item.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(item.fingerprint));
    });
  };
  if (!validate(parsed.files, targets.filePaths) || !validate(parsed.directories, targets.directoryPaths)) throw new Error('Invalid remote file snapshot');
  return parsed as unknown as RemoteFileSnapshot;
}
