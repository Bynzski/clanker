import { describe, expect, it, vi } from 'vitest';
import { retireTerminal, retireTerminalAndWait, type RetirableTerminal } from '../../../src/main/terminalRetirement';

function table(...ids: string[]) {
  const log: string[] = [];
  const terminals = new Map<string, RetirableTerminal>();
  for (const id of ids) {
    terminals.set(id, {
      pty: { kill: vi.fn(() => { log.push(`kill ${id}`); }) },
      releaseResources: vi.fn(async () => { log.push(`release ${id}`); }),
    });
  }
  return { terminals, log };
}

describe('retireTerminal', () => {
  it('releases attention, disposes resources, kills the process and removes it from the table', async () => {
    const { terminals, log } = table('a', 'b');
    const releaseAttention = vi.fn((id: string) => { log.push(`attention ${id}`); });
    await retireTerminal({ terminals, releaseAttention }, 'a');

    expect(log).toEqual(['attention a', 'release a', 'kill a']);
    expect(terminals.has('a')).toBe(false);
    // Another terminal is untouched.
    expect(terminals.has('b')).toBe(true);
    expect(log.join()).not.toContain('b');
  });

  it('resolves only after resource cleanup finished', async () => {
    const { terminals } = table('a');
    let finish!: () => void;
    terminals.get('a')!.releaseResources = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    let done = false;
    const retired = retireTerminal({ terminals }, 'a').then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await retired;
    expect(done).toBe(true);
  });

  it('is idempotent and a no-op for an unknown terminal', async () => {
    const { terminals, log } = table('a');
    await retireTerminal({ terminals }, 'a');
    await retireTerminal({ terminals }, 'a');
    await retireTerminal({ terminals }, 'never-existed');
    expect(log).toEqual(['release a', 'kill a']);
  });

  it('a process that cannot be killed (Windows SIGTERM warning) does not stop retirement', async () => {
    const { terminals } = table('a');
    terminals.get('a')!.pty.kill = vi.fn(() => { throw new Error('kill failed'); });
    await expect(retireTerminal({ terminals }, 'a')).resolves.toBeUndefined();
    expect(terminals.has('a')).toBe(false);
  });

  it('works for terminals without a resource hook', async () => {
    const terminals = new Map<string, RetirableTerminal>([['plain', { pty: { kill: vi.fn() } }]]);
    await expect(retireTerminal({ terminals }, 'plain')).resolves.toBeUndefined();
    expect(terminals.size).toBe(0);
  });
});

describe('retireTerminalAndWait', () => {
  function process(_id: string, mode: 'prompt' | 'manual' | 'sigkill-only', log: string[]) {
    let markExited!: () => void;
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const terminal: RetirableTerminal = {
      exited,
      pty: { kill: vi.fn((signal?: string) => {
        log.push(signal ? `kill ${signal}` : 'kill');
        if (mode === 'prompt' || (mode === 'sigkill-only' && signal === 'SIGKILL')) setTimeout(markExited, 1);
      }) },
      releaseResources: vi.fn(async () => { log.push('release'); }),
    };
    return { terminal, exit: markExited };
  }
  const timing = { gracefulMs: 30, forcedMs: 30 };

  it('resolves "exited" only after the process\' own exit, with the record already out of the table', async () => {
    const log: string[] = [];
    const { terminal, exit } = process('a', 'manual', log);
    const terminals = new Map([['a', terminal]]);
    let outcome: string | undefined;
    const waiting = retireTerminalAndWait({ terminals }, 'a', { gracefulMs: 500, forcedMs: 500 }).then((value) => { outcome = value; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminals.has('a')).toBe(false);
    expect(outcome).toBeUndefined(); // gone from the table, still not proven dead
    exit();
    await waiting;
    expect(outcome).toBe('exited');
  });

  it('escalates to SIGKILL when the graceful kill is ignored', async () => {
    const log: string[] = [];
    const { terminal } = process('a', 'sigkill-only', log);
    expect(await retireTerminalAndWait({ terminals: new Map([['a', terminal]]) }, 'a', timing)).toBe('exited');
    expect(log).toEqual(expect.arrayContaining(['kill', 'kill SIGKILL']));
  });

  it('gives up with "timeout" (bounded) when nothing makes it exit', async () => {
    const log: string[] = [];
    const { terminal } = process('a', 'manual', log);
    const started = Date.now();
    expect(await retireTerminalAndWait({ terminals: new Map([['a', terminal]]) }, 'a', timing)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('cannot prove a terminal that has no exit signal, and an unknown id is "absent"', async () => {
    const log: string[] = [];
    const { terminal } = process('a', 'prompt', log);
    delete terminal.exited;
    expect(await retireTerminalAndWait({ terminals: new Map([['a', terminal]]) }, 'a', timing)).toBe('unverifiable');
    expect(await retireTerminalAndWait({ terminals: new Map() }, 'nope', timing)).toBe('absent');
  });

  it('revokes authority exactly as retireTerminal does (attention released, resources disposed)', async () => {
    const log: string[] = [];
    const { terminal } = process('a', 'prompt', log);
    const releaseAttention = vi.fn((id: string) => { log.push(`attention ${id}`); });
    await retireTerminalAndWait({ terminals: new Map([['a', terminal]]), releaseAttention }, 'a', timing);
    expect(log.slice(0, 3)).toEqual(['attention a', 'release', 'kill']);
  });
});
