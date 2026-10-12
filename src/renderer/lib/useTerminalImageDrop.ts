import { useState, type DragEvent, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';

/** Local-file handoff only: the receiving TUI owns attachment interpretation. */
export function useTerminalImageDrop(
  terminalRef: RefObject<Terminal | null>,
  enabled: boolean,
  localFilesSupported = true,
) {
  const [dropError, setDropError] = useState<string | null>(null);

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    // Never let a rejected drop navigate the app to the image.
    event.preventDefault();
    event.stopPropagation();
    if (!enabled) return;
    setDropError(null);
    if (!localFilesSupported) {
      setDropError('Local image drops are not supported in SSH terminals. Copy the image to the remote host first.');
      return;
    }
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      setDropError('Drop one local image file. Save browser images to disk first.');
      return;
    }
    const file = files[0];
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)$/i.test(file.name)) {
      setDropError('Only image files can be dropped here.');
      return;
    }
    try {
      const path = window.electronAPI.resolveDroppedFilePath(file, event.dataTransfer.getData('text/uri-list'));
      // Do not invent a cwd-relative filename or paste control sequences from a filename.
      if (!path || Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
        setDropError('This image has no usable local path. Save it to disk and drop the saved file.');
        return;
      }
      const terminal = terminalRef.current;
      if (!terminal) {
        setDropError('The terminal is not ready. Try dropping the image again once connected.');
        return;
      }
      terminal.paste(`'${path.replace(/'/g, "'\"'\"'")}' `);
      terminal.focus();
    } catch {
      setDropError('Could not paste this image path. Try dropping a saved local image.');
    }
  };

  return { onDragOver, onDrop, dropError };
}
