/** Bounded, memory-only failure diagnostics for headless dev services. Never written to disk. */

export const DIAGNOSTIC_TAIL_BYTES = 32 * 1024;
export const DIAGNOSTIC_ROW_CHARS = 1000;

/** Newest rows win. Rows are already stripped of terminal control sequences by `createTerminalOutputRows`. */
export class DiagnosticTail {
  private rows: string[] = [];
  private head = 0;
  private size = 0;
  constructor(private readonly limit = DIAGNOSTIC_TAIL_BYTES) {}
  push(row: string): void {
    const text = row.trim();
    if (!text) return;
    const bounded = text.length > DIAGNOSTIC_ROW_CHARS ? `${text.slice(0, DIAGNOSTIC_ROW_CHARS)}…` : text;
    this.rows.push(bounded);
    this.size += bounded.length + 1;
    while (this.size > this.limit && this.head < this.rows.length - 1) this.size -= this.rows[this.head++].length + 1;
    if (this.head > 512) { this.rows = this.rows.slice(this.head); this.head = 0; }
  }
  text(): string { return this.rows.slice(this.head).join('\n'); }
}

export interface PortConflict { port?: number }

// A server that reports the port is busy but then picks another one is not failing.
const FALLBACK = /\b(?:trying|using|will use|instead|another|next available)\b/i;
const NAMED_PORT = /\bport\s+(\d{2,5})\s+is\s+(?:already\s+)?in\s+use\b/i;
const OS_REFUSAL = /EADDRINUSE|address already in use/i;

/**
 * Recognizes one output row that says a requested port is occupied. Only a candidate: it becomes a
 * diagnosis solely if the service then fails without ever becoming ready.
 */
export function classifyPortConflict(row: string): PortConflict | undefined {
  const named = !FALLBACK.test(row) ? NAMED_PORT.exec(row) : null;
  if (named) return { port: Number(named[1]) };
  if (!OS_REFUSAL.test(row)) return undefined;
  const ports = [...row.matchAll(/:(\d{2,5})(?!\d)/g)];
  const port = ports.length ? Number(ports[ports.length - 1][1]) : undefined;
  return { port: port !== undefined && port <= 65535 ? port : undefined };
}

export function describePortConflict(conflict: PortConflict): string {
  return `${conflict.port !== undefined ? `Port ${conflict.port} is already in use` : 'A port the dev server needs is already in use'} by another process. Clanker did not stop it.`;
}
