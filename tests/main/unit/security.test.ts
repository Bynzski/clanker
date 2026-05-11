import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'vitest';
import {
  normalizeAppBrowserUrl,
  normalizeExternalUrl,
  normalizeTrustedAppBrowserUrl,
  resolveExistingDirectory,
} from '../../../src/main/security';

test('normalizeAppBrowserUrl allows only http and https URLs', () => {
  assert.equal(normalizeAppBrowserUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
  assert.equal(normalizeAppBrowserUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(normalizeAppBrowserUrl('file:///etc/passwd'), null);
  assert.equal(normalizeAppBrowserUrl('javascript:alert(1)'), null);
});

test('normalizeTrustedAppBrowserUrl allows app-initiated file navigation', () => {
  assert.equal(normalizeTrustedAppBrowserUrl('file:///tmp/report.html'), 'file:///tmp/report.html');
  assert.equal(normalizeTrustedAppBrowserUrl('/tmp/report.html'), 'file:///tmp/report.html');
  assert.equal(normalizeTrustedAppBrowserUrl('C:\\Users\\Jay\\report.html'), 'file:///C:/Users/Jay/report.html');
  assert.equal(normalizeTrustedAppBrowserUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
  assert.equal(normalizeTrustedAppBrowserUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTrustedAppBrowserUrl('file://evil.example/tmp/report.html'), null);
});

test('normalizeExternalUrl keeps mailto support but rejects local file access', () => {
  assert.equal(normalizeExternalUrl('mailto:test@example.com'), 'mailto:test@example.com');
  assert.equal(normalizeExternalUrl('https://openai.com/'), 'https://openai.com/');
  assert.equal(normalizeExternalUrl('file:///tmp/test.txt'), null);
});

test('resolveExistingDirectory returns the first existing directory candidate', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-grid-security-'));
  const nestedDirectory = path.join(tempRoot, 'nested');
  fs.mkdirSync(nestedDirectory);

  try {
    assert.equal(resolveExistingDirectory(nestedDirectory), nestedDirectory);
    assert.equal(resolveExistingDirectory(path.join(tempRoot, 'missing'), nestedDirectory), nestedDirectory);
    assert.equal(resolveExistingDirectory(path.join(tempRoot, 'missing')), null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
