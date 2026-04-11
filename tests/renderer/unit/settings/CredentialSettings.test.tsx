// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useVcsStore } from '../../../../src/renderer/store/vcsStore';
import CredentialSettings from '../../../../src/renderer/components/settings/CredentialSettings';

// Mock lucide icons
vi.mock('lucide-react', () => ({
  Key: () => <span data-testid="key-icon">Key</span>,
  Copy: () => <span data-testid="copy-icon">Copy</span>,
  Trash2: () => <span data-testid="trash-icon">Trash2</span>,
  Plus: () => <span data-testid="plus-icon">Plus</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
  AlertCircle: () => <span data-testid="alert-circle">AlertCircle</span>,
  Loader2: () => <span data-testid="loader-2">Loader2</span>,
  ExternalLink: () => <span data-testid="external-link">ExternalLink</span>,
  RefreshCw: () => <span data-testid="refresh-icon">RefreshCw</span>,
}));

// Mock clipboard
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

// Mock electron API
const mockCredentialCheckExists = vi.fn().mockResolvedValue({ exists: false });
const mockCredentialGetGlobalStatus = vi.fn().mockResolvedValue({
  defaultSshKeyPath: '',
  hasDefaultSshKey: false,
  storedPats: [],
  credentialHelpers: {},
});
const mockCredentialGetPublicKey = vi.fn().mockResolvedValue({
  success: false,
  error: 'No key',
});
const mockCredentialGenerateSshKey = vi.fn().mockResolvedValue({ success: true, publicKey: 'ssh-ed25519 AAA...', fingerprint: 'SHA256:...' });
const mockCredentialDeleteSshKey = vi.fn().mockResolvedValue({ success: true });
const mockCredentialSavePat = vi.fn().mockResolvedValue({ success: true });
const mockCredentialDeletePat = vi.fn().mockResolvedValue({ success: true });

const mockElectronAPI = {
  credentialCheckExists: mockCredentialCheckExists,
  credentialGetGlobalStatus: mockCredentialGetGlobalStatus,
  credentialGetPublicKey: mockCredentialGetPublicKey,
  credentialGenerateSshKey: mockCredentialGenerateSshKey,
  credentialDeleteSshKey: mockCredentialDeleteSshKey,
  credentialSavePat: mockCredentialSavePat,
  credentialDeletePat: mockCredentialDeletePat,
};

