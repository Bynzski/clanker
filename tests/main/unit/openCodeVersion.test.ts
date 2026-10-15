import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearOpenCodeVersionCacheForTests, openCodeMajorVersion, parseOpenCodeMajorVersion } from '../../../src/main/harnesses/opencode/version';

describe('OpenCode version probe', () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearOpenCodeVersionCacheForTests();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function install(): { bin: string; executable: string } {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-opencode-version-'));
    dirs.push(home);
    // User-level bins come first in resolution; keep them inside this fixture.
    vi.stubEnv('HOME', home);
    const bin = path.join(home, 'tools');
    fs.mkdirSync(bin);
    const executable = path.join(bin, 'opencode');
    fs.writeFileSync(executable, '#!/bin/sh\n', { mode: 0o755 });
    return { bin, executable };
  }

  it('parses 2.x and bare version output', () => {
    expect(parseOpenCodeMajorVersion('opencode v2.0.26\n')).toBe(2);
    expect(parseOpenCodeMajorVersion('1.18.34')).toBe(1);
    expect(parseOpenCodeMajorVersion('not a version')).toBeNull();
  });

  it('probes the resolved executable once per real path and modification time', () => {
    if (process.platform === 'win32') return;
    const { bin, executable } = install();
    const run = vi.fn(() => 'opencode v2.0.26');
    expect(openCodeMajorVersion({ PATH: bin }, 'linux', run)).toBe(2);
    expect(openCodeMajorVersion({ PATH: bin }, 'linux', run)).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(executable);
    fs.utimesSync(executable, new Date(), new Date(Date.now() + 5000));
    run.mockReturnValue('1.18.34');
    expect(openCodeMajorVersion({ PATH: bin }, 'linux', run)).toBe(1);
  });

  it('reports unknown when OpenCode is missing, fails, or the platform is Windows', () => {
    if (process.platform === 'win32') return;
    const { bin } = install();
    expect(openCodeMajorVersion({ PATH: path.join(bin, 'missing') }, 'linux', () => 'opencode v2.0.0')).toBeNull();
    expect(openCodeMajorVersion({ PATH: bin }, 'linux', () => { throw new Error('timeout'); })).toBeNull();
    // A failed probe is not remembered.
    expect(openCodeMajorVersion({ PATH: bin }, 'linux', () => 'opencode v2.0.0')).toBe(2);
    expect(openCodeMajorVersion({ PATH: bin }, 'win32', () => 'opencode v2.0.0')).toBeNull();
  });
});
