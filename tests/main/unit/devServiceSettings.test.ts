import { describe, expect, it, vi } from 'vitest';
import { applyDevServiceEnvironment, DevServiceSettings, type StoredDevServiceSettings } from '../../../src/main/services/devServiceSettings';
import { parseDevServiceEnvironment, validateDevServiceEnvironment } from '../../../src/shared/devServiceEnvironment';

describe('checkout dev server configuration', () => {
  it('overrides inherited Windows environment keys without duplicates, while preserving POSIX case semantics', () => {
    expect(applyDevServiceEnvironment({ port: '8787', Path: '/tools', UNSET: undefined }, { PORT: '8788' }, 'win32')).toEqual({ Path: '/tools', PORT: '8788' });
    expect(applyDevServiceEnvironment({ port: '8787' }, { PORT: '8788' }, 'linux')).toEqual({ port: '8787', PORT: '8788' });
  });
  it('bounds UTF-8 bytes and rejects non-record objects', () => {
    expect(() => validateDevServiceEnvironment(Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`VAR_${index}`, '界'.repeat(1000)])))).toThrow('8 KiB');
    expect(() => validateDevServiceEnvironment(new Date())).toThrow('key/value');
  });
  it('persists by physical root across new instances, with independent checkouts and explicit clearing', () => {
    let records: StoredDevServiceSettings[] = [];
    const storage = { read: () => records, write: (value: StoredDevServiceSettings[]) => { records = value; } };
    const one = new DevServiceSettings(storage);
    one.set('/repo', one.get('/repo').settingsRevision, { PORT: '8787' });
    one.set('/repo-worktrees/a', one.get('/repo-worktrees/a').settingsRevision, { PORT: '8788', VITE_DEV_PORT: '5174' });
    const reopened = new DevServiceSettings(storage);
    expect(reopened.get('/repo').environment).toEqual({ PORT: '8787' });
    expect(reopened.get('/repo-worktrees/a').environment).toEqual({ PORT: '8788', VITE_DEV_PORT: '5174' });
    expect(reopened.get('/other').environment).toEqual({});
    reopened.set('/repo', reopened.get('/repo').settingsRevision, {});
    expect(records).toHaveLength(1);
    expect(new DevServiceSettings(storage).get('/repo').environment).toEqual({});
  });
  it('rejects stale edits and unconfirmed configured starts, without changing storage', () => {
    const settings = new DevServiceSettings();
    const original = settings.get('/repo').settingsRevision;
    expect(settings.matches('/repo', undefined)).toBe(true);
    settings.set('/repo', original, { PORT: '8788' });
    expect(settings.matches('/repo', undefined)).toBe(false);
    expect(settings.matches('/repo', original)).toBe(false);
    expect(() => settings.set('/repo', original, { PORT: '8789' })).toThrow('settings changed');
    expect(settings.get('/repo').environment).toEqual({ PORT: '8788' });
  });
  it('fingerprints configuration independent of key insertion order and returns defensive copies', () => {
    const settings = new DevServiceSettings();
    settings.set('/repo', settings.get('/repo').settingsRevision, { PORT: '8788', VITE_DEV_PORT: '5174' });
    const previous = settings.get('/repo');
    settings.set('/repo', previous.settingsRevision, { VITE_DEV_PORT: '5174', PORT: '8788' });
    expect(settings.get('/repo').settingsRevision).toBe(previous.settingsRevision);
    previous.environment.PORT = '9999';
    expect(settings.get('/repo').environment.PORT).toBe('8788');
  });
  it('fails closed on corrupt persistence or failed writes', () => {
    expect(() => new DevServiceSettings({ read: () => [{ root: '/repo', environment: { NODE_OPTIONS: '--require evil' } }], write: vi.fn() }).get('/repo')).toThrow('reserved');
    const storage = { read: () => [], write: () => { throw new Error('disk full'); } };
    const settings = new DevServiceSettings(storage);
    expect(() => settings.set('/repo', settings.get('/repo').settingsRevision, { PORT: '8788' })).toThrow('disk full');
    expect(settings.get('/repo').environment).toEqual({});
  });
  it.each(['PATH', 'path', 'HOME', 'NODE_OPTIONS', 'node_path', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV', 'ENV', 'npm_config_script_shell', 'NPM_CONFIG_USERCONFIG', 'CLANKER_MCP_TOKEN', 'CLANKER_ATTENTION_TOKEN', 'SSH_AUTH_SOCK', '__proto__', 'constructor'])('rejects reserved variable %s', (key) => {
    expect(() => validateDevServiceEnvironment(Object.fromEntries([[key, 'value']]))).toThrow('reserved');
  });
  it.each([null, [], 'PORT=1234', { PORT: 8788 }, { PORT: 'a\nb' }, { PORT: 'a\u0000b' }, { PORT: 'x'.repeat(1025) }, { PORT: '1', port: '2' }, { 'BAD-NAME': '1' }, Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`VAR_${index}`, '1']))])('rejects malformed or unbounded environment %j', (input) => {
    expect(() => validateDevServiceEnvironment(input)).toThrow();
  });
  it('parses literal values without interpolation or shell execution, preserving equals and empty values', () => {
    expect(parseDevServiceEnvironment('PORT=8788\n\nPUBLIC_URL=http://localhost:5174/?a=b\nEMPTY=\nTEXT=$(touch nope)')).toEqual({ PORT: '8788', PUBLIC_URL: 'http://localhost:5174/?a=b', EMPTY: '', TEXT: '$(touch nope)' });
    expect(() => parseDevServiceEnvironment('PORT=1\nPORT=2')).toThrow('Duplicate');
    expect(() => parseDevServiceEnvironment('PORT')).toThrow('NAME=value');
  });
});