describe('CredentialSettings', () => {
  let mockConfirm: (message?: string) => boolean;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockConfirm = vi.fn(() => true);
    vi.stubGlobal('confirm', mockConfirm);

    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
    });

    // Reset VCS store
    useVcsStore.setState({
      sshKey: { exists: false },
      storedPats: { github: null, gitlab: null, bitbucket: null, unknown: null },
      isLoading: false,
      error: null,
    });

    // Reset mocks
    vi.clearAllMocks();
    mockCredentialCheckExists.mockResolvedValue({ exists: false });
    mockCredentialGetGlobalStatus.mockResolvedValue({
      defaultSshKeyPath: '',
      hasDefaultSshKey: false,
      storedPats: [],
      credentialHelpers: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    it('returns null when closed', () => {
      render(<CredentialSettings isOpen={false} onClose={vi.fn()} />);

      expect(document.querySelector('.credential-settings-overlay')).toBeNull();
    });

    it('renders overlay when open', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      expect(document.querySelector('.credential-settings-overlay')).toBeTruthy();
    });

    it('renders modal when open', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      expect(document.querySelector('.credential-settings')).toBeTruthy();
    });

    it('renders header with title', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      // Check for VCS Credentials header text
      expect(document.querySelector('.credential-settings-header h2')?.textContent).toBe('VCS Credentials');
    });

    it('renders close button in header', () => {
      const onClose = vi.fn();
      render(<CredentialSettings isOpen={true} onClose={onClose} />);

      const closeBtn = document.querySelector('.credential-settings-close');
      expect(closeBtn).toBeTruthy();
    });

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      render(<CredentialSettings isOpen={true} onClose={onClose} />);

      fireEvent.click(document.querySelector('.credential-settings-close')!);
      expect(onClose).toHaveBeenCalled();
    });

    it('renders tabs', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const tabs = document.querySelectorAll('.credential-tab');
      expect(tabs.length).toBe(2);
    });

    it('renders SSH Keys tab by default', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      // Check that the SSH key section is visible
      expect(document.querySelector('.credential-ssh-section')).toBeTruthy();
    });
  });

  // =========================================================================
  // SSH Keys Tab
  // =========================================================================
  describe('SSH Keys tab', () => {
    it('loads credentials on open', async () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(mockCredentialCheckExists).toHaveBeenCalled();
      expect(mockCredentialGetGlobalStatus).toHaveBeenCalled();
    });

    it('shows loading state', () => {
      useVcsStore.setState({ isLoading: true });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      // Should show loading indicator
      expect(document.querySelector('.credential-status-loading')).toBeTruthy();
    });

    it('shows no SSH key state when sshKey.exists is false', async () => {
      // Set up store state before render
      useVcsStore.setState({ sshKey: { exists: false }, isLoading: true });

      // Mock to resolve synchronously
      mockCredentialCheckExists.mockResolvedValue({ exists: false });
      mockCredentialGetGlobalStatus.mockResolvedValue({
        defaultSshKeyPath: '',
        hasDefaultSshKey: false,
        storedPats: [],
        credentialHelpers: {},
      });

      const { rerender } = render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      // Advance timers to allow async useEffect to complete
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      rerender(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      // Now check the state
      const statusDiv = document.querySelector('.credential-ssh-status');
      expect(statusDiv?.textContent).toContain('No SSH key configured');
    });

    it('shows SSH key configured when sshKey.exists is true', async () => {
      // Mock to resolve with key exists
      mockCredentialCheckExists.mockResolvedValue({ exists: true });
      mockCredentialGetPublicKey.mockResolvedValue({
        success: true,
        publicKey: 'ssh-ed25519 AAA...',
        fingerprint: 'SHA256:xxx',
      });

      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...' },
        isLoading: true,
      });

      const { rerender } = render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      // Advance timers to allow async useEffect to complete
      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      rerender(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const statusDiv = document.querySelector('.credential-ssh-status');
      expect(statusDiv?.textContent).toContain('SSH key configured');
    });

    it('shows public key when SSH key exists', () => {
      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...' },
        isLoading: false,
      });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const publicKeyBox = document.querySelector('.credential-public-key-box');
      expect(publicKeyBox?.textContent).toContain('ssh-ed25519 AAA...');
    });

    it('shows fingerprint when available', () => {
      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...', fingerprint: 'SHA256:xxx' },
        isLoading: false,
      });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const fingerprintDiv = document.querySelector('.credential-key-fingerprint');
      expect(fingerprintDiv?.textContent).toContain('SHA256:xxx');
    });

    it('copy button copies public key to clipboard', async () => {
      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...' },
      });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const copyBtn = document.querySelector('.credential-copy-btn') as HTMLButtonElement;
      await act(async () => {
        copyBtn.click();
      });

      expect(mockClipboard.writeText).toHaveBeenCalledWith('ssh-ed25519 AAA...');
    });

    it('generate button calls credentialGenerateSshKey', async () => {
      useVcsStore.setState({ sshKey: { exists: false } });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const generateBtn = document.querySelector('.credential-generate-btn') as HTMLButtonElement;
      await act(async () => {
        generateBtn.click();
        vi.advanceTimersByTime(100);
      });

      expect(mockCredentialGenerateSshKey).toHaveBeenCalled();
    });

    it('delete button shows confirm dialog', async () => {
      mockConfirm = vi.fn(() => true);
      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...' },
      });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const deleteBtn = document.querySelector('.credential-delete-btn') as HTMLButtonElement;
      await act(async () => {
        deleteBtn.click();
      });

      expect(window.confirm).toHaveBeenCalled();
    });

    it('delete success updates store', async () => {
      mockConfirm = vi.fn(() => true);
      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...' },
      });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const deleteBtn = document.querySelector('.credential-delete-btn') as HTMLButtonElement;
      await act(async () => {
        deleteBtn.click();
        vi.advanceTimersByTime(100);
      });

      const state = useVcsStore.getState();
      expect(state.sshKey.exists).toBe(false);
    });

    it('help section renders', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      expect(document.querySelector('.credential-help-section')).toBeTruthy();
    });
  });

  // =========================================================================
  // Tab Switching
  // =========================================================================
  describe('tab switching', () => {
    it('tab click changes active tab', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const tabs = document.querySelectorAll('.credential-tab');
      const tokensTab = tabs[1] as HTMLButtonElement;
      fireEvent.click(tokensTab);

      // SSH Keys tab should no longer be active
      const activeTabs = document.querySelectorAll('.credential-tab.active');
      expect(activeTabs).toHaveLength(1);
    });

    it('shows SSH tab content when SSH tab active', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const tabs = document.querySelectorAll('.credential-tab');
      const sshTab = tabs[0] as HTMLButtonElement;
      fireEvent.click(sshTab);

      // Should see SSH key content
      expect(document.querySelector('.credential-ssh-section')).toBeTruthy();
    });

    it('shows tokens tab content when tokens tab active', () => {
      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const tabs = document.querySelectorAll('.credential-tab');
      const tokensTab = tabs[1] as HTMLButtonElement;
      fireEvent.click(tokensTab);

      // Should see tokens section
      expect(document.querySelector('.credential-tokens-section')).toBeTruthy();
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================
  describe('error handling', () => {
    it('load failure updates store error', async () => {
      mockCredentialCheckExists.mockRejectedValueOnce(new Error('Network error'));

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      const state = useVcsStore.getState();
      expect(state.error).toContain('Network error');
    });

    it('clipboard failure shows error state in component', async () => {
      mockClipboard.writeText.mockRejectedValueOnce(new Error('Clipboard access denied'));

      useVcsStore.setState({
        sshKey: { exists: true, publicKey: 'ssh-ed25519 AAA...' },
        isLoading: false,
      });

      render(<CredentialSettings isOpen={true} onClose={vi.fn()} />);

      const copyBtn = document.querySelector('.credential-copy-btn') as HTMLButtonElement;
      await act(async () => {
        copyBtn.click();
      });

      // The component shows error in .credential-error div
      const errorDiv = document.querySelector('.credential-error');
      expect(errorDiv?.textContent).toContain('Failed to copy to clipboard');
    });
  });
});