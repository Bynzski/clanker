/**
 * Bounded complete-row observer, stripping CSI/OSC across PTY chunks. By default a row longer than the bound is
 * dropped (a cut row could hold half a URL); `truncate` keeps its leading part instead, for diagnostics.
 */
export function createTerminalOutputRows(notify: (row: string) => void, options: { truncate?: boolean } = {}): (data: string) => void {
  let row = '', escape: 'plain' | 'esc' | 'csi' | 'osc' | 'osc-esc' = 'plain', overflow = false;
  const complete = () => { if (!overflow || options.truncate) notify(row); row = ''; overflow = false; };
  return (data) => {
    for (const char of data) {
      if (escape === 'osc') { if (char === '\x07') escape = 'plain'; else if (char === '\x1b') escape = 'osc-esc'; continue; }
      if (escape === 'osc-esc') { escape = char === '\\' ? 'plain' : 'osc'; continue; }
      if (escape === 'csi') { if (char >= '@' && char <= '~') escape = 'plain'; continue; }
      if (escape === 'esc') { escape = char === '[' ? 'csi' : char === ']' ? 'osc' : 'plain'; continue; }
      if (char === '\x1b') { escape = 'esc'; continue; }
      if (char === '\n' || char === '\r') { complete(); continue; }
      if (row.length >= 4096) { overflow = true; continue; }
      if (char >= ' ' && char !== '\x7f') row += char;
    }
  };
}
