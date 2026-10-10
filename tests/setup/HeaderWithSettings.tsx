import type { ComponentProps, ReactNode } from 'react';
import TitleBar from '../../src/renderer/components/TitleBar';
import { useWorkspaceNavigationStore } from '../../src/renderer/store/workspaceNavigationStore';
import Header from '../../src/renderer/components/Header';
import { ApplicationSettingsProvider } from '../../src/renderer/components/settings/ApplicationSettingsProvider';

/** Mirrors App's real conditional toolbar locations beneath one stable Settings owner. */
export function RelocatingToolbar({ children }: { children?: ReactNode }) {
  const sidebar = useWorkspaceNavigationStore((state) => state.mode === 'sidebar');
  return <ApplicationSettingsProvider>
    <TitleBar toolbar={sidebar ? <Header placement="titlebar" /> : undefined} />
    {!sidebar && <Header />}
    {children}
  </ApplicationSettingsProvider>;
}

/** Standalone toolbar tests use the same app-owned Settings boundary as App. */
export default function HeaderWithSettings(props: ComponentProps<typeof Header>) {
  return <ApplicationSettingsProvider><Header {...props} /></ApplicationSettingsProvider>;
}
