/**
 * User-facing wording for OpenSSH transport failures (exit 255). Only the primary message is
 * improved: SshExecutionError keeps the raw stdout/stderr for logs and debugging, and ordinary
 * remote command failures (any other exit code) are never described as connection problems.
 */
export type SshFailureKind =
  | 'auth' | 'host-key' | 'dns' | 'refused' | 'unreachable' | 'timeout' | 'lost' | 'other';

const RULES: ReadonlyArray<readonly [SshFailureKind, RegExp, string]> = [
  ['host-key', /host key verification failed|remote host identification has changed|host key for .* has changed/i,
    'SSH host-key verification failed or the host key changed. Check known_hosts and the server host key.'],
  ['auth', /permission denied|authentication failed|too many authentication failures|no supported authentication methods/i,
    'SSH authentication failed. Check the key, SSH agent and account for this server.'],
  ['dns', /could not resolve hostname|name or service not known|temporary failure in name resolution|nodename nor servname/i,
    'The SSH host could not be resolved. Check the hostname and DNS.'],
  ['refused', /connection refused/i,
    'The SSH connection was refused. Check that sshd is running and the port is correct.'],
  ['unreachable', /no route to host|network is unreachable|host is unreachable/i,
    'The SSH host is unreachable. Check the network, VPN or Tailscale connection.'],
  ['timeout', /connection timed out|operation timed out|timed out during banner exchange/i,
    'The SSH connection timed out.'],
  ['lost', /connection reset|broken pipe|connection closed|kex_exchange_identification|connection lost/i,
    'The SSH connection was lost.'],
];

export function classifySshTransportFailure(stderr: string): { kind: SshFailureKind; message: string } {
  for (const [kind, pattern, message] of RULES) {
    if (pattern.test(stderr)) return { kind, message };
  }
  const detail = stderr.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return {
    kind: 'other',
    message: detail ? `SSH connection failed: ${detail}` : 'SSH connection failed or authentication required interactive login.',
  };
}
