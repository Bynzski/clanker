import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHeaderSettings } from '../../../src/renderer/components/useHeaderSettings';
import { installElectronApiMock } from '../../setup/electron';

const option = (name: string) => ({ name, command: name, args: [], icon: 'terminal' });

describe('useHeaderSettings harness availability', () => {
  beforeEach(() => { installElectronApiMock(); });

  it('never exposes the previous environment\'s harnesses while the next one is discovered', async () => {
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation(async (id: string) =>
      id === 'ssh-a' ? { codex: option('codex'), claude: option('claude') } : new Promise(() => undefined));
    const { result, rerender } = renderHook(
      ({ environmentId }) => useHeaderSettings({ harness: '', setHarness: vi.fn(), environmentId, includeAiCommit: false }),
      { initialProps: { environmentId: 'ssh-a' } },
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.availableHarnessIds).toEqual(expect.arrayContaining(['codex', 'claude']));

    rerender({ environmentId: 'ssh-b' });
    expect(result.current.availableHarnessIds).not.toContain('codex');
    expect(result.current.availableHarnessIds).not.toContain('claude');
  });

  const settle = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
  const render = (environmentId: string) => renderHook(
    ({ environmentId: env }) => useHeaderSettings({ harness: '', setHarness: vi.fn(), environmentId: env, includeAiCommit: false }),
    { initialProps: { environmentId } },
  );

  it('ignores a late result from the environment that was left', async () => {
    let resolveA!: (v: Record<string, ReturnType<typeof option>>) => void;
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation((id: string) =>
      id === 'ssh-a' ? new Promise((resolve) => { resolveA = resolve; }) : Promise.resolve({ claude: option('claude') }));
    const { result, rerender } = render('ssh-a');
    rerender({ environmentId: 'ssh-b' });
    await settle();
    await act(async () => resolveA({ codex: option('codex') }));
    expect(result.current.availableHarnessIds).toContain('claude');
    expect(result.current.availableHarnessIds).not.toContain('codex');
  });

  it('fails closed when the new environment cannot be discovered', async () => {
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation(async (id: string) => {
      if (id === 'ssh-a') return { codex: option('codex') };
      throw new Error('unreachable');
    });
    const { result, rerender } = render('ssh-a');
    await settle();
    rerender({ environmentId: 'ssh-b' });
    await settle();
    expect(result.current.availableHarnessIds).toEqual(['']);
  });

  it('A → B → A exposes only the environment currently focused', async () => {
    vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation((id: string) =>
      id === 'ssh-a' ? Promise.resolve({ codex: option('codex') }) : new Promise(() => undefined));
    const { result, rerender } = render('ssh-a');
    await settle();
    rerender({ environmentId: 'ssh-b' });
    expect(result.current.availableHarnessIds).not.toContain('codex');
    rerender({ environmentId: 'ssh-a' });
    await settle();
    expect(result.current.availableHarnessIds).toContain('codex');
  });

  it.each(['', 'explicit-model'])('does not replace a configured AI commit provider/model (%s) during discovery', async (model) => {
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model });
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({ pi: option('pi') });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([{ id: 'first-model', label: 'First' }]);
    const { result } = renderHook(() => useHeaderSettings({ harness: '', setHarness: vi.fn(), environmentId: 'local' }));
    await settle();
    expect(result.current.aiCommitProvider).toBe('codex');
    expect(result.current.aiCommitModel).toBe(model);
    expect(window.electronAPI.setAiCommitProvider).not.toHaveBeenCalled();
    expect(window.electronAPI.setAiCommitModel).not.toHaveBeenCalled();
  });

  it('model discovery never persists its first row over the harness default', async () => {
    vi.mocked(window.electronAPI.getAiCommitSettings).mockResolvedValue({ enabled: true, provider: 'codex', model: '' });
    vi.mocked(window.electronAPI.getHarnessOptions).mockResolvedValue({ codex: option('codex') });
    vi.mocked(window.electronAPI.getHarnessModels).mockResolvedValue([{ id: 'first-model', label: 'First' }]);
    const { result } = renderHook(() => useHeaderSettings({ harness: '', setHarness: vi.fn(), environmentId: 'local' }));
    await settle();
    expect(result.current.aiCommitModels).toHaveLength(1);
    expect(result.current.aiCommitModel).toBe('');
    expect(window.electronAPI.setAiCommitModel).not.toHaveBeenCalled();
  });

  describe('selected harness ownership', () => {
    type Opts = Record<string, ReturnType<typeof option>>;
    const deferred = () => { let resolve!: (v: Opts) => void; let reject!: (e: Error) => void; const promise = new Promise<Opts>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
    const setup = (env: string, harness = 'codex') => {
      const setHarness = vi.fn();
      const view = renderHook(
        ({ environmentId }) => useHeaderSettings({ harness, setHarness, environmentId, includeAiCommit: false }),
        { initialProps: { environmentId: env } },
      );
      return { setHarness, ...view };
    };

    it('keeps the selection while the new environment is pending, yet availability stays fail-closed', async () => {
      const b = deferred();
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation((id: string) =>
        id === 'ssh-a' ? Promise.resolve({ codex: option('codex') }) : b.promise);
      const { result, rerender, setHarness } = setup('ssh-a');
      await settle();
      rerender({ environmentId: 'ssh-b' });
      await settle();
      expect(result.current.harnessDiscoveryStatus).toBe('loading');
      expect(result.current.availableHarnessIds).toEqual(['']);
      expect(setHarness).not.toHaveBeenCalled();
    });

    it('retains the selection when the new environment has it', async () => {
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation(async (id: string) =>
        id === 'ssh-a' ? {} : { codex: option('codex') });
      const { rerender, setHarness } = setup('ssh-a');
      await settle();
      setHarness.mockClear();
      rerender({ environmentId: 'ssh-b' });
      await settle();
      expect(setHarness).not.toHaveBeenCalled();
    });

    it('clears the selection only after a successful discovery proves it unavailable', async () => {
      const b = deferred();
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation((id: string) =>
        id === 'ssh-a' ? Promise.resolve({ codex: option('codex') }) : b.promise);
      const { rerender, setHarness } = setup('ssh-a');
      await settle();
      rerender({ environmentId: 'ssh-b' });
      await settle();
      expect(setHarness).not.toHaveBeenCalled();
      await act(async () => b.resolve({ claude: option('claude') }));
      expect(setHarness).toHaveBeenCalledWith('');
    });

    it('retains the selection and stays fail-closed when discovery fails', async () => {
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation(async (id: string) => {
        if (id === 'ssh-a') return { codex: option('codex') };
        throw new Error('unreachable');
      });
      const { result, rerender, setHarness } = setup('ssh-a');
      await settle();
      rerender({ environmentId: 'ssh-b' });
      await settle();
      expect(result.current.harnessDiscoveryStatus).toBe('failed');
      expect(result.current.availableHarnessIds).toEqual(['']);
      expect(setHarness).not.toHaveBeenCalled();
    });

    it('a late result from A cannot validate or mutate the selection once B is current', async () => {
      const a = deferred();
      const b = deferred();
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation((id: string) => (id === 'ssh-a' ? a.promise : b.promise));
      const { result, rerender, setHarness } = setup('ssh-a');
      rerender({ environmentId: 'ssh-b' });
      await act(async () => a.resolve({ claude: option('claude') })); // A lacks codex: must not clear B's selection
      expect(setHarness).not.toHaveBeenCalled();
      expect(result.current.harnessDiscoveryStatus).toBe('loading');
    });

    it('A → B → A: only the discovery owned by the current transition validates', async () => {
      const first = deferred();
      const second = deferred();
      let aCalls = 0;
      vi.mocked(window.electronAPI.getEnvironmentHarnessOptions).mockImplementation((id: string) => {
        if (id !== 'ssh-a') return new Promise(() => undefined);
        return ++aCalls === 1 ? first.promise : second.promise;
      });
      const { result, rerender, setHarness } = setup('ssh-a');
      await act(async () => first.resolve({ codex: option('codex') }));
      rerender({ environmentId: 'ssh-b' });
      rerender({ environmentId: 'ssh-a' });
      // The earlier A result must not count as the new visit's discovery.
      expect(result.current.harnessDiscoveryStatus).toBe('loading');
      expect(result.current.availableHarnessIds).toEqual(['']);
      expect(setHarness).not.toHaveBeenCalled();
      await act(async () => second.resolve({ claude: option('claude') }));
      expect(result.current.harnessDiscoveryStatus).toBe('ready');
      expect(setHarness).toHaveBeenCalledWith('');
    });
  });
});
