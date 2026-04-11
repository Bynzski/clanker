/**
 * Terminal utilities and constants shared by main and renderer.
 */

declare const TextEncoder: {
  new(): { encode(input: string): Uint8Array };
};

declare const TextDecoder: {
  new(): { decode(input?: Uint8Array): string };
};

// Maximum size for terminal output buffer per terminal.
// Keep this bounded so we do not retain an entire agent conversation in memory.
export const MAX_TERMINAL_BUFFER_BYTES = 512 * 1024;

// Match xterm's retention window to the app-side buffer policy.
export const TERMINAL_SCROLLBACK_LINES = 1000;

/**
 * Truncates a buffer string from the head if it exceeds the maximum byte cap.
 * Returns the buffer unchanged if it fits within the cap.
 */
export function trimBuffer(buffer: string, maxBytes: number): string {
  if (maxBytes <= 0 || buffer.length === 0) {
    return '';
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(buffer);

  if (encoded.length <= maxBytes) {
    return buffer;
  }

  // Truncate from the head to keep the newest output only.
  const trimmed = new TextDecoder().decode(encoded.slice(-maxBytes));
  return trimmed;
}
