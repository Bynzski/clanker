import { describe, it, expect } from 'vitest';
import { toPosixPath, toNativePath } from '../../../src/shared/pathNormalize';

describe('toPosixPath', () => {
  it('leaves POSIX paths unchanged', () => {
    expect(toPosixPath('/home/user/project')).toBe('/home/user/project');
    expect(toPosixPath('/')).toBe('/');
    expect(toPosixPath('relative/path')).toBe('relative/path');
  });

  it('converts Windows drive-letter paths', () => {
    expect(toPosixPath('C:\\Users\\Jay\\Projects')).toBe('C:/Users/Jay/Projects');
    expect(toPosixPath('D:\\')).toBe('D:/');
    expect(toPosixPath('c:\\foo\\bar\\baz')).toBe('c:/foo/bar/baz');
  });

  it('converts UNC paths', () => {
    expect(toPosixPath('\\\\server\\share\\dir')).toBe('//server/share/dir');
    expect(toPosixPath('\\\\server\\share')).toBe('//server/share');
  });

  it('converts mixed-separator paths', () => {
    expect(toPosixPath('C:\\Users\\Jay/Projects/clanker')).toBe('C:/Users/Jay/Projects/clanker');
    expect(toPosixPath('C:/Users\\Jay/Projects')).toBe('C:/Users/Jay/Projects');
  });

  it('handles empty string', () => {
    expect(toPosixPath('')).toBe('');
  });
});

describe('toNativePath', () => {
  describe('on win32', () => {
    const platform = 'win32';

    it('converts POSIX paths to backslashes', () => {
      expect(toNativePath('/home/user/project', platform)).toBe('\\home\\user\\project');
      expect(toNativePath('/', platform)).toBe('\\');
    });

    it('converts drive-letter paths', () => {
      expect(toNativePath('C:/Users/Jay/Projects', platform)).toBe('C:\\Users\\Jay\\Projects');
      expect(toNativePath('D:/', platform)).toBe('D:\\');
      expect(toNativePath('c:/foo/bar/baz', platform)).toBe('c:\\foo\\bar\\baz');
    });

    it('converts UNC paths', () => {
      expect(toNativePath('//server/share/dir', platform)).toBe('\\\\server\\share\\dir');
      expect(toNativePath('//server/share', platform)).toBe('\\\\server\\share');
    });

    it('round-trips with toPosixPath (drive letter)', () => {
      const original = 'C:\\Users\\Jay\\Projects';
      const posix = toPosixPath(original);
      const backToNative = toNativePath(posix, platform);
      expect(backToNative).toBe(original);
    });

    it('round-trips with toPosixPath (UNC)', () => {
      const original = '\\\\server\\share\\dir';
      const posix = toPosixPath(original);
      const backToNative = toNativePath(posix, platform);
      expect(backToNative).toBe(original);
    });

    it('round-trips with toPosixPath (root)', () => {
      const original = 'C:\\';
      const posix = toPosixPath(original);
      expect(posix).toBe('C:/');
      const backToNative = toNativePath(posix, platform);
      expect(backToNative).toBe(original);
    });
  });

  describe('on linux', () => {
    const platform = 'linux';

    it('returns POSIX paths unchanged', () => {
      expect(toNativePath('/home/user/project', platform)).toBe('/home/user/project');
      expect(toNativePath('/', platform)).toBe('/');
    });

    it('does not convert backslashes on linux', () => {
      // On linux, backslashes are valid filename characters — don't touch them
      expect(toNativePath('C:\\Users\\Jay', platform)).toBe('C:\\Users\\Jay');
    });
  });

  describe('on darwin', () => {
    const platform = 'darwin';

    it('returns POSIX paths unchanged', () => {
      expect(toNativePath('/Users/jay/project', platform)).toBe('/Users/jay/project');
    });
  });

  it('handles empty string', () => {
    expect(toNativePath('', 'win32')).toBe('');
    expect(toNativePath('', 'linux')).toBe('');
  });
});
