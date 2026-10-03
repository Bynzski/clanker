import { describe, expect, it } from 'vitest';
import { classifySshTransportFailure } from '../../../src/main/remote/sshErrorMessages';

describe('classifySshTransportFailure', () => {
  it.each([
    ['user@host: Permission denied (publickey,password).', 'auth', 'authentication failed'],
    ['Host key verification failed.', 'host-key', 'host-key verification failed'],
    ['@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.', 'host-key', 'host key changed'],
    ['ssh: Could not resolve hostname nope.example: Name or service not known', 'dns', 'could not be resolved'],
    ['ssh: Temporary failure in name resolution', 'dns', 'could not be resolved'],
    ['ssh: connect to host h port 22: Connection refused', 'refused', 'refused'],
    ['ssh: connect to host h port 22: No route to host', 'unreachable', 'unreachable'],
    ['ssh: connect to host h port 22: Network is unreachable', 'unreachable', 'unreachable'],
    ['ssh: connect to host h port 22: Connection timed out', 'timeout', 'timed out'],
    ['Connection timed out during banner exchange', 'timeout', 'timed out'],
    ['Read from remote host h: Connection reset by peer', 'lost', 'lost'],
    ['client_loop: send disconnect: Broken pipe', 'lost', 'lost'],
    ['Connection closed by 10.0.0.1 port 22', 'lost', 'lost'],
  ])('classifies %j as %s', (stderr, kind, text) => {
    const result = classifySshTransportFailure(stderr);
    expect(result.kind).toBe(kind);
    expect(result.message).toContain(text);
  });

  it('prefers host-key over auth wording when both appear', () => {
    expect(classifySshTransportFailure('Host key verification failed.\nPermission denied').kind).toBe('host-key');
  });

  it('falls back to a concise generic message that keeps the first diagnostic line', () => {
    expect(classifySshTransportFailure('\nsomething odd happened\nmore')).toEqual({ kind: 'other', message: 'SSH connection failed: something odd happened' });
    expect(classifySshTransportFailure('').message).toMatch(/^SSH connection failed/);
  });
});
