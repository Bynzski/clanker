import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { validateSshTarget } from '../../shared/sshValidation';
import { isPreviewPort } from '../../shared/types/remotePreview';
import { quotePosixCommand } from './posixQuote';

export interface PortForwardHandle {
  close(): Promise<void>;
}

// A foreground, connection-scoped acknowledgement, using the host's existing Python.
// No helper is installed. EOF/SSH disconnect ends the process and releases the forward.
const READY_PYTHON = `import socket, sys
try:
    with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=3):
        pass
except OSError as error:
    sys.exit('Remote preview service is unavailable: ' + str(error))
print(sys.argv[2], flush=True)
sys.stdin.read()
`;

export async function startSshPortForward(
  target: string, localPort: number, remotePort: number, signal: AbortSignal, onExit: (error: string) => void,
): Promise<PortForwardHandle> {
  if (!validateSshTarget(target).valid || !isPreviewPort(localPort) || !isPreviewPort(remotePort)) {
    throw new Error('Invalid SSH preview target or port');
  }
  const env = withoutAttentionEnvironment(process.env);
  // Read supported options so older Windows OpenSSH clients need no newer keywords.
  const config = await new Promise<string>((resolve, reject) => {
    execFile('ssh', ['-G', '-o', 'ClearAllForwardings=no', '-o', 'PermitLocalCommand=no', target], {
      env, signal, timeout: 10000, maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout));
  });
  if (signal.aborted) throw new Error('Remote preview was cancelled');
  if (/^(?:localforward|remoteforward|dynamicforward)\s/m.test(config)) {
    throw new Error('This SSH target already configures port forwards. Use a target without configured forwards for managed previews.');
  }
  // DEBUG2 exposes channel-open confirmation; a local TCP connect alone only
  // proves the listener exists, not that sshd permits the forwarding destination.
  const args = ['-T', '-a', '-x', '-o', 'LogLevel=DEBUG2',
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ClearAllForwardings=no', '-o', 'GatewayPorts=no',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'PermitLocalCommand=no',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2'];
  for (const [key, value] of [['forkafterauthentication', 'no'], ['stdinnull', 'no'], ['sessiontype', 'default']]) {
    if (new RegExp(`^${key}\\s`, 'm').test(config)) args.push('-o', `${key}=${value}`);
  }
  const marker = `clanker-preview-${randomBytes(16).toString('hex')}`;
  args.push('-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, target,
    quotePosixCommand('python3', ['-u', '-c', READY_PYTHON, String(remotePort), marker]));
  const child = spawn('ssh', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stopping = false;
  let ready = false;
  let closed = false;
  let stderr = '';
  let stdout = '';
  let diagnosticLine = '';
  let probe: Socket | undefined;
  const probeChannels = new Set<string>();
  let forwardingFailure: string | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const close = () => {
    if (!stopping && !closed) {
      stopping = true;
      probe?.destroy();
      child.stdin?.end();
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
      void close().then(() => reject(new Error(message)));
    };
    const timeout = setTimeout(() => fail(stderr || 'SSH preview connection timed out'), 15000);
    const abort = () => { if (!ready) fail('Remote preview was cancelled'); else void close(); };
    signal.addEventListener('abort', abort, { once: true });
    child.stdin?.on('error', () => undefined);
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnosticLine += chunk.toString('utf8');
      let newline: number;
      while ((newline = diagnosticLine.indexOf('\n')) !== -1) {
        const line = diagnosticLine.slice(0, newline).trim();
        diagnosticLine = diagnosticLine.slice(newline + 1);
        // Keep user-facing errors free of verbose SSH configuration/handshake logs.
        if (!/^debug[123]:/.test(line)) stderr = (stderr + line + '\n').slice(-4096);
        const failure = line.match(/^channel \d+: open failed: (.+)$/);
        if (failure) {
          const message = `SSH preview forwarding failed: ${failure[1]}`;
          if (!ready) fail(message);
          else if (!stopping) { forwardingFailure = message; void close(); }
        }
        if (!probe || settled) continue;
        const opened = line.match(/^debug1: channel (\d+): new direct-tcpip\b/);
        if (opened) probeChannels.add(opened[1]);
        const confirmed = line.match(/^debug2: channel (\d+): open confirm\b/);
        if (confirmed && probeChannels.has(confirmed[1])) {
          settled = true;
          ready = true;
          clearTimeout(timeout);
          probe.destroy();
          resolve({ close });
        }
      }
      if (diagnosticLine.length > 4096) diagnosticLine = diagnosticLine.slice(-4096);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || probe) return;
      stdout += chunk.toString('utf8');
      if (stdout.split(/\r?\n/).includes(marker)) {
        probe = createConnection({ host: '127.0.0.1', port: localPort });
        probe.on('error', (error) => fail(`Could not verify SSH preview forwarding: ${error.message}`));
        probe.on('close', () => { if (!closed && !settled) fail('SSH preview forwarding closed before confirmation'); });
      } else if (stdout.length > 4096) fail('Invalid SSH preview acknowledgement');
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
      if (!settled) { settled = true; reject(new Error(message)); }
      else if (ready && (!stopping || forwardingFailure)) onExit(message);
    });
    if (signal.aborted) abort();
  });
}
