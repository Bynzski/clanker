import { useEffect, useRef, type ReactNode } from 'react';
import { ManagementShell } from '../ui/ManagementShell';
import type { DialogContentProps } from '../ui/Dialog';
import AppearanceSettings from './AppearanceSettings';
import WorkspaceLayoutSettings from './WorkspaceLayoutSettings';
import KeyboardShortcutsContent from './KeyboardShortcutsContent';
import AssistantsSettings from './AssistantsSettings';
import './SettingsManagement.css';

const pages = [
  { id: 'appearance', label: 'Appearance', group: 'General', description: 'Choose the theme used throughout Clanker.' },
  { id: 'layout', label: 'Workspaces & Layout', group: 'General', description: 'Choose how to navigate between workspaces.' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', group: 'General', description: 'Search, edit and reset application shortcuts.' },
  { id: 'harnesses', label: 'Harnesses', group: 'Agents & AI', description: 'Configure defaults for future agent launches.' },
  { id: 'accounts', label: 'Accounts', group: 'Agents & AI', description: 'Manage sign-ins for the selected harness and environment.' },
  { id: 'assistants', label: 'Assistants', group: 'Agents & AI', description: 'Optional local Hermes Assistants, independent of the ordinary Hermes harness.' },
  { id: 'git-preferences', label: 'Git Preferences', group: 'Source Control', description: 'AI commit generation is local-only. These application preferences do not change Git operations.' },
  { id: 'authentication', label: 'Authentication', group: 'Source Control', description: 'Local Git SSH keys and provider API access tokens. These are distinct authentication mechanisms.' },
  { id: 'ssh-targets', label: 'SSH Targets', group: 'Connections', description: 'Manage saved OpenSSH targets. Changes are validated by main; active environments cannot be edited or deleted.' },
] as const;
export type SettingsPage = typeof pages[number]['id'];

export default function SettingsManagement({ page, onPageChange, children, environmentId, assistantsAvailable = false, headerActions, busy = false, focusTarget, ...props }:
  Omit<DialogContentProps, 'children'> & {
    page: SettingsPage;
    onPageChange: (page: SettingsPage) => void;
    environmentId: string;
    children: ReactNode;
    assistantsAvailable?: boolean;
    headerActions?: ReactNode;
    busy?: boolean;
    focusTarget?: { id: string; serial: number } | null;
  }) {
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusTarget) return;
    const container = pageRef.current;
    const heading = container?.firstElementChild as HTMLElement | null;
    if (!container || !heading) return;
    heading.focus();
    const reveal = () => {
      if (document.activeElement !== heading) return true; // User moved on; never steal focus later.
      const target = document.getElementById(focusTarget.id);
      if (!target || !container.contains(target)) return false;
      target.scrollIntoView?.({ block: 'nearest' });
      if (target.hasAttribute('disabled')) return false;
      target.focus(); return true;
    };
    if (reveal()) return;
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    const timeout = setTimeout(() => observer.disconnect(), 3000);
    return () => { clearTimeout(timeout); observer.disconnect(); };
  }, [page, focusTarget]);
  const visiblePages = pages.filter((entry) => entry.id !== 'assistants' || assistantsAvailable);
  const selected = visiblePages.find((entry) => entry.id === page) ?? pages[0];
  return (
    <ManagementShell {...props} title="Settings" items={visiblePages} selectedId={page} headerActions={headerActions} busy={busy}
      onSelect={(id) => onPageChange(id as SettingsPage)}>
      <div ref={pageRef} key={page} className="settings-management-page">
        <h2 tabIndex={-1} className="management-page-title">{selected.label}</h2>
        <p className="management-page-description">{selected.description}</p>
        {page === 'appearance' && <AppearanceSettings />}
        {page === 'layout' && <WorkspaceLayoutSettings />}
        {page === 'shortcuts' && <KeyboardShortcutsContent key={focusTarget?.serial ?? 'page'} />}
        {(page === 'harnesses' || page === 'accounts') && <p className="management-page-description">Environment: {environmentId === 'local' ? 'Local' : `SSH · ${environmentId}`}.{page === 'harnesses' ? ' Defaults are application-wide; launch support is explained below.' : ' Accounts are scoped to this environment.'}</p>}
        {page === 'assistants' && assistantsAvailable && <AssistantsSettings />}
        {(page === 'harnesses' || page === 'accounts' || page === 'git-preferences') && children}
        {(page === 'authentication' || page === 'ssh-targets') && children}
      </div>
    </ManagementShell>
  );
}
