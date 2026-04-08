import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { extractRemoteHostname } from '../../../../src/main/credential/credentialService';

describe('extractRemoteHostname', () => {
  test('returns hostname for https remotes', () => {
    assert.equal(extractRemoteHostname('https://github.com/owner/repo.git'), 'github.com');
  });

  test('returns hostname for ssh:// style remotes', () => {
    assert.equal(extractRemoteHostname('ssh://git@github.com/owner/repo.git'), 'github.com');
  });

  test('returns hostname for SCP-style remotes', () => {
    assert.equal(extractRemoteHostname('git@github.com:owner/repo.git'), 'github.com');
  });

  test('returns null when remoteUrl is empty', () => {
    assert.strictEqual(extractRemoteHostname(''), null);
    assert.strictEqual(extractRemoteHostname('   '), null);
  });

  test('returns null when url cannot be parsed', () => {
    assert.strictEqual(extractRemoteHostname('not a url'), null);
  });
});
