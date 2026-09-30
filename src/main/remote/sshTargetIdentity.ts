import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { validateSshTarget } from '../../shared/sshValidation';

/** Resource safeguards share an effective OpenSSH destination across aliases.
 * This is separate from environment-scoped workspace/UI identity.
 */
export async function resolveSshTargetIdentity(target: string): Promise<string> {
  if (!validateSshTarget(target).valid) throw new Error('Invalid SSH target');
  const config = await new Promise<string>((resolve, reject) => {
    execFile('ssh', ['-G', '-o', 'PermitLocalCommand=no', target], {
      env: withoutAttentionEnvironment(process.env), timeout: 10000, maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout));
  });
  const fields = new Map(config.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(' ');
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  const hostname = fields.get('hostname');
  const user = fields.get('user');
  const port = fields.get('port');
  if (!hostname || !user || !port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Could not resolve the SSH destination for workspace resource protection');
  }
  // Proxy routes may give identical private hostnames different meanings.
  const identity = [hostname.toLowerCase(), user, Number(port), fields.get('proxyjump') ?? 'none', fields.get('proxycommand') ?? 'none'];
  // ProxyCommand may contain credentials. Persist only an opaque digest.
  return `ssh:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}
