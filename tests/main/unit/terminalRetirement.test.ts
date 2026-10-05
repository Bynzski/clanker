import { describe, expect, it, vi } from 'vitest';
import { retireTerminal, type RetirableTerminal } from '../../../src/main/terminalRetirement';

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
