import type { ReactNode } from 'react';
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
  { id: 'legacy', label: 'Legacy Settings', group: 'Transition', description: 'Authentication and SSH Targets retain their existing entry points until Phase 2B.' },
] as const;
export type SettingsPage = typeof pages[number]['id'];

export default function SettingsManagement({ page, onPageChange, children, environmentId, assistantsAvailable = false, ...props }:
  Omit<DialogContentProps, 'children'> & {
    page: SettingsPage;
    onPageChange: (page: SettingsPage) => void;
    environmentId: string;
    children: ReactNode;
    assistantsAvailable?: boolean;
  }) {
  const visiblePages = pages.filter((entry) => entry.id !== 'assistants' || assistantsAvailable);
  const selected = visiblePages.find((entry) => entry.id === page) ?? pages[0];
  return (
    <ManagementShell {...props} title="Settings" items={visiblePages} selectedId={page}
      onSelect={(id) => onPageChange(id as SettingsPage)}>
      <div key={page} className="settings-management-page">
        <h2 className="management-page-title">{selected.label}</h2>
        <p className="management-page-description">{selected.description}</p>
        {page === 'appearance' && <AppearanceSettings />}
        {page === 'layout' && <WorkspaceLayoutSettings />}
        {page === 'shortcuts' && <KeyboardShortcutsContent />}
        {(page === 'harnesses' || page === 'accounts') && <p className="management-page-description">Environment: {environmentId === 'local' ? 'Local' : `SSH · ${environmentId}`}.{page === 'harnesses' ? ' Defaults are application-wide; launch support is explained below.' : ' Accounts are scoped to this environment.'}</p>}
        {page === 'assistants' && assistantsAvailable && <AssistantsSettings />}
        {(page === 'harnesses' || page === 'accounts' || page === 'git-preferences') && children}
        {page === 'legacy' && <div className="settings-legacy">
          <p className="management-page-description">SSH Targets: open <strong>Open Workspace → target settings / Add server</strong> to use the existing manager.</p>
          {children}
        </div>}
      </div>
    </ManagementShell>
  );
}
