/**
 * Platform-neutral test path helpers.
 *
 * Every path returned by these helpers is built from `os.tmpdir()` and
 * `path.join` so tests produce valid native paths on Linux, macOS, and
 * Windows. Use these instead of hardcoding `/home/...` or `/tmp/...`.
 */

import * as os from 'node:os';
import * as path from 'node:path';

/** Platform-appropriate mock home directory (under os.tmpdir). */
export function testHome(): string {
  return path.join(os.tmpdir(), 'clanker-test-home');
}

/** Platform-appropriate harness wrapper script path. */
export function testHarnessWrapper(): string {
  return path.join(testHome(), '.clanker-grid', 'harness-wrapper.sh');
}


