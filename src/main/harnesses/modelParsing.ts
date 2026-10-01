export function normalizeModelLine(line: string): string {
  return line
    .replace(/\u001B\[[0-9;]*m/g, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
}

