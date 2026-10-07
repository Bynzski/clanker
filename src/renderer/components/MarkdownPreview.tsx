import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EditorTab, WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceStore } from '../store/workspaceStore';
import { markdownExternalUrl, markdownFileTarget } from '../lib/markdownPreview';
import './MarkdownPreview.css';

const plugins = [remarkGfm];

/** Untrusted project text: no raw HTML, automatic resource loads or renderer navigation. */
export default function MarkdownPreview({ workspace, tab, interactive }: {
  workspace: WorkspaceTab; tab: EditorTab; interactive: boolean;
}) {
  return <div className="markdown-preview" role="region" aria-label="Markdown preview" tabIndex={interactive ? 0 : -1}>
    <Markdown remarkPlugins={plugins} skipHtml components={{
      a: ({ href, children, title }) => {
        const external = href ? markdownExternalUrl(href) : undefined;
        const target = href ? markdownFileTarget(workspace, tab, href) : undefined;
        if (!external && !target) return <span title="Link unavailable in preview">{children}</span>;
        return <a href={external ?? '#'} title={title ?? href} tabIndex={interactive ? undefined : -1} aria-disabled={!interactive || undefined}
          onAuxClick={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            if (!interactive) return;
            const state = useWorkspaceStore.getState();
            const live = state.getWorkspaceById(workspace.id);
            const liveTab = live?.editorTabs.find((entry) => entry.id === tab.id && entry.filePath === tab.filePath);
            if (!live || !liveTab || !state.isWorkspaceActive(workspace.id)) return;
            if (external) void window.electronAPI.openExternal(external);
            else if (href) {
              const liveTarget = markdownFileTarget(live, liveTab, href);
              if (liveTarget) void state.openFileInEditor(liveTarget, live.id);
            }
          }}>{children}</a>;
      },
      // Neither file:// access nor unprompted remote image requests are granted
      // to project Markdown. A validated resource bridge can add images later.
      img: ({ alt }) => <span className="markdown-image-placeholder" title="Images are not loaded in preview">{alt ? `Image: ${alt}` : 'Image'}</span>,
    }}>{tab.content}</Markdown>
  </div>;
}
