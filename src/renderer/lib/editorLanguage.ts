import type { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { isMarkdownFile } from './markdownPreview';

export function getLanguageExtension(fileNameOrPath: string): Extension {
  const lower = fileNameOrPath.toLowerCase();

  if (isMarkdownFile(lower)) {
    return markdown();
  }

  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return javascript({ typescript: lower.endsWith('.ts') || lower.endsWith('.tsx') });
  }

  return [];
}
