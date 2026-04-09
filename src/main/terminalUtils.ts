/**
 * Terminal utilities and constants
 *
 * Shared terminal-related utilities used by main.ts and IPC modules.
 */

// Maximum size for terminal output buffer per terminal (1MB)
export const MAX_TERMINAL_BUFFER_BYTES = 1024 * 1024;

/**
 * Truncates a buffer string from the head if it exceeds the maximum byte cap.
 * Returns the buffer unchanged if it fits within the cap.
 */
export function trimBuffer(buffer: string, maxBytes: number): string {
  if (buffer.length <= maxBytes) {
    return buffer;
  }

  // Encode as UTF-8 and check actual byte length
  const encoder = new TextEncoder();
  const encoded = encoder.encode(buffer);

  if (encoded.length <= maxBytes) {
    return buffer;
  }

  // Truncate from the head to bring under the cap
  // Decode only the last maxBytes bytes
  const trimmed = new TextDecoder().decode(encoded.slice(-maxBytes));
  return trimmed;
}
