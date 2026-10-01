import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { associateWebServices, discoverSshWebServices, parseWebInventory, WEB_DISCOVERY_PYTHON } from '../../../src/main/remote/sshPortDiscovery';
import type { RemoteWebService } from '../../../src/shared/types/remotePreview';
import type { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
const row = { remoteHost: '127.0.0.1' as const, remotePort: 5173, protocol: 'http' as const, source: 'listener' as const };
it('validates bounded inventories and associates only canonical workspace-owned listeners', () => {
  const inventory = parseWebInventory(JSON.stringify([row, { ...row, remotePort: 6006, cwd: '/repo/app' }, { ...row, cwd: '/other' }]));
  expect(associateWebServices(inventory, '/repo').map((service) => service.confidence)).toEqual(['unscoped', 'workspace']);
  for (const bad of [[{ ...row, remoteHost: '192.168.1.2' }], [{ ...row, remotePort: 80 }], [{ ...row, protocol: 'ftp' }], Array(33).fill(row)]) expect(() => parseWebInventory(JSON.stringify(bad))).toThrow();
});
it('uses one bounded SSH command and propagates cancellation without publishing a late result', async () => {
  const exec = vi.fn().mockResolvedValue({ stdout: JSON.stringify([row]) });
  const controller = new AbortController();
  expect(await discoverSshWebServices({ exec } as unknown as SshCommandExecutor, 'host', controller.signal)).toEqual([row]);
  expect(exec).toHaveBeenCalledWith('host', 'python3', ['-c', WEB_DISCOVERY_PYTHON], expect.objectContaining({ signal: controller.signal, timeoutMs: 25000, maxBuffer: 32768 }));
  controller.abort();
  await expect(discoverSshWebServices({ exec } as unknown as SshCommandExecutor, 'host', controller.signal)).rejects.toThrow('cancelled');
});
describe.skipIf(process.platform === 'win32')('host Python listener parser', () => {
  function parse(tool: string, output: string) {
    const script = WEB_DISCOVERY_PYTHON.split('request = json.load')[0]
      + `\nshutil.which = lambda name: name == ${JSON.stringify(tool)}\ncommand = lambda args: ${JSON.stringify(output)}\nprint(json.dumps(listeners()))`;
    return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8', timeout: 5000 }));
  }
  it('parses ss IPv4/IPv6/wildcards and rejects LAN addresses', () => {
    const result = parse('ss', 'LISTEN 0 128 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=99999999,fd=1))\nLISTEN 0 128 [::1]:6006 [::]:*\nLISTEN 0 128 0.0.0.0:8080 0.0.0.0:*\nLISTEN 0 128 [::]:8081 [::]:*\nLISTEN 0 128 10.1.2.3:9000 0.0.0.0:*');
    expect(result.map((entry: typeof row) => [entry.remoteHost, entry.remotePort])).toEqual([['127.0.0.1', 5173], ['::1', 6006], ['127.0.0.1', 8080], ['::1', 8081]]);
    expect(result[0]).toMatchObject({ pid: 99999999, processName: 'node' });
  });
  it('parses structured lsof and uses only a curated fallback when tools are absent', () => {
    expect(parse('lsof', 'p99999999\ncnode\nn*:5173\nn[::1]:6006\n')).toMatchObject([{ remotePort: 5173 }, { remoteHost: '::1', remotePort: 6006 }]);
    const fallback = parse('missing', '');
    expect(fallback).toHaveLength(8);
    expect(fallback.every((entry: RemoteWebService) => entry.remoteHost === '127.0.0.1' && entry.source === 'fallback')).toBe(true);
  });
  it('caps candidate count, socket read length, deadlines and concurrent probes', () => {
    expect(WEB_DISCOVERY_PYTHON).toContain('LIMIT = 32');
    expect(WEB_DISCOVERY_PYTHON).toContain('max_workers=4');
    expect(WEB_DISCOVERY_PYTHON).toContain('connection.recv(512)');
    expect(WEB_DISCOVERY_PYTHON).toContain('timeout=0.7');
    expect(WEB_DISCOVERY_PYTHON).toContain('131072');
    expect(WEB_DISCOVERY_PYTHON).not.toMatch(/range\(1024/);
  });
});
