import type { IBuffer, IBufferLine, ILink } from '@xterm/xterm';
import type { TerminalLinkMatch } from './linkUtils';

interface LogicalBufferRow {
  bufferLineNumber: number;
  line: IBufferLine;
  startIndex: number;
  text: string;
  columns: number;
}

export interface LogicalBufferLine {
  text: string;
  rows: LogicalBufferRow[];
}

/** Read every physical buffer row belonging to the requested soft-wrapped logical line. */
export function readWrappedLogicalLine(
  buffer: Pick<IBuffer, 'getLine'>,
  bufferLineNumber: number,
  terminalColumns: number,
): LogicalBufferLine | null {
  let firstLineIndex = bufferLineNumber - 1;
  let firstLine = buffer.getLine(firstLineIndex);
  if (!firstLine) return null;

  while (firstLineIndex > 0 && firstLine.isWrapped) {
    const previousLine = buffer.getLine(firstLineIndex - 1);
    if (!previousLine) break;
    firstLineIndex -= 1;
    firstLine = previousLine;
  }

  const rows: LogicalBufferRow[] = [];
  let text = '';
  let lineIndex = firstLineIndex;
  let line: IBufferLine | undefined = firstLine;

  while (line) {
    const nextLine = buffer.getLine(lineIndex + 1);
    const hasWrappedContinuation = nextLine?.isWrapped === true;
    const columns = Math.min(line.length, terminalColumns);
    const rowText = line.translateToString(!hasWrappedContinuation, 0, columns);
    rows.push({
      bufferLineNumber: lineIndex + 1,
      line,
      startIndex: text.length,
      text: rowText,
      columns,
    });
    text += rowText;

    if (!hasWrappedContinuation) break;
    lineIndex += 1;
    line = nextLine;
  }

  return { text, rows };
}

function columnForStringOffset(
  row: LogicalBufferRow,
  stringOffset: number,
  endPosition: boolean,
): number | null {
  let offset = 0;

  for (let column = 0; column < row.columns;) {
    const cell = row.line.getCell(column);
    const width = cell?.getWidth() ?? 1;
    if (width === 0) {
      column += 1;
      continue;
    }

    // translateToString renders an empty width-one cell as a single space.
    const chars = cell?.getChars() || ' ';
    const cellEnd = offset + chars.length;
    if ((!endPosition && stringOffset < cellEnd) || (endPosition && stringOffset <= cellEnd)) {
      return endPosition ? column + Math.max(width, 1) : column + 1;
    }

    offset = cellEnd;
    column += Math.max(width, 1);
  }

  return null;
}

/** Convert a match in a logical wrapped line into xterm's 1-based multi-row range. */
export function linkRangeForMatch(
  logicalLine: LogicalBufferLine,
  match: TerminalLinkMatch,
): ILink['range'] | null {
  const matchEnd = match.startIndex + match.text.length;
  const startRow = logicalLine.rows.find((row) => (
    match.startIndex >= row.startIndex
    && match.startIndex < row.startIndex + row.text.length
  ));
  const endRow = logicalLine.rows.find((row) => (
    matchEnd > row.startIndex
    && matchEnd <= row.startIndex + row.text.length
  ));
  if (!startRow || !endRow) return null;

  const startColumn = columnForStringOffset(
    startRow,
    match.startIndex - startRow.startIndex,
    false,
  );
  const endColumn = columnForStringOffset(
    endRow,
    matchEnd - endRow.startIndex,
    true,
  );
  if (startColumn == null || endColumn == null) return null;

  return {
    start: { x: startColumn, y: startRow.bufferLineNumber },
    end: { x: endColumn, y: endRow.bufferLineNumber },
  };
}
