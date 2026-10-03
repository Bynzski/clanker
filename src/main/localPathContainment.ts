import * as fs from 'node:fs';
import * as path from 'node:path';

/** True when `target` is `root` or inside it, after resolving symlinks. Unresolvable paths are never inside. */
export function isInsideRoot(root: string, target: string): boolean {
  try {
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(target));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
