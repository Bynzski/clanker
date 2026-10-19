import { describe, expect, it, vi } from 'vitest';
import { HermesAssistantService } from '../../../src/main/assistants/hermesAssistantService';
import { HERMES_CLEANUP_ERROR } from '../../../src/main/assistants/hermesOwnedChild';
import { FakeHermes, fakeChild } from '../../_helpers/fakeHermes';

function fixture(stopKillMs = 15) {
  const hermes = new FakeHermes(); hermes.running = false;
  const children: ReturnType<typeof fakeChild>[] = [];
  const spawnServe = vi.fn(() => { const child = fakeChild(); children.push(child); return child; });
  const service = new HermesAssistantService({
    readSettings: () => ({ enabled: true, autoStart: true }), writeSettings: () => {},
    onChanged: () => {}, onPtyData: () => {}, isShuttingDown: () => false, isHermesAvailable: () => true,
    fetch: hermes.fetch as never, readRendezvous: async () => [], createWebSocket: hermes.createWebSocket,
    spawnServe, startTimeoutMs: 1000, stopGraceMs: 15, stopKillMs,
  });
  const ready = async (pending: Promise<unknown>, index = 0) => {
    await vi.waitFor(() => expect(children.length).toBe(index + 1), { interval: 5 });
    hermes.running = true;
    children[index].stdout.write(`HERMES_BACKEND_READY port=${40100 + index}\n`);
    await pending;
  };
  return { service, hermes, children, spawnServe, ready };
}

const enable = { enabled: true, autoStart: true };
const disable = { enabled: false, autoStart: true };

