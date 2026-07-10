// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { IBuffer, IBufferLine } from '@xterm/xterm';
import { findTerminalLinks } from '../../../src/renderer/lib/linkUtils';
import {
  linkRangeForMatch,
  readWrappedLogicalLine,
} from '../../../src/renderer/lib/terminalLinkRanges';

function createLine(
  text: string,
  isWrapped = false,
  blankColumns: ReadonlySet<number> = new Set(),
): IBufferLine {
  return {
    isWrapped,
    length: text.length,
    translateToString: (trimRight = false, startColumn = 0, endColumn = text.length) => {
      const value = text.slice(startColumn, endColumn);
      return trimRight ? value.trimEnd() : value;
    },
    getCell: (column: number) => {
      if (column < 0 || column >= text.length) return undefined;
      return {
        getChars: () => blankColumns.has(column) ? '' : text[column] ?? '',
        getWidth: () => 1,
      } as ReturnType<IBufferLine['getCell']>;
    },
  };
}

function createBuffer(lines: IBufferLine[]): Pick<IBuffer, 'getLine'> {
  return {
    getLine: (lineIndex: number) => lines[lineIndex],
  };
}

describe('terminal link ranges', () => {
  it('counts blank width-one cells rendered as spaces when mapping a link', () => {
    const text = '    https://x.test';
    const line = createLine(text, false, new Set([0, 1, 2, 3]));
    const logicalLine = readWrappedLogicalLine(createBuffer([line]), 1, 80);
    expect(logicalLine).toBeTruthy();

    const match = findTerminalLinks(logicalLine?.text ?? '', '/workspace')[0];
    expect(match?.text).toBe('https://x.test');
    expect(match && logicalLine ? linkRangeForMatch(logicalLine, match) : null).toEqual({
      start: { x: 5, y: 1 },
      end: { x: 18, y: 1 },
    });
  });

  it('joins soft-wrapped rows and returns a range spanning the complete URL', () => {
    const firstText = 'prefix https://example.';
    const secondText = 'com/very/long/path';
    const lines = [
      createLine(firstText),
      createLine(secondText, true),
    ];

    // Asking for either physical row resolves the same complete logical line.
    const fromFirstRow = readWrappedLogicalLine(createBuffer(lines), 1, firstText.length);
    const fromSecondRow = readWrappedLogicalLine(createBuffer(lines), 2, firstText.length);
    expect(fromFirstRow?.text).toBe(`${firstText}${secondText}`);
    expect(fromSecondRow?.text).toBe(`${firstText}${secondText}`);

    const match = findTerminalLinks(fromSecondRow?.text ?? '', '/workspace')[0];
    expect(match?.target).toBe('https://example.com/very/long/path');
    expect(match && fromSecondRow ? linkRangeForMatch(fromSecondRow, match) : null).toEqual({
      start: { x: 8, y: 1 },
      end: { x: secondText.length, y: 2 },
    });
  });
});
