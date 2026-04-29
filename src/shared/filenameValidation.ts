const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/;
const MAX_FILENAME_BYTES = 255;

function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }

  return bytes;
}

export interface FilenameValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFilename(name: string): FilenameValidationResult {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Name cannot be empty' };
  }

  if (name.endsWith('.') || name.endsWith(' ')) {
    return { valid: false, error: 'Name cannot end with a dot or space' };
  }

  if (INVALID_FILENAME_CHARS.test(name)) {
    return { valid: false, error: 'Name contains invalid characters: < > : " / \\ | ? *' };
  }

  const byteLength = utf8ByteLength(name);
  if (byteLength > MAX_FILENAME_BYTES) {
    return { valid: false, error: 'Name exceeds 255 bytes' };
  }

  const baseBeforeExtension = name.split('.')[0] ?? '';
  const normalizedDeviceBase = baseBeforeExtension.replace(/[. ]+$/g, '').toUpperCase();
  if (RESERVED_WINDOWS_NAMES.has(normalizedDeviceBase)) {
    return { valid: false, error: 'Name is reserved by Windows' };
  }

  return { valid: true };
}
