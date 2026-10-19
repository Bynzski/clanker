import { shell, type WebContents } from 'electron';
import { normalizeAppBrowserUrl, normalizeExternalUrl, normalizeWorkspaceFileBrowserUrl } from './security';

/** File links inherit only a currently registered local workspace's root. */
export function attachBrowserSecurityHandlers(contents: WebContents, getLocalRoot: () => string | null): void {
  const localUrl = (url: string) => normalizeWorkspaceFileBrowserUrl(url, getLocalRoot());
  const allowFileLink = (url: string, source: string) => Boolean(
    localUrl(contents.getURL()) && localUrl(source) && localUrl(url),
  );

  contents.setWindowOpenHandler(({ url }) => {
    // Electron supplies no initiating frame for popups. Require the entire frame
    // tree to be local so an embedded remote page cannot borrow the top-level grant.
    if (allowFileLink(url, contents.getURL())
      && contents.mainFrame.framesInSubtree.every(frame => localUrl(frame.url))) {
      void contents.loadURL(url).catch(() => {});
    } else {
      const externalUrl = normalizeExternalUrl(url);
      if (externalUrl) void shell.openExternal(externalUrl);
    }
    return { action: 'deny' };
  });

  contents.on('will-frame-navigate', event => {
    if (!normalizeAppBrowserUrl(event.url)
      && !(event.isMainFrame && allowFileLink(event.url, event.initiator?.url ?? ''))) {
      event.preventDefault();
    }
  });
  // A server redirect is never a local-document link, even when its original
  // request came from a file page or a trusted address-bar navigation.
  contents.on('will-redirect', event => {
    if (!normalizeAppBrowserUrl(event.url)) event.preventDefault();
  });
}
