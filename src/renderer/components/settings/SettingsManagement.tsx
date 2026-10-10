import type { ReactNode } from 'react';
import { ManagementShell } from '../ui/ManagementShell';
import type { DialogContentProps } from '../ui/Dialog';
import AppearanceSettings from './AppearanceSettings';
import WorkspaceLayoutSettings from './WorkspaceLayoutSettings';
import KeyboardShortcutsContent from './KeyboardShortcutsContent';
import './SettingsManagement.css';

const pages = [
  { id: 'appearance', label: 'Appearance', group: 'General', description: 'Choose the theme used throughout Clanker.' },
  { id: 'layout', label: 'Workspaces & Layout', group: 'General', description: 'Choose how to navigate between workspaces.' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', group: 'General', description: 'Search, edit and reset application shortcuts.' },
  { id: 'legacy', label: 'Legacy Settings', group: 'Transition', description: 'Harnesses, Accounts, Assistants, Git Preferences and Authentication remain here until the next migration phase.' },
] as const;
export type SettingsPage = typeof pages[number]['id'];

export default function SettingsManagement({ page, onPageChange, children, environmentId, ...props }:
  Omit<DialogContentProps, 'children'> & {
    page: SettingsPage;
    onPageChange: (page: SettingsPage) => void;
    environmentId: string;
    children: ReactNode;
  }) {
  const selected = pages.find((entry) => entry.id === page)!;
  return (
    <ManagementShell {...props} title="Settings" items={pages} selectedId={page}
      onSelect={(id) => onPageChange(id as SettingsPage)}>
      <div key={page} className="settings-management-page">
        <h2 className="management-page-title">{selected.label}</h2>
        <p className="management-page-description">{selected.description}</p>
        {page === 'appearance' && <AppearanceSettings />}
        {page === 'layout' && <WorkspaceLayoutSettings />}
        {page === 'shortcuts' && <KeyboardShortcutsContent />}
        {page === 'legacy' && <div className="settings-legacy">
          <p className="management-page-description">Account environment: {environmentId === 'local' ? 'Local' : `SSH · ${environmentId}`}. AI commit generation is local-only.</p>
          <p className="management-page-description">SSH Targets: open <strong>Open Workspace → target settings / Add server</strong> to use the existing manager.</p>
          {children}
        </div>}
      </div>
    </ManagementShell>
  );
}
