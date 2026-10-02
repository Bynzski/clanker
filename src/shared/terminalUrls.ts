// WHATWG URL is provided by both Node and Chromium. Keep this module free of
// Node/DOM imports so the shared build needs neither host-specific type library.
declare const URL: new (value: string) => { protocol: string; toString(): string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;

export function trimTrailingPunctuation(value: string): string {
  let result = value.replace(/[.,;!?]+$/g, '');
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;

  for (const [open, close] of pairs) {
    while (result.endsWith(close)) {
      const openCount = result.split(open).length - 1;
      const closeCount = result.split(close).length - 1;
      if (closeCount <= openCount) break;
      result = result.slice(0, -1);
    }
  }

  return result;
}

export function normalizeTerminalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function findTerminalUrls(line: string): Array<{ text: string; target: string; startIndex: number }> {
  const matches = [];
  for (const match of line.matchAll(URL_PATTERN)) {
    const text = trimTrailingPunctuation(match[0]);
    const target = normalizeTerminalUrl(text);
    if (target && match.index != null) matches.push({ text, target, startIndex: match.index });
  }
  return matches;
}
