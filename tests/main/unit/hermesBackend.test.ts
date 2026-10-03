import { describe, expect, it, vi } from 'vitest';
import { fakeChild } from '../../_helpers/fakeHermes';

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({ ...(await importOriginal<object>()), spawn: mockSpawn }));

import { spawnHermesServe, waitForServeReady, generateServiceToken } from '../../../src/main/assistants/hermesBackend';

describe('hermes serve launch', () => {
  it('spawns `hermes serve --host 127.0.0.1 --port 0` as an argv (no shell) with the token only in the child environment', () => {
    mockSpawn.mockReturnValue(fakeChild());
    spawnHermesServe('the-token-0123456789abcdefghij');
    const [file, args, options] = mockSpawn.mock.calls[0];
    expect(String(file).replace(/\.(exe|cmd|bat)$/i, '').split(/[\\/]/).pop()).toMatch(/^(hermes|cmd)$/i);
    const joined = [file, ...args].join(' ');
    if (process.platform !== 'win32') {
      expect(file).toBe('hermes');
      expect(args).toEqual(['serve', '--host', '127.0.0.1', '--port', '0']);
    } else expect(joined).toContain('serve');
    expect(options.shell).toBeUndefined();
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(options.env.HERMES_DASHBOARD_SESSION_TOKEN).toBe('the-token-0123456789abcdefghij');
    expect(JSON.stringify(args)).not.toContain('the-token');
    expect(Object.keys(options.env).some((key) => key.startsWith('CLANKER_ATTENTION_'))).toBe(false);
  });
  it('generates distinct high-entropy URL-safe tokens', () => {
    const a = generateServiceToken(); const b = generateServiceToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('waitForServeReady', () => {
  it('bounds a newline-less flood and total pre-ready output', async () => {
    const flood = fakeChild();
    const pending = waitForServeReady(flood, 1000);
    for (let i = 0; i < 20; i++) flood.stdout.write('x'.repeat(8192));
    await expect(pending).rejects.toThrow(/too much output/);
    const lines = fakeChild();
    const second = waitForServeReady(lines, 1000);
    for (let i = 0; i < 40; i++) lines.stderr.write(`${'y'.repeat(2000)}\n`);
    await expect(second).rejects.toThrow(/too much output/);
  });
  it('ignores an over-long line that happens to contain the sentinel', async () => {
    const child = fakeChild();
    const pending = waitForServeReady(child, 30);
    child.stdout.write(`${'z'.repeat(5000)}HERMES_BACKEND_READY port=1234\n`);
    await expect(pending).rejects.toThrow(/not become ready/);
  });
  it('keeps draining output after readiness so the child never blocks on a full pipe', async () => {
    const child = fakeChild();
    const pending = waitForServeReady(child, 1000);
    child.stdout.write('HERMES_BACKEND_READY port=4000\r\n');
    expect(await pending).toBe(4000);
    const before = child.stdout.listenerCount('data');
    child.stdout.write('later output\n');
    expect(child.stdout.listenerCount('data')).toBe(before);
  });
});
