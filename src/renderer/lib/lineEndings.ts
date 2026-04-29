export type LineEndingStyle = 'lf' | 'crlf';

function detectLineEndingStyle(content: string): LineEndingStyle {
  return content.includes('\r\n') ? 'crlf' : 'lf';
}

export function preserveOriginalLineEndings(content: string, originalContent: string): string {
  const originalStyle = detectLineEndingStyle(originalContent);
  if (originalStyle === 'lf') {
    return content;
  }

  return content.replace(/\r?\n/g, '\r\n');
}
