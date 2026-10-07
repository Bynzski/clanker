import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MarkdownPreview from '../../../src/renderer/components/MarkdownPreview';
import { markdownFileTarget } from '../../../src/renderer/lib/markdownPreview';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const tab = { id: 'md', filePath: '/workspace/README.md', fileName: 'README.md', content: '', originalContent: '', isDirty: false, hasExternalChange: false };
const fixture = (content: string) => createWorkspaceFixture({ id: 'ws', workspacePath: '/workspace', lifecycle: 'active', editorVisible: true,
  editorTabs: [{ ...tab, content }], activeEditorTabId: tab.id });
function preview(content: string, interactive = true) {
  const workspace = fixture(content);
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id });
  return render(<MarkdownPreview workspace={workspace} tab={workspace.editorTabs[0]} interactive={interactive} />);
}

beforeEach(() => { installElectronApiMock(); });

describe('Markdown preview', () => {
  it('renders CommonMark and GFM without creating code editors', () => {
    const { container } = preview('# Heading\n\n**Bold** and *emphasis* and `inline`.\n\n- Item\n- [x] Done\n\n1. First\n\n> Quote\n\n```ts\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n---');
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy();
    expect(container.querySelector('strong')).toHaveTextContent('Bold');
    expect(container.querySelector('em')).toHaveTextContent('emphasis');
    expect(container.querySelector('blockquote')).toHaveTextContent('Quote');
    expect(container.querySelector('pre code')).toHaveTextContent('const x = 1;');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('hr')).toBeTruthy();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });

  it('blocks raw HTML, scripts, event handlers, embeds and unsafe URLs', () => {
    const { container } = preview('<script>window.bad = true</script>\n\n<img src="x" onerror="window.bad=true">\n\n<iframe src="https://example.com"></iframe>\n\n<object data="x"></object>\n\n[Bad](javascript:alert%281%29)\n\n[Data](data:text/html,test)\n\n[File](file:///etc/passwd)\n\n![Remote](https://example.com/pixel.png)\n\n![Local](./image.png)');
    expect(container.querySelector('script, iframe, object, embed, img, [onerror], [onclick]')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Image: Remote')).toHaveAttribute('title', 'Images are not loaded in preview');
    expect(screen.getByText('Image: Local')).toBeTruthy();
  });

  it('opens HTTP(S) through the external-open bridge and relative files in this workspace', () => {
    const open = vi.spyOn(useWorkspaceStore.getState(), 'openFileInEditor').mockResolvedValue(undefined);
    preview('[Web](https://example.com/docs)\n\n[Architecture](./docs/architecture.md#overview)\n\n[Escape](../secrets.md)');
    fireEvent.click(screen.getByRole('link', { name: 'Web' }));
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    fireEvent.click(screen.getByRole('link', { name: 'Architecture' }));
    expect(open).toHaveBeenCalledWith('/workspace/docs/architecture.md', 'ws');
    expect(screen.queryByRole('link', { name: 'Escape' })).toBeNull();
    open.mockRestore();
  });

  it('routes an SSH relative file link through its pinned checkout read, not desktop paths', async () => {
    const context = { id: 'worktree', workspaceId: 'ssh-ws', environmentId: 'ssh:host', path: '/remote/worktree', kind: 'worktree' as const };
    const pinned = { ...tab, filePath: '/remote/worktree/README.md', checkoutContextId: context.id, checkoutRoot: context.path, content: '[Guide](./docs/guide.md)' };
    const workspace = createWorkspaceFixture({ id: 'ssh-ws', workspacePath: '/remote/main', environmentId: 'ssh:host', lifecycle: 'active',
      checkoutContexts: [context], editorTabs: [pinned], activeEditorTabId: tab.id });
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, pendingEditorOperations: {} });
    render(<MarkdownPreview workspace={workspace} tab={pinned} interactive />);
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Guide' })); });
    expect(window.electronAPI.editorReadFile).toHaveBeenCalledWith({ workspaceId: 'ssh-ws', workspacePath: '/remote/worktree',
      checkoutContextId: 'worktree', filePath: '/remote/worktree/docs/guide.md' });
    expect(window.electronAPI.openExternal).not.toHaveBeenCalled();
  });

  it('does not dispatch links while parked or after the workspace closes', () => {
    preview('[Web](https://example.com)', false);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('tabindex', '-1');
    fireEvent.click(link);
    expect(window.electronAPI.openExternal).not.toHaveBeenCalled();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
    fireEvent.click(link);
    expect(window.electronAPI.openExternal).not.toHaveBeenCalled();
  });
});

describe('Markdown file targets', () => {
  it.each(['../../secret.md', '%2e%2e/secret.md', '/etc/passwd', '//host/path', 'file:///etc/passwd', 'javascript:alert(1)', 'C:/secret.md', '..\\secret.md', '%00bad.md', '%ZZ'])('rejects %s', (href) => {
    expect(markdownFileTarget(fixture(''), tab, href)).toBeUndefined();
  });

  it('resolves directory-relative text links, including parent paths inside the root', () => {
    const ws = fixture('');
    expect(markdownFileTarget(ws, { ...tab, filePath: '/workspace/docs/readme.md' }, '../notes.md')).toBe('/workspace/notes.md');
    expect(markdownFileTarget(ws, tab, './docs/a%20b.markdown')).toBe('/workspace/docs/a b.markdown');
    expect(markdownFileTarget(ws, tab, '#heading')).toBeUndefined();
  });

  it('keeps SSH links on their owning workspace and rejects retired checkout links', () => {
    const context = { id: 'worktree', workspaceId: 'ws', environmentId: 'ssh:host', path: '/remote/worktree', kind: 'worktree' as const };
    const ws = createWorkspaceFixture({ id: 'ws', workspacePath: '/remote/main', environmentId: 'ssh:host', checkoutContexts: [context] });
    const pinned = { ...tab, filePath: '/remote/worktree/README.md', checkoutContextId: context.id, checkoutRoot: context.path };
    expect(markdownFileTarget(ws, pinned, './docs/a.md')).toBe('/remote/worktree/docs/a.md');
    expect(markdownFileTarget(ws, pinned, '../main/a.md')).toBeUndefined();
    expect(markdownFileTarget({ ...ws, checkoutContexts: [] }, pinned, './docs/a.md')).toBeUndefined();
    expect(markdownFileTarget({ ...ws, checkoutContexts: [{ ...context, missing: true }] }, pinned, './docs/a.md')).toBeUndefined();
  });

  it('supports canonical Windows IPC paths without granting drive or UNC links', () => {
    const ws = createWorkspaceFixture({ id: 'ws', workspacePath: 'C:/work/project' });
    expect(markdownFileTarget(ws, { ...tab, filePath: 'C:/work/project/README.md' }, './docs/a.md')).toBe('c:/work/project/docs/a.md');
    expect(markdownFileTarget(ws, { ...tab, filePath: 'C:/work/project/README.md' }, '../../secret.md')).toBeUndefined();
  });
});
