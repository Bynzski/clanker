export interface TerminalGeometry { cols: number; rows: number }

export function isTerminalGeometry(value: unknown): value is TerminalGeometry {
  if (!value || typeof value !== 'object') return false;
  const { cols, rows } = value as Partial<TerminalGeometry>;
  return typeof cols === 'number' && typeof rows === 'number' && Number.isInteger(cols) && Number.isInteger(rows)
    && cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 1000;
}

/** Snapshot the IPC sizing hint before async launch work; it grants no launch authority. */
export function readInitialTerminalGeometry(value: unknown): TerminalGeometry | undefined {
  if (value === undefined) return undefined;
  if (!isTerminalGeometry(value)) throw new Error('Invalid initial terminal geometry');
  return { cols: value.cols, rows: value.rows };
}
