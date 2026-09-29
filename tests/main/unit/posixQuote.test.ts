import { describe, it, expect } from 'vitest';
import { quotePosixArg, quotePosixCommand } from '../../../src/main/remote/posixQuote';

describe('posixQuote', () => {
  describe('quotePosixArg', () => {
    it('escapes empty string as empty single quotes', () => {
      expect(quotePosixArg('')).toBe("''");
    });

    it('escapes simple strings in single quotes', () => {
      expect(quotePosixArg('hello')).toBe("'hello'");
      expect(quotePosixArg('path/to/file')).toBe("'path/to/file'");
    });

    it('escapes spaces and tabs', () => {
      expect(quotePosixArg('hello world')).toBe("'hello world'");
      expect(quotePosixArg('foo\tbar')).toBe("'foo\tbar'");
    });

    it('escapes embedded single quotes safely', () => {
      expect(quotePosixArg("foo'bar")).toBe("'foo'\\''bar'");
      expect(quotePosixArg("'single'")).toBe("''\\''single'\\'''");
    });

    it('prevents command substitution and variable expansion', () => {
      expect(quotePosixArg('$(rm -rf /)')).toBe("'$(rm -rf /)'");
      expect(quotePosixArg('`rm -rf /`')).toBe("'`rm -rf /`'");
      expect(quotePosixArg('$HOME')).toBe("'$HOME'");
      expect(quotePosixArg('${PATH}')).toBe("'${PATH}'");
    });

    it('prevents shell control operators and redirection', () => {
      expect(quotePosixArg('foo; bar')).toBe("'foo; bar'");
      expect(quotePosixArg('foo && bar')).toBe("'foo && bar'");
      expect(quotePosixArg('foo | bar')).toBe("'foo | bar'");
      expect(quotePosixArg('foo > /dev/null')).toBe("'foo > /dev/null'");
      expect(quotePosixArg('foo < /dev/null')).toBe("'foo < /dev/null'");
    });

    it('escapes glob wildcards', () => {
      expect(quotePosixArg('*.txt')).toBe("'*.txt'");
      expect(quotePosixArg('?')).toBe("'?'");
      expect(quotePosixArg('[a-z]')).toBe("'[a-z]'");
    });
  });

  describe('quotePosixCommand', () => {
    it('joins command and arguments safely', () => {
      expect(quotePosixCommand('git', ['status', '--porcelain=v2']))
        .toBe("'git' 'status' '--porcelain=v2'");
    });

    it('handles commands with complex arguments', () => {
      expect(quotePosixCommand('git', ['commit', '-m', "Fix: user's bug with $VAR"]))
        .toBe("'git' 'commit' '-m' 'Fix: user'\\''s bug with $VAR'");
    });
  });
});
