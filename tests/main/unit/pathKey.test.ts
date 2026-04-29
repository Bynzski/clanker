import { describe, it, expect } from 'vitest';
import { pathKey } from '../../../src/shared/pathKey';

describe('pathKey', () => {
  it('normalizes and lowercases on Windows', () => {
    expect(pathKey('C:\\Users\\Jay\\Foo.txt', true)).toBe('c:/users/jay/foo.txt');
  });

  it('normalizes but preserves case on POSIX platforms', () => {
    expect(pathKey('/Users/Jay/Foo.txt', false)).toBe('/Users/Jay/Foo.txt');
  });

  it('treats case variants as equal on Windows and distinct on Linux', () => {
    expect(pathKey('C:/Repo/Foo.txt', true)).toBe(pathKey('c:/repo/foo.txt', true));
    expect(pathKey('/repo/Foo.txt', false)).not.toBe(pathKey('/repo/foo.txt', false));
  });
});
