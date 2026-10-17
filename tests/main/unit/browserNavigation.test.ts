import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachBrowserSecurityHandlers } from '../../../src/main/browserNavigation';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));
import { shell } from 'electron';

describe('workspace local document navigation', () => {
  let fixture: string;
  let root: string | null;
  let current: string;
  let start: string;
  let target: string;
  let outside: string;
  let frames: { url: string }[];
  const listeners = new Map<string, (event: EventDetails) => void>();
  type EventDetails = { url: string; isMainFrame: boolean; initiator?: { url: string } | null; preventDefault: ReturnType<typeof vi.fn> };
  let popup: (details: { url: string }) => { action: string };
  const loadURL = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-browser-links-'));
    root = path.join(fixture, 'workspace');
    fs.mkdirSync(root);
    for (const name of ['index.html', 'page two.html']) fs.writeFileSync(path.join(root, name), '<p>local</p>');
    fs.writeFileSync(path.join(fixture, 'outside.html'), '<p>outside</p>');
    start = pathToFileURL(path.join(root, 'index.html')).href;
    target = pathToFileURL(path.join(root, 'page two.html')).href;
    outside = pathToFileURL(path.join(fixture, 'outside.html')).href;
    current = start;
    frames = [{ url: start }];
    const contents = {
      getURL: () => current,
      mainFrame: { get framesInSubtree() { return frames; } },
      loadURL,
      setWindowOpenHandler: (handler: typeof popup) => { popup = handler; },
      on: (name: string, handler: (event: EventDetails) => void) => { listeners.set(name, handler); },
    } as unknown as WebContents;
    attachBrowserSecurityHandlers(contents, () => root);
  });

  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  const navigate = (url: string, source: string | null = start, isMainFrame = true, name = 'will-frame-navigate') => {
    const event = { url, isMainFrame, initiator: source ? { url: source } : null, preventDefault: vi.fn() };
    listeners.get(name)!(event);
    return event.preventDefault;
  };

  test('permits resolved relative links, encoded names and anchors inside the workspace', () => {
    expect(navigate(new URL('./page%20two.html#section', start).href)).not.toHaveBeenCalled();
    expect(navigate(target)).not.toHaveBeenCalled();
    expect(navigate('https://example.com/')).not.toHaveBeenCalled();
  });

  test('rejects traversal, sibling prefixes, missing files, nonlocal hosts and unsafe protocols', () => {
    for (const url of [outside, new URL('../outside.html', start).href, `${start}/missing`,
      'file://server/share/page.html', 'file:///bad%2Fpath', 'javascript:alert(1)', 'data:text/html,hello']) {
      expect(navigate(url)).toHaveBeenCalledOnce();
    }
    const sibling = `${root}-other`;
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'index.html'), 'outside');
    expect(navigate(pathToFileURL(path.join(sibling, 'index.html')).href)).toHaveBeenCalledOnce();
  });

  test.skipIf(process.platform === 'win32')('rejects symlink escapes for both source and target', () => {
    const linked = path.join(root!, 'escape.html');
    fs.symlinkSync(path.join(fixture, 'outside.html'), linked);
    const url = pathToFileURL(linked).href;
    expect(navigate(url)).toHaveBeenCalledOnce();
    expect(navigate(target, url)).toHaveBeenCalledOnce();
    current = url;
    expect(navigate(target)).toHaveBeenCalledOnce();
  });

  test('requires actual local top-level and initiating documents and a live root', () => {
    expect(navigate(target, 'https://example.com/')).toHaveBeenCalledOnce();
    expect(navigate(target, null)).toHaveBeenCalledOnce();
    expect(navigate(target, start, false)).toHaveBeenCalledOnce();
    current = 'https://example.com/';
    expect(navigate(target)).toHaveBeenCalledOnce();
    current = outside;
    expect(navigate(target)).toHaveBeenCalledOnce();
    current = start;
    root = null; // Unregistered, SSH and Assistant owners confer no desktop file grant.
    expect(navigate(target)).toHaveBeenCalledOnce();
  });

  test('rejects redirect pivots even from a local starting document', () => {
    expect(navigate(target, start, true, 'will-redirect')).toHaveBeenCalledOnce();
    expect(navigate('https://example.com/', start, true, 'will-redirect')).not.toHaveBeenCalled();
  });

  test('opens safe local popup links in the same view without external file access', () => {
    expect(popup({ url: target })).toEqual({ action: 'deny' });
    expect(loadURL).toHaveBeenCalledExactlyOnceWith(target);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('rejects popup pivots from remote frames and outside roots, preserving external HTTP links', () => {
    popup({ url: outside });
    frames.push({ url: 'https://example.com/' });
    popup({ url: target });
    frames = [{ url: start }];
    current = 'https://example.com/';
    popup({ url: target });
    current = start;
    root = null;
    popup({ url: target });
    expect(loadURL).not.toHaveBeenCalled();
    popup({ url: 'https://example.com/' });
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/');
  });
});
