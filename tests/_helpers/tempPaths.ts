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

/** Platform-appropriate workspace path under the test home. */
export function testWorkspace(name = 'project'): string {
  return path.join(testHome(), name);
}

/** Platform-appropriate harness wrapper script path. */
export function testHarnessWrapper(): string {
  return path.join(testHome(), '.clanker-grid', 'harness-wrapper.sh');
}

/** Platform-appropriate .clanker-grid directory. */
export function testClankerGridDir(): string {
  return path.join(testHome(), '.clanker-grid');
}

/** Platform-appropriate .pi session directory. */
export function testPiSessionsDir(): string {
  return path.join(testHome(), '.pi', 'agent', 'sessions', 'dir');
}

/** Platform-appropriate SSH key path. */
export function testSshKey(name = 'id_ed25519'): string {
  return path.join(testHome(), '.ssh', name);
}

/** Build a nested path under the test home. */
export function testPath(...segments: string[]): string {
  return path.join(testHome(), ...segments);
}