describe('retained Hermes ownership after unverified shutdown', () => {
  it('rejects bounded shutdown, retains ownership and lets shutdown retry the exact child', async () => {
    const { service, children, ready, spawnServe } = fixture();
    await ready(service.refresh());
    const child = children[0]; child.kill.mockImplementation(() => false);
    await expect(service.shutdown()).rejects.toThrow(HERMES_CLEANUP_ERROR);
    expect(service.hasRunningOwnedService()).toBe(true);
    expect(service.get().service).toMatchObject({ state: 'error', ownership: 'clanker', cleanupIncomplete: true });
    child.kill.mockImplementation(() => { child.emit('exit', null, 'SIGKILL'); return true; });
    await service.shutdown();
    expect(service.hasRunningOwnedService()).toBe(false);
    expect(service.get().service.cleanupIncomplete).toBeUndefined();
    expect(spawnServe).toHaveBeenCalledOnce();
    await expect(service.refresh()).rejects.toThrow('shutting down');
  });

  it('keeps a disabled cleanup error visible and Retry cleans only, without discovery or spawning', async () => {
    const { service, hermes, children, ready, spawnServe } = fixture();
    await ready(service.refresh());
    children[0].kill.mockImplementation(() => true);
    service.configure(disable);
    await vi.waitFor(() => expect(service.get().service.cleanupIncomplete).toBe(true), { interval: 5 });
    expect(service.get()).toMatchObject({ settings: { enabled: false }, service: { state: 'error', ownership: 'clanker' } });
    const probes = hermes.fetch.mock.calls.length;
    await expect(service.refresh()).rejects.toThrow(HERMES_CLEANUP_ERROR);
    expect(hermes.fetch).toHaveBeenCalledTimes(probes);
    // Late acknowledgement permits a subsequent cleanup Retry without another signal.
    children[0].emit('exit', null, 'SIGKILL');
    const signals = children[0].kill.mock.calls.length;
    expect((await service.refresh()).service).toEqual({ state: 'disabled', ownership: null });
    expect(children[0].kill).toHaveBeenCalledTimes(signals);
    expect(spawnServe).toHaveBeenCalledOnce();
  });

  it('blocks discovery/adoption and replacement on re-enable until cleanup succeeds', async () => {
    const { service, hermes, children, ready, spawnServe } = fixture();
    await ready(service.refresh());
    children[0].kill.mockImplementation(() => { throw new Error('private process details'); });
    service.configure(disable);
    await vi.waitFor(() => expect(service.get().service.cleanupIncomplete).toBe(true), { interval: 5 });
    const probes = hermes.fetch.mock.calls.length;
    service.configure(enable);
    expect((await service.refresh()).service).toMatchObject({ state: 'error', ownership: 'clanker', cleanupIncomplete: true });
    expect(hermes.fetch).toHaveBeenCalledTimes(probes); // Would otherwise adopt this still-running fake backend.
    expect(spawnServe).toHaveBeenCalledOnce();
    expect(JSON.stringify(service.get())).not.toContain('private process');
    children[0].emit('exit', null, 'SIGKILL');
    hermes.running = false;
    await ready(service.refresh(), 1);
    expect(service.get().service).toMatchObject({ state: 'connected', ownership: 'clanker' });
    expect(service.get().service.cleanupIncomplete).toBeUndefined();
    await service.shutdown();
  });

  it('keeps ownership and blocks re-enable after SIGKILL until its exact exit is acknowledged', async () => {
    const { service, hermes, children, ready, spawnServe } = fixture(1000);
    await ready(service.refresh());
    children[0].kill.mockImplementation(() => true);
    service.configure(disable);
    await vi.waitFor(() => expect(children[0].kill).toHaveBeenCalledWith('SIGKILL'), { interval: 5 });
    expect(service.hasRunningOwnedService()).toBe(true);
    service.configure(enable);
    const pending = service.refresh();
    const probes = hermes.fetch.mock.calls.length;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(spawnServe).toHaveBeenCalledOnce();
    expect(hermes.fetch).toHaveBeenCalledTimes(probes);
    hermes.running = false;
    children[0].emit('exit', null, 'SIGKILL');
    await ready(pending, 1);
    expect(children[1].kill).not.toHaveBeenCalled();
    await service.shutdown();
  });

  it('overlapping disable and shutdown share one TERM/KILL attempt and both retain failure', async () => {
    const { service, children, ready } = fixture();
    await ready(service.refresh());
    children[0].kill.mockImplementation(() => true);
    service.configure(disable);
    await expect(service.shutdown()).rejects.toThrow(HERMES_CLEANUP_ERROR);
    expect(children[0].kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(service.hasRunningOwnedService()).toBe(true);
    children[0].emit('exit', null, 'SIGKILL');
    await service.shutdown();
  });

  it('failed-start cleanup stays owned past escalation and Retry cannot start beside it', async () => {
    const { service, hermes, children, spawnServe, ready } = fixture();
    const starting = service.refresh();
    await vi.waitFor(() => expect(children).toHaveLength(1), { interval: 5 });
    children[0].kill.mockImplementation(() => true);
    children[0].stderr.write('BACKEND_PORT_IN_USE port=9119\n');
    expect((await starting).service).toMatchObject({ state: 'error', cleanupIncomplete: true, ownership: 'clanker' });
    const probes = hermes.fetch.mock.calls.length;
    expect((await service.refresh()).service.cleanupIncomplete).toBe(true);
    expect(hermes.fetch).toHaveBeenCalledTimes(probes);
    expect(spawnServe).toHaveBeenCalledOnce();
    children[0].emit('exit', null, 'SIGKILL');
    await ready(service.refresh(), 1);
    await service.shutdown();
  });

  it('a late exit after failed cleanup does not auto-restart a previously ready backend', async () => {
    const { service, children, ready, spawnServe } = fixture();
    await ready(service.refresh());
    children[0].kill.mockImplementation(() => true);
    service.configure(disable);
    await vi.waitFor(() => expect(service.get().service.cleanupIncomplete).toBe(true), { interval: 5 });
    service.configure(enable);
    await service.refresh(); // Failed cleanup retry, not a new backend.
    children[0].emit('exit', null, 'SIGKILL');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(spawnServe).toHaveBeenCalledOnce();
    await service.shutdown();
  });

  it('never signals an adopted backend during disable, Retry or shutdown', async () => {
    const { service, hermes, spawnServe } = fixture(); hermes.running = true;
    expect((await service.refresh()).service.ownership).toBe('external');
    service.configure(disable);
    await expect(service.refresh()).rejects.toThrow('disabled');
    await service.shutdown();
    expect(spawnServe).not.toHaveBeenCalled();
    expect(hermes.running).toBe(true);
    expect(service.hasRunningOwnedService()).toBe(false);
  });
});
