import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { installElectronApiMock } from '../../setup/electron';
import { useTerminalImageDrop } from '../../../src/renderer/lib/useTerminalImageDrop';

const paste = vi.fn();
const focus = vi.fn();
function Surface({ enabled = true, local = true, ready = true }) {
  const ref = useRef<Terminal | null>(null);
  useEffect(() => { ref.current = ready ? { paste, focus } as unknown as Terminal : null; }, [ready]);
  const { dropError, ...handlers } = useTerminalImageDrop(ref, enabled, local);
  return <><div data-testid="drop" {...handlers} />{dropError && <div role="status">{dropError}</div>}</>;
}
const image = () => new File(['image'], 'photo.png', { type: 'image/png' });
function drop(files: File[], uri = '') {
  return fireEvent.drop(screen.getByTestId('drop'), { dataTransfer: { files, getData: () => uri } });
}
beforeEach(() => { installElectronApiMock(); paste.mockClear(); focus.mockClear(); });

describe('terminal image drops', () => {
  it('quotes the real path, pastes without Enter and focuses the terminal', () => {
    vi.mocked(window.electronAPI.resolveDroppedFilePath).mockReturnValue("/images/a ' photo.png");
    render(<Surface />);
    expect(drop([image()], 'file:///images/photo.png')).toBe(false);
    expect(window.electronAPI.resolveDroppedFilePath).toHaveBeenCalledWith(expect.any(File), 'file:///images/photo.png');
    expect(paste).toHaveBeenCalledWith("'/images/a '\"'\"' photo.png' ");
    expect(focus).toHaveBeenCalledOnce();
  });
  it.each(['', '/images/evil\ncommand.png', '/images/evil\x1b[201~.png'])('rejects an unusable path %j instead of inventing a filename', (path) => {
    vi.mocked(window.electronAPI.resolveDroppedFilePath).mockReturnValue(path);
    render(<Surface />);
    drop([image()]);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Save it to disk');
  });
  it.each([[[]], [[image(), image()]]])('explains browser-only and multi-file drops', (files) => {
    render(<Surface />);
    expect(drop(files, 'https://example.com/photo.png')).toBe(false);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Drop one local image');
  });
  it('rejects non-images', () => {
    render(<Surface />);
    drop([new File(['text'], 'test.txt', { type: 'text/plain' })]);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Only image files');
  });
  it('blocks inactive or disconnected surfaces', () => {
    render(<Surface enabled={false} />);
    expect(drop([image()])).toBe(false);
    expect(window.electronAPI.resolveDroppedFilePath).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });
  it('does not send a desktop file path to an SSH terminal', () => {
    render(<Surface local={false} />);
    drop([image()]);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('remote host');
  });
  it('handles resolver failures visibly', () => {
    vi.mocked(window.electronAPI.resolveDroppedFilePath).mockImplementation(() => { throw new Error('invalid file'); });
    render(<Surface />);
    drop([image()]);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Could not paste');
  });
  it('reports a terminal that is not ready', () => {
    vi.mocked(window.electronAPI.resolveDroppedFilePath).mockReturnValue('/images/photo.png');
    render(<Surface ready={false} />);
    drop([image()]);
    expect(paste).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('not ready');
  });
});
