import { describe, expect, it } from 'vitest';
import { validateFilename } from '../../../src/shared/filenameValidation';

describe('validateFilename', () => {
  it('accepts normal names', () => {
    expect(validateFilename('index.ts').valid).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateFilename('').valid).toBe(false);
  });

  it('rejects reserved windows names with extension', () => {
    expect(validateFilename('CON.txt').valid).toBe(false);
    expect(validateFilename('nul').valid).toBe(false);
    expect(validateFilename('CONIN$.log').valid).toBe(false);
    expect(validateFilename('CONOUT$.txt').valid).toBe(false);
  });

  it('rejects reserved names after Windows trailing-space normalization', () => {
    expect(validateFilename('CON .txt').valid).toBe(false);
    expect(validateFilename('NUL .md').valid).toBe(false);
  });

  it('rejects trailing dot or space', () => {
    expect(validateFilename('file.').valid).toBe(false);
    expect(validateFilename('file ').valid).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(validateFilename('bad:name.txt').valid).toBe(false);
  });

  it('rejects names longer than 255 bytes', () => {
    const long = `a${'é'.repeat(130)}`;
    expect(validateFilename(long).valid).toBe(false);
  });
});
