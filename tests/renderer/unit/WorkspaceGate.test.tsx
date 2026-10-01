// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../src/renderer/components/ui/Dialog';
import { WorkspaceGateModal, WorkspaceGateFullscreen } from '../../../src/renderer/components/WorkspaceGate';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

// Mock WorkspaceGateContent
vi.mock('../../../src/renderer/components/WorkspaceGateContent', () => ({
  default: ({ onSubmit, openError, onTargetChange, opening }: { opening?: boolean; onSubmit: (data: { path: string; terminalCount: number; harness: string; model?: string; environmentId?: string; environmentLabel?: string }) => void; openError?: string; onTargetChange?: () => void }) => (
    <div data-testid="workspace-gate-content" aria-busy={opening}>
      <button onClick={() => onSubmit({ path: '/test', terminalCount: 2, harness: 'test' })}>
        Submit
      </button>
      <button onClick={() => onSubmit({ path: '/home/dev/Project', terminalCount: 2, harness: 'test', model: 'model-x', environmentId: 'ssh:devbox', environmentLabel: 'Dev Box' })}>
        Submit remote
      </button>
      <button onClick={onTargetChange}>Change target</button>
      <Dialog><DialogTrigger>Open model child</DialogTrigger><DialogContent aria-describedby={undefined}>
        <DialogTitle>Model child</DialogTitle><button>Child control</button>
      </DialogContent></Dialog>
      {openError && <p className="gate-open-error" role="alert">{openError}</p>}
    </div>
  ),
  WorkspaceFormData: {} as object,
}));

// Mock electron API
const mockMinimizeWindow = vi.fn();
const mockToggleMaximizeWindow = vi.fn().mockResolvedValue(undefined);
const mockCloseWindow = vi.fn();
const mockIsMaximizedWindow = vi.fn().mockResolvedValue(false);
const mockPushBrowserOverlay = vi.fn();
const mockPopBrowserOverlay = vi.fn();

vi.mock('../../../src/renderer/store/workspaceStore', () => ({
  useWorkspaceStore: Object.assign(vi.fn((selector) => {
    const store = {
      pushBrowserOverlay: mockPushBrowserOverlay,
      popBrowserOverlay: mockPopBrowserOverlay,
      activeWorkspaceId: null,
    };
    if (typeof selector === 'function') {
      return selector(store);
    }
    return store;
  }), { getState: vi.fn(() => ({ workspaces: [], selectWorkspace: vi.fn() })) }),
}));

