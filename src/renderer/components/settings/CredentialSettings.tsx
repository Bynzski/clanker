/**
 * Credential Settings Component
 * UI for managing VCS credentials (SSH keys and PATs).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Key,
  Copy,
  Trash2,
  Plus,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useVcsStore } from '../../store/vcsStore';
import type { VcsProvider } from '../../../shared/types/vcs';
import './CredentialSettings.css';

interface CredentialSettingsProps {
  /** Current workspace path for getting remote info */
  workspacePath?: string;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal closes */
  onClose: () => void;
}

/**
 * Provider display configuration.
 */
const PROVIDERS: Array<{ id: VcsProvider; name: string; docsUrl: string }> = [
  {
    id: 'github',
    name: 'GitHub',
    docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    docsUrl: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    docsUrl: 'https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/',
  },
];

/**
 * Get provider info by ID.
 */
function getProviderInfo(id: VcsProvider) {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export default function CredentialSettings({ isOpen, onClose }: CredentialSettingsProps) {
  const {
    sshKey,
    storedPats,
    isLoading,
    setSshKey,
    setStoredPat,
    removeStoredPat,
    setLoading,
    setError,
  } = useVcsStore();

  const [activeTab, setActiveTab] = useState<'ssh' | 'tokens'>('ssh');
  const [patInput, setPatInput] = useState<Record<VcsProvider, string>>({
    github: '',
    gitlab: '',
    bitbucket: '',
    unknown: '',
  });
  const [patProvider, setPatProvider] = useState<VcsProvider>('github');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPat, setIsSavingPat] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  // Load credential status on mount
  useEffect(() => {
    if (!isOpen) return;

    const loadCredentials = async () => {
      setLoading(true);
      try {
        const [sshStatus, globalStatus] = await Promise.all([
          window.electronAPI.credentialCheckExists(),
          window.electronAPI.credentialGetGlobalStatus(),
        ]);

        if (sshStatus.exists) {
          const pubKeyResult = await window.electronAPI.credentialGetPublicKey();
          setSshKey({
            exists: true,
            publicKey: pubKeyResult.success ? pubKeyResult.publicKey : undefined,
            fingerprint: pubKeyResult.success ? pubKeyResult.fingerprint : undefined,
          });
        } else {
          setSshKey({ exists: false });
        }

        // Load stored PATs
        for (const pat of globalStatus.storedPats) {
          setStoredPat(pat.provider as VcsProvider, {
            provider: pat.provider as VcsProvider,
            scope: pat.scope,
            storedAt: pat.storedAt,
            validated: pat.validated,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load credentials');
      } finally {
        setLoading(false);
      }
    };

    loadCredentials();
  }, [isOpen, setLoading, setSshKey, setStoredPat, setError]);

  // Handle SSH key generation
  const handleGenerateSshKey = useCallback(async () => {
    setIsGenerating(true);
    setOperationError(null);

    try {
      const result = await window.electronAPI.credentialGenerateSshKey();
      if (result.success) {
        setSshKey({
          exists: true,
          publicKey: result.publicKey,
          fingerprint: result.fingerprint,
        });
      } else {
        setOperationError(result.error || 'Failed to generate SSH key');
      }
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : 'Failed to generate SSH key');
    } finally {
      setIsGenerating(false);
    }
  }, [setSshKey]);

  // Handle SSH key deletion
  const handleDeleteSshKey = useCallback(async () => {
    if (!confirm('Are you sure you want to delete your SSH key? This action cannot be undone.')) {
      return;
    }

    setOperationError(null);
    try {
      const result = await window.electronAPI.credentialDeleteSshKey();
      if (result.success) {
        setSshKey({ exists: false });
      } else {
        setOperationError(result.error || 'Failed to delete SSH key');
      }
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : 'Failed to delete SSH key');
    }
  }, [setSshKey]);

  // Handle copying public key
  const handleCopyPublicKey = useCallback(async () => {
    if (!sshKey.publicKey) return;

    setIsCopying(true);
    setCopySuccess(false);

    try {
      await navigator.clipboard.writeText(sshKey.publicKey);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setOperationError('Failed to copy to clipboard');
    } finally {
      setIsCopying(false);
    }
  }, [sshKey.publicKey]);

  // Handle PAT save
  const handleSavePat = useCallback(async () => {
    const token = patInput[patProvider];
    if (!token.trim()) {
      setOperationError('Please enter a token');
      return;
    }

    setIsSavingPat(true);
    setOperationError(null);

    try {
      const result = await window.electronAPI.credentialSavePat(patProvider, token);
      if (result.success) {
        setStoredPat(patProvider, {
          provider: patProvider,
          scope: ['repo'],
          storedAt: new Date().toISOString(),
          validated: false,
        });
        setPatInput((prev) => ({ ...prev, [patProvider]: '' }));
      } else {
        setOperationError(result.error || 'Failed to save token');
      }
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : 'Failed to save token');
    } finally {
      setIsSavingPat(false);
    }
  }, [patInput, patProvider, setStoredPat]);

  // Handle PAT deletion
  const handleDeletePat = useCallback(
    async (provider: VcsProvider) => {
      if (!confirm(`Remove stored token for ${getProviderInfo(provider).name}?`)) {
        return;
      }

      try {
        const result = await window.electronAPI.credentialDeletePat(provider);
        if (result.success) {
          removeStoredPat(provider);
        } else {
          setOperationError(result.error || 'Failed to delete token');
        }
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : 'Failed to delete token');
      }
    },
    [removeStoredPat]
  );

  if (!isOpen) return null;

  return (
    <div className="credential-settings-overlay" onClick={onClose}>
      <div className="credential-settings" onClick={(e) => e.stopPropagation()}>
        <div className="credential-settings-header">
          <h2>VCS Credentials</h2>
          <button className="credential-settings-close" onClick={onClose} type="button">
            <Plus size={18} style={{ transform: 'rotate(45deg)' }} />
          </button>
        </div>

        <div className="credential-settings-tabs">
          <button
            type="button"
            className={`credential-tab ${activeTab === 'ssh' ? 'active' : ''}`}
            onClick={() => setActiveTab('ssh')}
          >
            <Key size={14} />
            SSH Keys
          </button>
          <button
            type="button"
            className={`credential-tab ${activeTab === 'tokens' ? 'active' : ''}`}
            onClick={() => setActiveTab('tokens')}
          >
            <RefreshCw size={14} />
            Access Tokens
          </button>
        </div>

        <div className="credential-settings-body">
          {operationError && (
            <div className="credential-error">
              <AlertCircle size={14} />
              {operationError}
            </div>
          )}

          {activeTab === 'ssh' && (
            <div className="credential-ssh-section">
              <div className="credential-ssh-status">
                <div className="credential-status-label">SSH Key Status</div>
                {isLoading ? (
                  <div className="credential-status-loading">
                    <Loader2 size={14} className="spin" />
                    Loading...
                  </div>
                ) : sshKey.exists ? (
                  <div className="credential-status-active">
                    <Check size={14} className="credential-status-icon success" />
                    <span>SSH key configured</span>
                  </div>
                ) : (
                  <div className="credential-status-inactive">
                    <AlertCircle size={14} className="credential-status-icon warning" />
                    <span>No SSH key configured</span>
                  </div>
                )}
              </div>

              {sshKey.exists && sshKey.publicKey && (
                <div className="credential-ssh-key-info">
                  <div className="credential-key-header">
                    <span className="credential-key-label">Public Key</span>
                    <button
                      type="button"
                      className="credential-copy-btn"
                      onClick={handleCopyPublicKey}
                      disabled={isCopying}
                    >
                      {copySuccess ? (
                        <>
                          <Check size={12} />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="credential-public-key-box">
                    <code>{sshKey.publicKey}</code>
                  </div>
                  {sshKey.fingerprint && (
                    <div className="credential-key-fingerprint">
                      Fingerprint: <code>{sshKey.fingerprint}</code>
                    </div>
                  )}
                  <div className="credential-key-help">
                    <ExternalLink size={12} />
                    <span>
                      Add this key to your Git provider (Settings → SSH and GPG keys → New SSH key)
                    </span>
                  </div>
                </div>
              )}

              <div className="credential-ssh-actions">
                {!sshKey.exists ? (
                  <button
                    type="button"
                    className="credential-generate-btn"
                    onClick={handleGenerateSshKey}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        Generate SSH Key
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="credential-delete-btn"
                    onClick={handleDeleteSshKey}
                  >
                    <Trash2 size={14} />
                    Delete SSH Key
                  </button>
                )}
              </div>

              <div className="credential-help-section">
                <h4>About SSH Keys</h4>
                <p>
                  SSH keys provide secure, passwordless authentication for Git operations.
                  Clanker Grid generates ED25519 keys which are modern and recommended.
                </p>
                <ul>
                  <li>Private key is stored encrypted in your home directory</li>
                  <li>Add the public key to your Git provider to enable push/pull</li>
                  <li>The key is specific to Clanker Grid and won't affect other git configurations</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'tokens' && (
            <div className="credential-tokens-section">
              <div className="credential-tokens-list">
                {PROVIDERS.filter((p) => p.id !== 'unknown').map((provider) => {
                  const storedPat = storedPats[provider.id];
                  return (
                    <div key={provider.id} className="credential-token-item">
                      <div className="credential-token-header">
                        <span className="credential-token-provider">{provider.name}</span>
                        {storedPat ? (
                          <div className="credential-token-status saved">
                            <Check size={12} />
                            Token saved
                          </div>
                        ) : (
                          <div className="credential-token-status empty">Not configured</div>
                        )}
                      </div>

                      {patProvider === provider.id ? (
                        <div className="credential-token-form">
                          <input
                            type="password"
                            className="credential-token-input"
                            placeholder="Paste your token here"
                            value={patInput[provider.id]}
                            onChange={(e) =>
                              setPatInput((prev) => ({
                                ...prev,
                                [provider.id]: e.target.value,
                              }))
                            }
                          />
                          <div className="credential-token-form-actions">
                            <button
                              type="button"
                              className="credential-token-save-btn"
                              onClick={handleSavePat}
                              disabled={isSavingPat || !patInput[provider.id].trim()}
                            >
                              {isSavingPat ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                              Save
                            </button>
                            <button
                              type="button"
                              className="credential-token-cancel-btn"
                              onClick={() => {
                                setPatProvider('github');
                                setPatInput((prev) => ({ ...prev, [provider.id]: '' }));
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : storedPat ? (
                        <div className="credential-token-actions">
                          <a
                            href={provider.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="credential-token-docs-link"
                          >
                            <ExternalLink size={11} />
                            Learn more
                          </a>
                          <button
                            type="button"
                            className="credential-token-remove-btn"
                            onClick={() => handleDeletePat(provider.id)}
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="credential-token-add-btn"
                          onClick={() => setPatProvider(provider.id)}
                        >
                          <Plus size={12} />
                          Add Token
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="credential-help-section">
                <h4>About Access Tokens</h4>
                <p>
                  Personal Access Tokens (PATs) provide HTTPS authentication for Git operations.
                  They're useful when SSH is not available or for specific API access.
                </p>
                <ul>
                  <li>Tokens are stored encrypted on your device</li>
                  <li>Only grant scopes you actually need</li>
                  <li>Revoke tokens you no longer use</li>
                </ul>
                <a
                  href={PROVIDERS.find((p) => p.id === 'github')?.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="credential-help-link"
                >
                  <ExternalLink size={12} />
                  GitHub Token Documentation
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
