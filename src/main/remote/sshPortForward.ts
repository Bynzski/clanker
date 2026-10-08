import { execFile, spawn } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { withoutAttentionEnvironment } from '../environment/attentionEnvironment';
import { validateSshTarget } from '../../shared/sshValidation';
import { isPreviewPort } from '../../shared/types/remotePreview';

export interface PortForwardHandle {
  close(): Promise<void>;
}

export class PreviewTransportError extends Error {
  constructor(public readonly kind: 'bind-conflict' | 'policy' | 'connection', message: string) { super(message); }
}
export function previewTransportError(diagnostic: string): PreviewTransportError {
  if (/administratively prohibited|forwarding disabled|rejected TCP forwarding/i.test(diagnostic)) return new PreviewTransportError('policy', 'SSH server rejected TCP forwarding');
  if (/address already in use|cannot listen to port|bind.*failed/i.test(diagnostic)) return new PreviewTransportError('bind-conflict', 'Local port conflict; trying another port');
  if (/host key verification failed|remote host identification has changed/i.test(diagnostic)) return new PreviewTransportError('connection', 'SSH host-key verification failed');
  if (/permission denied|authentication failed/i.test(diagnostic)) return new PreviewTransportError('connection', 'SSH authentication failed');
  return new PreviewTransportError('connection', 'SSH connection lost');
}

export async function startSshPortForward(
  target: string, localPort: number, remotePort: number, signal: AbortSignal, onExit: (error: string) => void, remoteHost: '127.0.0.1' | '::1' = '127.0.0.1',
): Promise<PortForwardHandle> {
  if (!validateSshTarget(target).valid || !isPreviewPort(localPort) || !isPreviewPort(remotePort) || !['127.0.0.1', '::1'].includes(remoteHost)) {
    throw new Error('Invalid SSH preview target or port');
  }
  const env = withoutAttentionEnvironment(process.env);
  // Read supported options so older Windows OpenSSH clients need no newer keywords.
  const config = await new Promise<string>((resolve, reject) => {
    execFile('ssh', ['-G', '-o', 'ClearAllForwardings=no', '-o', 'PermitLocalCommand=no', target], {
      env, signal, timeout: 10000, maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => error ? reject(previewTransportError(stderr || error.message)) : resolve(stdout));
  });
  if (signal.aborted) throw new Error('Remote preview was cancelled');
  if (/^(?:localforward|remoteforward|dynamicforward)\s/m.test(config)) {
    throw new Error('This SSH target already configures port forwards. Use a target without configured forwards for managed previews.');
  }
  // SSH listener readiness is independent of service health. Channel policy
  // failures remain fatal when the first HTTP probe attempts the destination.
  const args = ['-T', '-N', '-a', '-x', '-o', 'LogLevel=DEBUG2',
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ClearAllForwardings=no', '-o', 'GatewayPorts=no',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'PermitLocalCommand=no',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2'];
  for (const [key, value] of [['forkafterauthentication', 'no'], ['stdinnull', 'no'], ['sessiontype', 'none']]) {
    if (new RegExp(`^${key}\\s`, 'm').test(config)) args.push('-o', `${key}=${value}`);
  }
  const destination = remoteHost === '::1' ? '[::1]' : remoteHost;
  args.push('-L', `127.0.0.1:${localPort}:${destination}:${remotePort}`, target);
  // -N owns only a transport: no long-lived remote Python/helper process.
  const child = spawn('ssh', args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stopping = false;
  let ready = false;
  let closed = false;
  let stderr = '';
  let diagnosticLine = '';
  let probe: Socket | undefined;
  let forwardingFailure: string | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const close = () => {
    if (!stopping && !closed) {
      stopping = true;
      probe?.destroy();
      child.kill('SIGTERM');
      forceKill = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 1000);
      forceKill.unref();
    }
    return closedPromise;
  };
  return new Promise<PortForwardHandle>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void close().then(() => reject(previewTransportError(message)));
    };
    const timeout = setTimeout(() => fail('SSH preview connection timed out'), 15000);
    const abort = () => { if (!ready) fail('Remote preview was cancelled'); else void close(); };
    signal.addEventListener('abort', abort, { once: true });
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnosticLine += chunk.toString('utf8');
      let newline: number;
      while ((newline = diagnosticLine.indexOf('\n')) !== -1) {
        const line = diagnosticLine.slice(0, newline).trim();
        diagnosticLine = diagnosticLine.slice(newline + 1);
        // Keep user-facing errors free of verbose SSH configuration/handshake logs.
        if (!/^debug[123]:/.test(line)) stderr = (stderr + line + '\n').slice(-4096);
        // A target refusal/time-out belongs to service health, not SSH health.
        if (/^channel \d+: open failed:.*administratively prohibited/i.test(line)) {
          const message = 'SSH server rejected TCP forwarding';
          if (!ready) fail('administratively prohibited');
          else if (!stopping) { forwardingFailure = message; void close(); }
        }
        if (/address already in use|cannot listen to port/i.test(line) && !ready) fail(line);
        if (!settled && !probe && line.includes(`Local forwarding listening on 127.0.0.1 port ${localPort}`)) {
          probe = createConnection({ host: '127.0.0.1', port: localPort });
          probe.once('error', () => fail('Local forwarding listener unavailable'));
          probe.once('connect', () => {
            if (settled || stopping || closed) return;
            settled = true; ready = true; clearTimeout(timeout); probe?.destroy(); resolve({ close });
          });
        }
      }
      if (diagnosticLine.length > 4096) diagnosticLine = diagnosticLine.slice(-4096);
    });
    child.on('error', (error) => fail(`Could not start SSH preview: ${error.message}`));
    child.on('close', (code) => {
      closed = true;
      probe?.destroy();
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      signal.removeEventListener('abort', abort);
      resolveClosed();
      const message = forwardingFailure || (stderr + diagnosticLine).trim() || `SSH preview connection closed (exit ${code ?? 'unknown'})`;
      if (!settled) { settled = true; reject(previewTransportError(message)); }
      else if (ready && (!stopping || forwardingFailure)) onExit(previewTransportError(message).message);
    });
    if (signal.aborted) abort();
  });
}