describe('WorkspaceGateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({ workspaces: [], selectWorkspace: vi.fn() } as never);
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // Open/Close Behavior
  // =========================================================================
  describe('open/close behavior', () => {
    it('renders nothing when isOpen is false', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={false} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      expect(screen.queryByTestId('workspace-gate-content')).toBeNull();
    });

    it('renders content when isOpen is true', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      expect(screen.getByTestId('workspace-gate-content')).toBeTruthy();
    });

    it('calls onClose when overlay is clicked', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      const user = userEvent.setup();
      await user.click(document.querySelector('.modal-overlay')!);
      
      expect(onClose).toHaveBeenCalled();
    });

    it('does not call onClose when content is clicked', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      const content = document.querySelector('.modal-content');
      await act(async () => {
        fireEvent.click(content!);
      });
      
      expect(onClose).not.toHaveBeenCalled();
    });

    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      const closeButton = screen.getByTitle('Close (Esc)');
      await act(async () => {
        fireEvent.click(closeButton);
      });
      
      expect(onClose).toHaveBeenCalled();
    });

    it('focuses an already open checkout instead of creating a duplicate workspace', () => {
      const selectWorkspace = vi.fn();
      vi.mocked(useWorkspaceStore.getState).mockReturnValue({
        workspaces: [{ id: 'existing', workspacePath: '/test/' }],
        selectWorkspace,
      } as never);
      const onClose = vi.fn();
      const onWorkspaceSelect = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={onWorkspaceSelect} />);
      fireEvent.click(screen.getByText('Submit'));
      expect(selectWorkspace).toHaveBeenCalledWith('existing');
      expect(onWorkspaceSelect).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('does not focus a local workspace when the same path belongs to a remote environment', async () => {
      const selectWorkspace = vi.fn();
      vi.mocked(useWorkspaceStore.getState).mockReturnValue({
        workspaces: [{ id: 'local-existing', workspacePath: '/home/dev/Project' }],
        selectWorkspace,
      } as never);
      const onWorkspaceSelect = vi.fn().mockResolvedValue(true);
      render(<WorkspaceGateModal isOpen={true} onClose={vi.fn()} onWorkspaceSelect={onWorkspaceSelect} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Submit remote'));
      });

      expect(selectWorkspace).not.toHaveBeenCalled();
      expect(onWorkspaceSelect).toHaveBeenCalledWith(
        '/home/dev/Project', 2, 'test', 'model-x', true, 'ssh:devbox', 'Dev Box'
      );
    });
  });

  // =========================================================================
  // Keyboard Handling
  // =========================================================================
  describe('keyboard handling', () => {
    it('calls onClose when Escape is pressed and modal is open', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      
      expect(onClose).toHaveBeenCalled();
    });

    it('keeps New Workspace open when Escape is used inside a model picker', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open model child' }));
      expect(screen.getByRole('dialog', { name: 'Model child' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Model child' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not call onClose when Escape is pressed and modal is closed', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={false} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not respond to Escape after unmount', async () => {
      const onClose = vi.fn();
      const { unmount } = render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      unmount();
      
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Browser Overlay
  // =========================================================================
  describe('browser overlay management', () => {
    it('pushes browser overlay when modal opens', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      expect(mockPushBrowserOverlay).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Workspace Selection
  // =========================================================================
  describe('workspace selection', () => {
    it('places local and SSH open errors inside the modal form and clears them on target change', async () => {
      const onWorkspaceSelect = vi.fn().mockResolvedValue(false);
      render(<WorkspaceGateModal isOpen={true} onClose={vi.fn()} onWorkspaceSelect={onWorkspaceSelect} />);

      await act(async () => { fireEvent.click(screen.getByText('Submit')); });
      expect(screen.getByRole('alert')).toHaveClass('gate-open-error');
      expect(screen.getByTestId('workspace-gate-content')).toContainElement(screen.getByRole('alert'));

      fireEvent.click(screen.getByText('Change target'));
      expect(screen.queryByRole('alert')).toBeNull();

      await act(async () => { fireEvent.click(screen.getByText('Submit remote')); });
      expect(screen.getByRole('alert')).toHaveClass('gate-open-error');
      expect(onWorkspaceSelect).toHaveBeenLastCalledWith('/home/dev/Project', 2, 'test', 'model-x', true, 'ssh:devbox', 'Dev Box');
    });

    it('passes onWorkspaceSelect to WorkspaceGateContent', async () => {
      const onWorkspaceSelect = vi.fn();
      const onClose = vi.fn();
      
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={onWorkspaceSelect} />);
      
      const submitButton = screen.getByText('Submit');
      await act(async () => {
        fireEvent.click(submitButton);
      });
      
      expect(onWorkspaceSelect).toHaveBeenCalledWith('/test', 2, 'test', undefined);
    });

    it('closes modal after successful workspace selection', async () => {
      const onClose = vi.fn();
      
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      const submitButton = screen.getByText('Submit');
      await act(async () => {
        fireEvent.click(submitButton);
      });
      
      expect(onClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Structure
  // =========================================================================
  describe('structure', () => {
    it('renders modal overlay', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      expect(document.querySelector('.modal-overlay')).toBeTruthy();
    });

    it('renders modal content', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      expect(document.querySelector('.modal-content')).toBeTruthy();
    });

    it('renders close button', () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      expect(screen.getByTitle('Close (Esc)')).toBeTruthy();
    });
  });
});

describe('WorkspaceGateFullscreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock window.electronAPI for GateTitleBar
    Object.defineProperty(window, 'electronAPI', {
      value: {
        isMaximizedWindow: mockIsMaximizedWindow,
        minimizeWindow: mockMinimizeWindow,
        toggleMaximizeWindow: mockToggleMaximizeWindow,
        closeWindow: mockCloseWindow,
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // Basic Rendering
  // =========================================================================
  describe('basic rendering', () => {
    it('renders the fullscreen gate', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      expect(document.querySelector('.workspace-gate')).toBeTruthy();
    });

    it('renders workspace gate content', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      expect(screen.getByTestId('workspace-gate-content')).toBeTruthy();
    });

    it('renders gate title bar', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      expect(document.querySelector('.workspace-gate-titlebar')).toBeTruthy();
      expect(document.querySelector('.workspace-gate-window-controls')).toHaveClass('window-controls');
      expect(screen.getByRole('button', { name: 'Maximize window' })).toHaveClass('window-controls-button', 'workspace-gate-window-btn');
    });

    it('renders workspace gate shell', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      expect(document.querySelector('.workspace-gate-shell')).toBeTruthy();
    });
  });

  // =========================================================================
  // Title Bar
  // =========================================================================
  describe('title bar', () => {
    it('displays the brand title', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      expect(screen.getByText('Clanker Grid')).toBeTruthy();
    });

    it('renders minimize button', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      const minimizeButton = screen.getByLabelText('Minimize window');
      expect(minimizeButton).toBeTruthy();
    });

    it('renders maximize button', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      const maximizeButton = screen.getByLabelText('Maximize window');
      expect(maximizeButton).toBeTruthy();
    });

    it('renders close button', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      const closeButton = screen.getByLabelText('Close window');
      expect(closeButton).toBeTruthy();
    });
  });

  // =========================================================================
  // Window Controls
  // =========================================================================
  describe('window controls', () => {
    it('calls minimizeWindow when minimize is clicked', async () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      const minimizeButton = screen.getByLabelText('Minimize window');
      await act(async () => {
        fireEvent.click(minimizeButton);
      });
      
      expect(mockMinimizeWindow).toHaveBeenCalled();
    });

    it('calls toggleMaximizeWindow when maximize is clicked', async () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      const maximizeButton = screen.getByLabelText('Maximize window');
      await act(async () => {
        fireEvent.click(maximizeButton);
      });
      
      expect(mockToggleMaximizeWindow).toHaveBeenCalled();
    });

    it('calls closeWindow when close is clicked', async () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      const closeButton = screen.getByLabelText('Close window');
      await act(async () => {
        fireEvent.click(closeButton);
      });
      
      expect(mockCloseWindow).toHaveBeenCalled();
    });

    it('starts with maximize label (window not maximized)', () => {
      render(<WorkspaceGateFullscreen onWorkspaceSelect={vi.fn()} />);
      
      // The initial state is not maximized, so it should show "Maximize window"
      expect(screen.getByLabelText('Maximize window')).toBeTruthy();
    });
  });

  // =========================================================================
  // Workspace Selection
  // =========================================================================
  describe('workspace selection', () => {
    it('keeps opening feedback until settlement, blocks duplicate submits, and allows retry', async () => {
      let finish!: (opened: boolean) => void;
      const onWorkspaceSelect = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
      render(<WorkspaceGateFullscreen onWorkspaceSelect={onWorkspaceSelect} />);

      fireEvent.click(screen.getByText('Submit'));
      expect(screen.getByTestId('workspace-gate-content')).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(screen.getByText('Submit'));
      fireEvent.click(screen.getByText('Change target'));
      fireEvent.click(screen.getByText('Submit remote'));
      expect(onWorkspaceSelect).toHaveBeenCalledTimes(1);

      await act(async () => { finish(false); });
      expect(screen.getByTestId('workspace-gate-content')).toHaveAttribute('aria-busy', 'false');
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByText('Submit'));
      expect(onWorkspaceSelect).toHaveBeenCalledTimes(2);
      await act(async () => { finish(false); });
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-gate-content')).toHaveAttribute('aria-busy', 'false');
    });

    it('places a failed open inside the fullscreen launcher form and clears it before retrying', async () => {
      const onWorkspaceSelect = vi.fn().mockResolvedValue(false);
      render(<WorkspaceGateFullscreen onWorkspaceSelect={onWorkspaceSelect} />);

      await act(async () => { fireEvent.click(screen.getByText('Submit remote')); });
      expect(screen.getByTestId('workspace-gate-content')).toContainElement(screen.getByRole('alert'));
      expect(document.querySelector('.workspace-gate-shell > [role="alert"]')).toBeNull();

      fireEvent.click(screen.getByText('Change target'));
      expect(screen.queryByRole('alert')).toBeNull();

      await act(async () => { fireEvent.click(screen.getByText('Submit')); });
      expect(screen.getByRole('alert')).toHaveClass('gate-open-error');
    });

    it('passes onWorkspaceSelect to WorkspaceGateContent', async () => {
      const onWorkspaceSelect = vi.fn();
      
      render(<WorkspaceGateFullscreen onWorkspaceSelect={onWorkspaceSelect} />);
      
      const submitButton = screen.getByText('Submit');
      await act(async () => {
        fireEvent.click(submitButton);
      });
      
      expect(onWorkspaceSelect).toHaveBeenCalledWith('/test', 2, 'test', undefined);
    });

    it('opens a remote workspace with its SSH environment identity', async () => {
      const onWorkspaceSelect = vi.fn().mockResolvedValue(true);
      render(<WorkspaceGateFullscreen onWorkspaceSelect={onWorkspaceSelect} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Submit remote'));
      });

      expect(onWorkspaceSelect).toHaveBeenCalledWith(
        '/home/dev/Project', 2, 'test', 'model-x', true, 'ssh:devbox', 'Dev Box'
      );
    });
  });
});
