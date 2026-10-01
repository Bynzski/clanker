import * as fs from 'fs';
import * as readline from 'readline';

export function sessionMatchesWorkspace(
  workspacePath: string,
  candidatePath: string
): boolean {
  if (!workspacePath) return true;
  if (!candidatePath) return false;
  const norm = (p: string): string => {
    let s = p.replace(/\\/g, '/');
    if (process.platform === 'win32') s = s.toLowerCase();
    return s.endsWith('/') ? s : s + '/';
  };
  return norm(candidatePath).startsWith(norm(workspacePath));
}

const SESSION_FILE_CONCURRENCY = 16;

export async function mapSessionFiles<T, U>(items: T[], read: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(SESSION_FILE_CONCURRENCY, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await read(items[index]);
    }
  }));
  return results;
}

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readFirstLineJson<T>(filePath: string): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let done = false;
    let stream: fs.ReadStream | null = null;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 8192 });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.once('line', (line) => {
        done = true;
        rl.close();
        stream?.destroy();
        try {
          resolve(JSON.parse(line) as T);
        } catch {
          resolve(null);
        }
      });

      rl.once('close', () => {
        if (!done) resolve(null);
      });

      rl.once('error', (error) => isMissing(error) ? resolve(null) : reject(error));
      stream.once('error', (error) => isMissing(error) ? resolve(null) : reject(error));
    } catch (error) {
      if (isMissing(error)) resolve(null);
      else reject(error);
    }
  });
}
