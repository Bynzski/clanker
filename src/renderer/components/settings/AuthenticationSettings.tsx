import { useEffect, useRef, useState } from 'react';
import { useVcsStore } from '../../store/vcsStore';
import type { GlobalCredentialStatusResult } from '../../../shared/types/credentials';
import type { VcsProvider } from '../../../shared/types/vcs';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Field, FieldLabel, FormMessage } from '../ui/Field';
import SettingsDeleteConfirmation from './SettingsDeleteConfirmation';
import './AuthenticationSettings.css';

// Extracted from CredentialSettings: main still owns all key/token operations.
const providers = [
  { id: 'github', name: 'GitHub', help: 'Use a personal access token. Classic and fine-grained tokens have different repository/API permission models; consult the documentation for the access you need.', docs: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' },
  { id: 'gitlab', name: 'GitLab', help: 'Use a personal access token with the API permissions required by your intended operations.', docs: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html' },
  { id: 'bitbucket', name: 'Bitbucket', help: 'Use a repository access token with only the repository permissions you need.', docs: 'https://support.atlassian.com/bitbucket-cloud/docs/using-repository-access-tokens/' },
] as const;
// The existing status API validates tokens in main. Share only its in-flight
// metadata request, including across page/provider remounts, and drain it before
// writing credentials so an old validation cannot overwrite newer metadata.
let pendingStatus: { api: typeof window.electronAPI.credentialGetGlobalStatus; promise: Promise<GlobalCredentialStatusResult> } | null = null;
function readStatus() {
  const api = window.electronAPI.credentialGetGlobalStatus;
  if (pendingStatus?.api === api) return pendingStatus.promise;
  const promise: Promise<GlobalCredentialStatusResult> = Promise.resolve().then(() => api());
  pendingStatus = { api, promise };
  const clear = () => { if (pendingStatus?.promise === promise) pendingStatus = null; };
  void promise.then(clear, clear);
  return promise;
}
export type AuthenticationSection = 'ssh' | 'github' | 'gitlab' | 'bitbucket';
export default function AuthenticationSettings({ section = 'ssh', onSectionChange, loadStatus = true }: {
  loadStatus?: boolean; section?: AuthenticationSection; onSectionChange: (section: AuthenticationSection) => void;
}) {
  return <div className="authentication-settings">
    <div className="authentication-sections" role="group" aria-label="Authentication sections">
      <Button aria-pressed={section === 'ssh'} onClick={() => onSectionChange('ssh')}>SSH Keys</Button>
      <Button aria-pressed={section !== 'ssh'} onClick={() => onSectionChange('github')}>Access Tokens</Button>
    </div>
    {section === 'ssh' ? <SshKeys loadStatus={loadStatus} /> : <>
      <Field><FieldLabel htmlFor="credential-provider">Provider</FieldLabel>
        <Select id="credential-provider" value={section} onChange={(event) => onSectionChange(event.target.value as AuthenticationSection)}>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </Select>
      </Field>
      <ProviderToken key={section} provider={section} loadStatus={loadStatus} />
    </>}
  </div>;
}
function useCredentialLifetime() {
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}
function SshKeys({ loadStatus }: { loadStatus: boolean }) {
  const { sshKey, setSshKey } = useVcsStore();
  const live = useCredentialLifetime();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const load = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setLoaded(false);
    try {
      const status = await window.electronAPI.credentialCheckExists();
      if (!live.current) return;
      if (status.exists) {
        setSshKey({ exists: true }); setLoaded(true);
        const key = await window.electronAPI.credentialGetPublicKey();
        if (!live.current) return;
        if (!key.success) throw new Error(key.error || 'Could not read public key');
        setSshKey({ exists: true, publicKey: key.publicKey, fingerprint: key.fingerprint });
      } else setSshKey({ exists: false });
      setLoaded(true);
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Could not load SSH key status'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => { if (loadStatus) void load(); }, [loadStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const mutate = async (remove: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setCopied(false);
    try {
      if (remove) {
        const result = await window.electronAPI.credentialDeleteSshKey();
        if (!live.current) return;
        if (!result.success) throw new Error(result.error || 'Failed to delete SSH key');
        setSshKey({ exists: false });
      } else {
        const result = await window.electronAPI.credentialGenerateSshKey();
        if (!live.current) return;
        if (!result.success) throw new Error(result.error || 'Failed to generate SSH key');
        setSshKey({ exists: true, publicKey: result.publicKey, fingerprint: result.fingerprint });
      }
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'SSH key operation failed'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return <section id="setting-ssh-key" tabIndex={-1} className="authentication-section" aria-label="SSH keys">
    <p role="status">{!loaded ? (busy ? 'Loading SSH key status…' : error ? 'SSH key status unavailable' : 'Refresh key status to load credentials.') : sshKey.exists ? 'SSH key configured' : 'No SSH key configured'}</p>
    {error && <FormMessage variant="error">{error}</FormMessage>}
    {loaded && sshKey.exists && <>
      <Field><FieldLabel htmlFor="credential-public-key">Public key</FieldLabel>
        <Input id="credential-public-key" value={sshKey.publicKey ?? ''} readOnly />
      </Field>
      {sshKey.fingerprint && <p>Fingerprint: <code>{sshKey.fingerprint}</code></p>}
      <Button disabled={busy || !sshKey.publicKey} onClick={() => {
        setError('');
        void navigator.clipboard.writeText(sshKey.publicKey ?? '').then(() => { if (live.current) setCopied(true); }, () => { if (live.current) setError('Failed to copy to clipboard'); });
      }}>{copied ? 'Copied' : 'Copy Public Key'}</Button>
    </>}
    <div className="authentication-actions">
      <Button disabled={busy} onClick={() => void load()}>Refresh key status</Button>
      {loaded && (sshKey.exists ? <Button disabled={busy} onClick={() => setDeleting(true)}>Delete SSH Key</Button> :
        <Button variant="primary" disabled={busy} onClick={() => void mutate(false)}>Generate SSH Key</Button>)}
    </div>
    <p className="management-page-description">Local ED25519 key for Git over SSH. Add its public key to your Git host and configure your local SSH client to select this key. The private key stays on this machine with filesystem access protections; remote Git uses the remote host's credentials.</p>
    {deleting && <SettingsDeleteConfirmation title="Delete SSH key?" description="Delete Clanker's local SSH key pair. This cannot be undone; Git connections relying on it will need a new key." onCancel={() => setDeleting(false)} onConfirm={() => void mutate(true)} />}
  </section>;
}
function ProviderToken({ provider, loadStatus }: { provider: Exclude<AuthenticationSection, 'ssh'>; loadStatus: boolean }) {
  const { storedPats, setStoredPat, removeStoredPat } = useVcsStore();
  const live = useCredentialLifetime();
  const info = providers.find((item) => item.id === provider)!;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const publishStatus = async () => {
    setLoaded(false);
    const status = await readStatus();
    if (!live.current) return;
    // Status/validation metadata only, never stored token bytes or guessed permissions.
    for (const item of providers) {
      const pat = status.storedPats.find((entry) => entry.provider === item.id);
      setStoredPat(item.id as VcsProvider, pat ? { ...pat, provider: item.id } : null);
    }
    setLoaded(true);
  };
  const run = async (operation: 'status' | 'save' | 'delete') => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (operation !== 'status') {
        if (pendingStatus?.api === window.electronAPI.credentialGetGlobalStatus) await pendingStatus.promise.catch(() => undefined);
        if (!live.current) return;
        const result = operation === 'save' ? await window.electronAPI.credentialSavePat(provider, input) : await window.electronAPI.credentialDeletePat(provider);
        if (!live.current) return;
        if (!result.success) throw new Error(result.error || 'Token operation failed');
        setInput('');
        if (operation === 'delete') removeStoredPat(provider);
      }
      await publishStatus();
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Could not load credential status'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => { if (loadStatus) void run('status'); }, [loadStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const pat = storedPats[provider];
  return <section className="authentication-section" aria-label={`${info.name} access token`}>
    <p role="status">{!loaded ? (busy ? 'Loading token status…' : error ? 'Token status unavailable' : 'Refresh token status to load credentials and validation.') : pat ? `Token saved · ${pat.validated ? 'Validated' : 'Not validated'}` : 'Not configured'}</p>
    {pat && loaded && <p>Declared scopes: {pat.scope.length ? pat.scope.join(', ') : 'None declared'} · Saved {pat.storedAt}</p>}
    <p className="management-page-description">{info.name} tokens authenticate Clanker's provider API functionality only. They do not configure Git credential helpers. Tokens are encrypted by the operating system; grant only the scopes you need.</p>
    <p className="management-page-description">{info.help}</p>
    {provider === 'gitlab' && <p className="management-page-description">This form manages the gitlab.com token. Self-managed GitLab origins require separate main-owned instance authorization; this form does not approve or configure them.</p>}
    <Button variant="ghost" onClick={() => {
      void window.electronAPI.openExternal(info.docs).then((opened) => { if (!opened && live.current) setError('Could not open documentation.'); }, () => { if (live.current) setError('Could not open documentation.'); });
    }}>{info.name} token documentation</Button>
    <Field><FieldLabel htmlFor="setting-provider-token">New access token</FieldLabel>
      <Input id="setting-provider-token" type="password" autoComplete="off" value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} placeholder="Paste your token here" />
    </Field>
    {error && <FormMessage variant="error">{error}</FormMessage>}
    <div className="authentication-actions">
      <Button variant="primary" disabled={busy || !input.trim()} onClick={() => void run('save')}>Save Token</Button>
      <Button disabled={busy} onClick={() => setInput('')}>Cancel</Button>
      <Button disabled={busy} onClick={() => void run('status')}>Refresh token status</Button>
      {pat && loaded && <Button disabled={busy} onClick={() => setDeleting(true)}>Remove Token</Button>}
    </div>
    {deleting && <SettingsDeleteConfirmation title={`Delete ${info.name} token?`} description={`Remove the stored ${info.name} API token from this device. This does not revoke it at the provider or alter Git credentials.`} onCancel={() => setDeleting(false)} onConfirm={() => void run('delete')} />}
  </section>;
}
