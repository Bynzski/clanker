import type { SshCommandExecutor } from './sshCommandExecutor';
import type { RemoteWebService } from '../../shared/types/remotePreview';
import { isPreviewPort } from '../../shared/types/remotePreview';
import { isPathContained } from './remotePaths';

/** One bounded, ephemeral command. Only host loopback listeners are probed;
 * no install, background process or network-range scan. */
export const WEB_DISCOVERY_PYTHON = String.raw`import concurrent.futures, json, os, re, select, shutil, socket, ssl, subprocess, sys, time
LIMIT = 32
FALLBACK = [3000, 3001, 4173, 5173, 6006, 8000, 8080, 8888]
def command(args):
    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    data = b''
    deadline = time.monotonic() + 2
    try:
        while time.monotonic() < deadline:
            if not select.select([child.stdout], [], [], max(0, deadline-time.monotonic()))[0]: break
            chunk = os.read(child.stdout.fileno(), 4096)
            if not chunk: return data.decode('utf-8', 'replace')
            data += chunk
            if len(data) > 131072: raise ValueError('Listener inventory too large')
        raise ValueError('Listener inventory timed out')
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=1)
def endpoint(value):
    host, _, raw_port = value.rpartition(':')
    host = host.strip('[]').split('%')[0]
    if host not in ('127.0.0.1', '0.0.0.0', '*', '::', '::1'): return None
    try: port = int(raw_port)
    except ValueError: return None
    if not 1024 <= port <= 65535: return None
    return ('::1' if host in ('::', '::1') else '127.0.0.1', port)
def metadata(host, port, pid=None, name=None, source='listener'):
    result = dict(remoteHost=host, remotePort=port, source=source)
    if name: result['processName'] = name[:128]
    if pid:
        result['pid'] = pid
        try: result['cwd'] = os.path.realpath(os.readlink('/proc/%s/cwd' % pid))
        except OSError: pass
    return result
def listeners():
    rows = []
    if shutil.which('ss'):
        for line in command(['ss', '-H', '-ltnp']).splitlines():
            fields = line.split()
            if len(fields) < 4: continue
            target = endpoint(fields[3])
            if not target: continue
            owner = re.search(r'"([^"]+)".*,pid=(\d+)', line)
            rows.append(metadata(*target, int(owner[2]) if owner else None, owner[1] if owner else None))
    elif shutil.which('lsof'):
        pid, name = None, None
        for line in command(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']).splitlines():
            if line.startswith('p'):
                try: pid = int(line[1:])
                except ValueError: pid = None
            elif line.startswith('c'): name = line[1:]
            elif line.startswith('n'):
                target = endpoint(line[1:].split(' ')[0])
                if target: rows.append(metadata(*target, pid, name))
    else:
        rows = [metadata('127.0.0.1', port, source='fallback') for port in FALLBACK]
    return rows
def probe(row):
    for protocol in ('http', 'https'):
        deadline = time.monotonic() + 0.7
        try:
            with socket.create_connection((row['remoteHost'], row['remotePort']), timeout=0.7) as connection:
                connection.settimeout(max(0.001, deadline-time.monotonic()))
                if protocol == 'https':
                    context = ssl._create_unverified_context()
                    connection = context.wrap_socket(connection, server_hostname='localhost')
                with connection:
                    connection.settimeout(max(0.001, deadline-time.monotonic()))
                    connection.sendall(b'HEAD / HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n')
                    status = b''
                    while len(status) < 512 and time.monotonic() < deadline:
                        connection.settimeout(max(0.001, deadline-time.monotonic()))
                        chunk = connection.recv(512-len(status))
                        if not chunk: break
                        status += chunk
                        if b'\n' in status: break
                    if re.match(br'^HTTP/1\.[01] [0-9]{3}\b', status):
                        return dict(row, protocol=protocol)
        except (OSError, ssl.SSLError): pass
    return None
request = json.load(sys.stdin)
rows = listeners()
# Explicit terminal URLs are additional bounded candidates, never a port sweep.
for hint in request.get('hints', [])[:8]:
    target = endpoint('%s:%s' % (hint.get('remoteHost'), hint.get('remotePort')))
    if target: rows.insert(0, metadata(*target, source='terminal-output'))
unique = {}
for row in rows:
    key = (row['remoteHost'], row['remotePort'])
    if key not in unique or row.get('cwd'): unique[key] = row
    if len(unique) >= LIMIT: break
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    print(json.dumps([result for result in pool.map(probe, unique.values()) if result]))
`;

export type RemoteWebEndpoint = Pick<RemoteWebService, 'remoteHost' | 'remotePort'>;
export async function discoverSshWebServices(executor: SshCommandExecutor, target: string, signal?: AbortSignal, hints: RemoteWebEndpoint[] = []): Promise<RemoteWebService[]> {
  const result = await executor.exec(target, 'python3', ['-c', WEB_DISCOVERY_PYTHON], {
    input: JSON.stringify({ hints: hints.slice(0, 8) }), signal, timeoutMs: 25000, maxBuffer: 32 * 1024,
  });
  if (signal?.aborted) throw new Error('Web service discovery cancelled');
  return parseWebInventory(result.stdout);
}
export function parseWebInventory(stdout: string): RemoteWebService[] {
  const data: unknown = JSON.parse(stdout);
  if (!Array.isArray(data) || data.length > 32) throw new Error('Invalid remote web inventory');
  return data.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid remote web service');
    const value = row as Record<string, unknown>;
    if (!['127.0.0.1', '::1'].includes(String(value.remoteHost)) || !isPreviewPort(value.remotePort)
      || !['http', 'https'].includes(String(value.protocol)) || !['listener', 'fallback', 'terminal-output'].includes(String(value.source))
      || (value.pid !== undefined && (!Number.isSafeInteger(value.pid) || Number(value.pid) <= 0))
      || (value.processName !== undefined && (typeof value.processName !== 'string' || value.processName.length > 128))
      || (value.cwd !== undefined && (typeof value.cwd !== 'string' || value.cwd.length > 4096 || !value.cwd.startsWith('/') || /[\x00-\x1f\x7f]/.test(value.cwd)))) throw new Error('Invalid remote web service');
    return { remoteHost: value.remoteHost as RemoteWebService['remoteHost'], remotePort: value.remotePort,
      protocol: value.protocol as RemoteWebService['protocol'], source: value.source as RemoteWebService['source'],
      ...(value.pid ? { pid: Number(value.pid) } : {}), ...(value.cwd ? { cwd: String(value.cwd) } : {}),
      ...(value.processName ? { processName: String(value.processName) } : {}) };
  });
}
export function associateWebServices(services: RemoteWebService[], workspacePath: string): RemoteWebService[] {
  return services.filter((service) => !service.cwd || isPathContained(workspacePath, service.cwd))
    .map((service) => ({ ...service, confidence: service.cwd && isPathContained(workspacePath, service.cwd) ? 'workspace' : 'unscoped' }));
}
