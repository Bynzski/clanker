// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { WorkspaceGateModal, WorkspaceGateFullscreen } from '../../../src/renderer/components/WorkspaceGate';

// Mock WorkspaceGateContent
vi.mock('../../../src/renderer/components/WorkspaceGateContent', () => ({
  default: ({ onSubmit }: { onSubmit: (data: { path: string; terminalCount: number; harness: string; model?: string }) => void }) => (
    <div data-testid="workspace-gate-content">
      <button onClick={() => onSubmit({ path: '/test', terminalCount: 2, harness: 'test' })}>
        Submit
      </button>
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
  useWorkspaceStore: vi.fn((selector) => {
    const store = {
      pushBrowserOverlay: mockPushBrowserOverlay,
      popBrowserOverlay: mockPopBrowserOverlay,
    };
    if (typeof selector === 'function') {
      return selector(store);
    }
    return store;
  }),
}));

describe('WorkspaceGateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
      
      const overlay = document.querySelector('.modal-overlay');
      await act(async () => {
        fireEvent.click(overlay!);
      });
      
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
  });

  // =========================================================================
  // Keyboard Handling
  // =========================================================================
  describe('keyboard handling', () => {
    it('calls onClose when Escape is pressed and modal is open', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      
      expect(onClose).toHaveBeenCalled();
    });

    it('does not call onClose when Escape is pressed and modal is closed', async () => {
      const onClose = vi.fn();
      render(<WorkspaceGateModal isOpen={false} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      
      expect(onClose).not.toHaveBeenCalled();
    });

    it('removes keyboard listener when unmounted', async () => {
      const onClose = vi.fn();
      const { unmount } = render(<WorkspaceGateModal isOpen={true} onClose={onClose} onWorkspaceSelect={vi.fn()} />);
      
      unmount();
      
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
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
    vi.useFakeTimers();
    
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
    vi.useRealTimers();
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
    it('passes onWorkspaceSelect to WorkspaceGateContent', async () => {
      const onWorkspaceSelect = vi.fn();
      
      render(<WorkspaceGateFullscreen onWorkspaceSelect={onWorkspaceSelect} />);
      
      const submitButton = screen.getByText('Submit');
      await act(async () => {
        fireEvent.click(submitButton);
      });
      
      expect(onWorkspaceSelect).toHaveBeenCalledWith('/test', 2, 'test', undefined);
    });
  });
});
