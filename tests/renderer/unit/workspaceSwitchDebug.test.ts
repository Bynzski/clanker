import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeUsableWorkspaceFrame, startSwitch, switchCommit, editorCreate } from '../../../src/renderer/lib/workspaceSwitchDebug';

afterEach(() => { window.clankerSwitchDebug?.enable(false); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('opt-in switch diagnostics', () => {
  it('is silent when disabled and bounds retained payload-free events when enabled', () => {
    window.clankerSwitchDebug!.enable(false);
    window.clankerSwitchDebug!.clear();
    switchCommit('app', 'update', 1, 1, 1, 1);
    expect(window.clankerSwitchDebug!.snapshot().events).toHaveLength(0);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    window.clankerSwitchDebug!.enable();
    for (let n = 0; n < 600; n++) editorCreate('ws', 'tab', '/sensitive/name');
    const events = window.clankerSwitchDebug!.snapshot().events;
    expect(events).toHaveLength(512);
    expect(JSON.stringify(events)).not.toContain('/sensitive/name');
  });

  it('requires a visible non-inert laid-out shell across frame opportunities, and discards superseded switches', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const surface = document.createElement('section');
    surface.dataset.workspaceVisibility = 'active';
    surface.innerHTML = '<div class="dynamic-pane-layout"></div>';
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ width: 500, height: 400 } as DOMRect);
    window.clankerSwitchDebug!.enable(); window.clankerSwitchDebug!.clear();
    startSwitch('A', 'B', true);
    observeUsableWorkspaceFrame('B', surface);
    expect(window.clankerSwitchDebug!.snapshot().events.map(e => e.event)).toEqual(['switch_start']);
    startSwitch('B', 'A', true);
    frames.shift()!(0);
    expect(frames).toHaveLength(0);
    expect(window.clankerSwitchDebug!.snapshot().events.some(e => e.event === 'first_usable_shell_frame')).toBe(false);
    surface.setAttribute('inert', '');
    observeUsableWorkspaceFrame('A', surface);
    frames.shift()!(0); frames.shift()!(0);
    expect(window.clankerSwitchDebug!.snapshot().events.some(e => e.event === 'first_usable_shell_frame')).toBe(false);
    surface.removeAttribute('inert'); frames.shift()!(0);
    expect(window.clankerSwitchDebug!.snapshot().events.some(e => e.event === 'first_usable_shell_frame')).toBe(false);
    frames.shift()!(0);
    expect(window.clankerSwitchDebug!.snapshot().events.slice(-1)[0]).toMatchObject({ event: 'first_usable_shell_frame', data: { workspaceId: 'A' } });
  });
});
