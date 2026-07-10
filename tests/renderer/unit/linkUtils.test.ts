// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  findTerminalLinks,
  resolveTerminalFilePath,
} from '../../../src/renderer/lib/linkUtils';

describe('terminal link utilities', () => {
  it('detects HTTP(S) URLs and trims sentence punctuation', () => {
    expect(findTerminalLinks(
      'Docs: https://api.example.com/docs?q=links, then http://localhost:3000/.',
      '/workspace',
    )).toEqual([
      {
        kind: 'url',
        text: 'https://api.example.com/docs?q=links',
        target: 'https://api.example.com/docs?q=links',
        startIndex: 6,
      },
      {
        kind: 'url',
        text: 'http://localhost:3000/',
        target: 'http://localhost:3000/',
        startIndex: 49,
      },
    ]);
  });

  it('detects relative, workspace-relative, and absolute workspace file paths', () => {
    const links = findTerminalLinks(
      'Edit ./src/main.ts, tests/unit/main.test.ts:24:7 and /workspace/README.md.',
      '/workspace',
    );

    expect(links.map(({ kind, text, target }) => ({ kind, text, target }))).toEqual([
      { kind: 'file', text: './src/main.ts', target: '/workspace/src/main.ts' },
      { kind: 'file', text: 'tests/unit/main.test.ts:24:7', target: '/workspace/tests/unit/main.test.ts' },
      { kind: 'file', text: '/workspace/README.md', target: '/workspace/README.md' },
    ]);
  });

  it('does not reinterpret path-shaped text inside a URL as a file', () => {
    const links = findTerminalLinks('See https://github.com/owner/repo/issues/6', '/workspace');

    expect(links).toHaveLength(1);
    expect(links[0]?.kind).toBe('url');
  });

  it('rejects relative traversal and absolute paths outside the workspace', () => {
    expect(resolveTerminalFilePath('../../etc/passwd', '/home/jay/project')).toBeNull();
    expect(resolveTerminalFilePath('/home/jay/other/secret.txt', '/home/jay/project')).toBeNull();
    expect(findTerminalLinks('Do not open ../../etc/passwd or /etc/passwd', '/workspace')).toEqual([]);
  });

  it('normalizes Windows paths and compares workspace containment case-insensitively', () => {
    expect(resolveTerminalFilePath(
      'c:\\Users\\Jay\\Project\\src\\main.ts:10',
      'C:/Users/Jay/Project',
    )).toBe('C:/Users/Jay/Project/src/main.ts');
    expect(resolveTerminalFilePath(
      'C:\\Users\\Jay\\Outside\\main.ts',
      'C:/Users/Jay/Project',
    )).toBeNull();
  });

  it('supports markdown-style file references without including the closing delimiter', () => {
    expect(findTerminalLinks('Open [the file](src/components/Button.tsx).', '/workspace')).toEqual([
      {
        kind: 'file',
        text: 'src/components/Button.tsx',
        target: '/workspace/src/components/Button.tsx',
        startIndex: 16,
      },
    ]);
  });
});
