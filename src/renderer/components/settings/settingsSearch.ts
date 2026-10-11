import { KEYBINDING_COMMANDS } from '../../../shared/keybindings';
import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import type { SettingsPage } from './SettingsManagement';
import type { AuthenticationSection } from './AuthenticationSettings';

export interface SettingsSearchResult {
  id: string; label: string; keywords: string; page: SettingsPage; target: string;
  harness?: string; authentication?: AuthenticationSection;
}
/** Navigation descriptors only: no values, discovery, secrets or operation callbacks. */
const SETTINGS_SEARCH_RESULTS: readonly SettingsSearchResult[] = [
  { id: 'theme', label: 'Appearance · Theme', keywords: 'dark light slate', page: 'appearance', target: 'setting-theme' },
  { id: 'layout', label: 'Workspaces · Sidebar / Tabs', keywords: 'layout navigation', page: 'layout', target: 'setting-workspace-sidebar' },
  { id: 'keyboard', label: 'Keyboard shortcuts', keywords: 'keybindings keyboard search', page: 'shortcuts', target: 'setting-keyboard' },
  ...KEYBINDING_COMMANDS.map((command): SettingsSearchResult => ({ id: `shortcut-${command.id}`, label: `Keyboard · ${command.label} shortcut`, keywords: `keybinding keyboard ${command.category}`, page: 'shortcuts', target: `shortcut-${command.id}` })),
  ...Object.values(HARNESS_DESCRIPTORS).flatMap((descriptor): SettingsSearchResult[] => {
    const base = (id: string, label: string, keywords: string, target: string): SettingsSearchResult => ({ id: `${descriptor.id}-${id}`, label: `${descriptor.name} · ${label}`, keywords, page: 'harnesses', target, harness: descriptor.id });
    return [base('visible', 'Launcher visibility', 'toolbar show hide harness', 'setting-harness-visible'),
      base('model', 'Default model / Favorites', 'model favorites', 'setting-harness-model'),
      base('flags', 'Extra flags', 'arguments', `flags-${descriptor.id}`),
      ...(descriptor.attention.local || descriptor.attention.remote ? [base('attention', 'Agent attention', 'attention notification', 'setting-harness-attention')] : []),
      ...('agentBridge' in descriptor ? [base('bridge', 'Clanker MCP bridge', 'mcp bridge', 'setting-harness-bridge')] : []),
      ...('usage' in descriptor ? [base('usage', 'Usage visibility', 'usage pin monitor', 'setting-harness-usage')] : []),
      ...('accounts' in descriptor ? [{ id: `${descriptor.id}-account`, label: `${descriptor.name} · Accounts`, keywords: 'account sign in manage', page: 'accounts' as const, target: 'account-harness', harness: descriptor.id }] : [])];
  }),
  { id: 'assistants', label: 'Hermes Assistants', keywords: 'hermes service autostart', page: 'assistants', target: 'setting-assistants' },
  { id: 'ai-commit', label: 'Git Preferences · AI commit messages', keywords: 'ai commit provider', page: 'git-preferences', target: 'ai-commit-provider' },
  { id: 'ai-model', label: 'Git Preferences · AI commit model', keywords: 'model', page: 'git-preferences', target: 'ai-commit-model' },
  { id: 'ssh-key', label: 'Authentication · SSH key', keywords: 'public key fingerprint git authentication', page: 'authentication', target: 'setting-ssh-key', authentication: 'ssh' },
  ...(['github', 'gitlab', 'bitbucket'] as const).map((provider) => ({ id: `${provider}-token`, label: `Authentication · ${provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : 'Bitbucket'} token`, keywords: 'access token authentication provider api', page: 'authentication' as const, target: 'setting-provider-token', authentication: provider })),
  { id: 'ssh-target', label: 'SSH Targets · Server address', keywords: 'ssh connection server target add edit', page: 'ssh-targets', target: 'setting-ssh-target' },
  { id: 'ssh-root', label: 'SSH Targets · Default workspace root', keywords: 'ssh path starting directory', page: 'ssh-targets', target: 'ssh-target-root' },
];
export function searchSettings(query: string, assistantsAvailable: boolean) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return SETTINGS_SEARCH_RESULTS.filter((item) => (item.page !== 'assistants' || assistantsAvailable) && terms.every((term) => `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(term)));
}
