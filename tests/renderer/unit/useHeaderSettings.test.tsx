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
});
