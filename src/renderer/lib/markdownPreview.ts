import { dirnamePath } from './pathUtils';
import { editorFileCheckout, fileCheckoutForPath, pathInFileCheckout } from './fileCheckout';
import type { EditorTab, WorkspaceTab } from '../store/workspaceTypes';

export function isMarkdownFile(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

export function markdownExternalUrl(href: string): string | undefined {
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Resolve only relative file links inside the tab's still-registered, pinned checkout.
 * Main's existing file read validates canonical/symlink containment and text eligibility.
 */
export function markdownFileTarget(workspace: WorkspaceTab, tab: EditorTab, href: string): string | undefined {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) return;
  let link: string;
  try { link = decodeURIComponent(href.split(/[?#]/, 1)[0]); } catch { return; }
  if (!link || link.startsWith('/') || /[\\\0\r\n]/.test(link) || /^[a-z][a-z\d+.-]*:/i.test(link)) return;

  const checkout = editorFileCheckout(workspace, tab);
  if (tab.checkoutContextId && !workspace.checkoutContexts?.some((context) => context.id === tab.checkoutContextId
    && context.workspaceId === workspace.id && context.environmentId === (workspace.environmentId ?? 'local')
    && context.path === checkout.workspacePath && !context.missing)) return;
  if (!pathInFileCheckout(checkout.workspacePath, tab.filePath)) return;

  const parts = dirnamePath(tab.filePath).split('/');
  for (const part of link.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  const target = parts.join('/');
  if (!pathInFileCheckout(checkout.workspacePath, target)) return;
  // Opening a file normally derives its context from its path. Never let a link
  // silently select a different registered root (even a nested checkout).
  const resolved = fileCheckoutForPath(workspace, target);
  if (resolved.workspacePath !== checkout.workspacePath) return;
  return target;
}
