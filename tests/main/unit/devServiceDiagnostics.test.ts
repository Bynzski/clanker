import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_ROW_CHARS, DiagnosticTail, classifyPortConflict, describePortConflict } from '../../../src/main/services/devServiceDiagnostics';
import { createTerminalOutputRows } from '../../../src/main/terminalOutputRows';

describe('DiagnosticTail', () => {
  it('keeps the newest rows within a strict bound under high-volume output', () => {
    const tail = new DiagnosticTail(1024);
    for (let index = 0; index < 100_000; index++) tail.push(`line ${index}`);
    const text = tail.text();
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text.endsWith('line 99999')).toBe(true);
    expect(text).not.toContain('line 0\n');
  });
  it('truncates one over-long row, never the whole buffer, and skips blank rows', () => {
    const tail = new DiagnosticTail();
    tail.push('   '); tail.push('y'.repeat(50_000)); tail.push('the real error');
    const rows = tail.text().split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0].length).toBeLessThanOrEqual(DIAGNOSTIC_ROW_CHARS + 1);
    expect(rows[1]).toBe('the real error');
  });
  it('keeps the leading part of an over-long terminal row when truncation is requested, and still strips escapes', () => {
    const rows: string[] = [];
    const feed = createTerminalOutputRows((row) => rows.push(row), { truncate: true });
    feed(`\x1b[31m${'z'.repeat(10_000)}\x1b[0m\nnext\n`);
    expect(rows[0]).toHaveLength(4096);
    expect(rows[0]).not.toContain('\x1b');
    expect(rows[1]).toBe('next');
    const dropped: string[] = [];
    createTerminalOutputRows((row) => dropped.push(row))(`${'z'.repeat(10_000)}\nnext\n`);
    expect(dropped).toEqual(['next']); // URL detection still never sees half a row
  });
});

describe('classifyPortConflict', () => {
  it.each([
    ['Error: Port 5173 is already in use', 5173],
    ['port 3000 is already in use', 3000],
    ['Error: listen EADDRINUSE: address already in use :::8080', 8080],
    ['Error: listen EADDRINUSE: address already in use 127.0.0.1:4000', 4000],
  ])('recognizes %j', (row, port) => expect(classifyPortConflict(row)).toEqual({ port }));
  it('recognizes an OS refusal without a port', () => expect(classifyPortConflict('bind: Address already in use')).toEqual({ port: undefined }));
  it.each([
    'Port 5173 is in use, trying another one...',
    'Port 3000 is in use, using available port 3001 instead.',
    'VITE ready in 120 ms on http://localhost:5173/',
    'GET /api/ports 200',
  ])('ignores %j', (row) => expect(classifyPortConflict(row)).toBeUndefined());
  it('describes only what is known and never claims the port owner', () => {
    expect(describePortConflict({ port: 1420 })).toBe('Port 1420 is already in use by another process. Clanker did not stop it.');
    expect(describePortConflict({})).toContain('A port the dev server needs');
  });
});
