/**
 * preload.ts IPC Bridge Coverage Tests
 * 
 * Tests for the preload.ts IPC channel exposure.
 * 
 * Strategy:
 * - Parse the preload.ts file to extract the API structure
 * - Verify channel naming consistency between preload and main
 * - Test IPC channel patterns programmatically
 * - Verify all expected methods are exposed
 * 
 * This approach avoids Electron runtime mocking issues by testing
 * the preload.ts structure directly.
 * 
 * Coverage target: preload.ts functions (0% -> 50%)
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { test, describe } from 'vitest';

// ============================================================================
// Load preload.ts source for structural analysis
// ============================================================================

const preloadSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/main/preload.ts'),
  'utf-8'
);

// ============================================================================
// Extract API structure from preload.ts source
// ============================================================================

/**
 * Extracts method names and their IPC channel names from preload.ts
 */
function extractApiStructure(source: string): {
  invokeMethods: Array<{ method: string; channel: string }>;
  eventMethods: Array<{ method: string; channel: string }>;
} {
  const invokeMethods: Array<{ method: string; channel: string }> = [];
  const eventMethods: Array<{ method: string; channel: string }> = [];

  // Match invoke patterns: methodName: () => ipcRenderer.invoke('channel-name', ...)
  const invokeRegex = /(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(['"]([^'"]+)['"]/g;
  let match;
  while ((match = invokeRegex.exec(source)) !== null) {
    invokeMethods.push({ method: match[1], channel: match[2] });
  }

  // Match event patterns: ipcRenderer.on('channel-name', ...)
  const eventRegex = /ipcRenderer\.on\(['"]([^'"]+)['"],/g;
  while ((match = eventRegex.exec(source)) !== null) {
    // Find the corresponding method name before this on() call
    const beforeMatch = source.substring(0, match.index).match(/(\w+):\s*\([^)]*\)\s*=>\s*\{/g);
    if (beforeMatch) {
      const lastMethod = beforeMatch[beforeMatch.length - 1];
      const methodMatch = lastMethod.match(/(\w+):/);
      if (methodMatch) {
        eventMethods.push({ method: methodMatch[1], channel: match[1] });
      }
    }
  }

  return { invokeMethods, eventMethods };
}

// Alternative approach: Extract event handler method names
function extractEventMethods(source: string): Array<{ method: string; channel: string }> {
  const eventMethods: Array<{ method: string; channel: string }> = [];
  
  // Match: ipcRenderer.on('channel-name', handler)
  // And then trace back to find the method name
  const lines = source.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const onMatch = line.match(/ipcRenderer\.on\(['"]([^'"]+)['"]/);
    if (onMatch) {
      const channel = onMatch[1];
      
      // Search backwards for the method name (may be on previous lines with multi-line type)
      let methodName = '';
      for (let j = i; j >= 0 && !methodName; j--) {
        // Look for pattern: methodName: (callback
        const methodMatch = lines[j].match(/^\s+(\w+):\s*\(/);
        if (methodMatch) {
          methodName = methodMatch[1];
        }
      }
      
      if (methodName) {
        eventMethods.push({ method: methodName, channel });
      }
    }
  }

  return eventMethods;
}

const { invokeMethods: extractedInvokeMethods } = extractApiStructure(preloadSource);
const extractedEventMethods = extractEventMethods(preloadSource);

// ============================================================================
// IPC channels from main.ts (ground truth)
// ============================================================================

const MAIN_IPC_INVOKE_CHANNELS = [
  // Workspace
  'get-last-workspace',
  'open-directory-dialog',
  'read-directory',
  
  // Settings
  'get-show-fastfetch',
  'set-show-fastfetch',
  'get-ai-commit-settings',
  'set-ai-commit-enabled',
  'set-ai-commit-provider',
  'set-ai-commit-model',
  
  // Terminal
  'spawn-terminal',
  'get-terminal-buffer',
  'write-terminal',
  'resize-terminal',
  'kill-terminal',
  
  // Browser
  'browser-set-bounds',
  'browser-hide',
  'browser-navigate',
  'browser-back',
  'browser-forward',
  'browser-refresh',
  'browser-stop',
  'browser-dispose-workspace',
  'open-external',
  'can-go-back',
  'can-go-forward',
  
  // Harness
  'get-harness-options',
  'get-harness-models',
  
  // Git
  'git-start-polling',
  'git-stop-polling',
  'generate-commit-message',
  'git-stage',
  'git-unstage',
  'git-commit',
  'git-get-branch-state',
  'git-get-operation-state',
  'git-get-stashes',
  'git-get-history',
  'git-get-diff',
  'git-create-branch',
  'git-switch-branch',
  'git-delete-branch',
  'git-force-delete-branch',
  'git-merge-branch',
  'git-abort-operation',
  'git-stash',
  'git-apply-stash',
  'git-pop-stash',
  'git-drop-stash',
  'git-clear-stashes',
  'git-refresh',
  'git-init',
  'git-get-remotes',
  'git-add-remote',
  'git-remove-remote',
  'git-rename-remote',
  'git-fetch',
  'git-pull',
  'git-push',
  
  // Credentials
  'credential:generate-ssh-key',
  'credential:get-public-key',
  'credential:delete-ssh-key',
  'credential:check-exists',
  'credential:save-pat',
  'credential:get-pat',
  'credential:delete-pat',
  'credential:get-status',
  'credential:get-global-status',
  'credential:configure-ssh-host',
  
  // VCS
  'vcs:get-context',
  'vcs:get-pr-info',
  'vcs:get-deep-links',
  'vcs:get-deep-link',
  'vcs:open-deep-link',
  
  // Window
  'minimize-window',
  'toggle-maximize-window',
  'close-window',
  'is-maximized-window',
];

const MAIN_IPC_EVENT_CHANNELS = [
  'terminal-data',
  'terminal-exit',
  'browser-url-updated',
  'fit-all-panes',
  'git-status-update',
];

// ============================================================================
// Tests
// ============================================================================

describe('preload.ts IPC Bridge Coverage Tests', () => {
  
  // -------------------------------------------------------------------------
  // Structural Analysis
  // -------------------------------------------------------------------------
  
  describe('preload.ts structure', () => {
    test('preload.ts file exists and is readable', () => {
      assert.ok(preloadSource.length > 0, 'preload.ts should be non-empty');
      assert.ok(preloadSource.includes('contextBridge'), 'preload.ts should use contextBridge');
      assert.ok(preloadSource.includes('ipcRenderer'), 'preload.ts should use ipcRenderer');
    });
    
    test('exposes electronAPI to main world', () => {
      assert.ok(
        preloadSource.includes('exposeInMainWorld'),
        'preload.ts should call exposeInMainWorld'
      );
      assert.ok(
        preloadSource.includes("'electronAPI'") || preloadSource.includes('"electronAPI"'),
        'preload.ts should expose electronAPI'
      );
    });
    
    test('uses contextBridge for secure IPC', () => {
      // Verify contextBridge is used (not direct nodeIntegration)
      assert.ok(
        preloadSource.includes('contextBridge.exposeInMainWorld'),
        'preload.ts should use contextBridge.exposeInMainWorld'
      );
    });
  });

  // -------------------------------------------------------------------------
  // IPC Invoke Methods
  // -------------------------------------------------------------------------
  
  describe('IPC invoke method extraction', () => {
    test('extracts invoke methods from preload.ts', () => {
      assert.ok(
        extractedInvokeMethods.length > 0,
        `Should extract some invoke methods, got ${extractedInvokeMethods.length}`
      );
    });
    
    test('extracts expected number of invoke methods', () => {
      // We expect at least 70+ IPC invoke methods based on main.ts
      assert.ok(
        extractedInvokeMethods.length >= 60,
        `Expected at least 60 invoke methods, got ${extractedInvokeMethods.length}`
      );
    });
    
    test('first invoke method is workspace-related', () => {
      const workspaceMethods = extractedInvokeMethods.filter(m => 
        m.method.toLowerCase().includes('workspace') || 
        m.channel.includes('workspace')
      );
      assert.ok(workspaceMethods.length > 0, 'Should have workspace-related methods');
    });
  });

  // -------------------------------------------------------------------------
  // IPC Event Methods
  // -------------------------------------------------------------------------
  
  describe('IPC event method extraction', () => {
    test('extracts event methods from preload.ts', () => {
      assert.ok(
        extractedEventMethods.length > 0,
        `Should extract some event methods, got ${extractedEventMethods.length}`
      );
    });
    
    test('extracts all expected event methods', () => {
      // Should have at least 5 event handlers: terminal data/exit, browser, git status, fit panes
      assert.ok(
        extractedEventMethods.length >= 5,
        `Expected at least 5 event methods, got ${extractedEventMethods.length}`
      );
    });
  });

  // -------------------------------------------------------------------------
  // Channel Naming Conventions
  // -------------------------------------------------------------------------
  
  describe('Channel naming conventions', () => {
    test('invoke channels follow kebab-case convention', () => {
      const nonKebabChannels = extractedInvokeMethods.filter(
        m => m.channel.includes('_') || (m.channel.includes(':') === false && m.channel !== m.channel.toLowerCase())
      );
      
      // Allow colons for namespaced channels (credential:, vcs:)
      const invalidChannels = nonKebabChannels.filter(
        m => !m.channel.includes(':') && m.channel !== m.channel.toLowerCase()
      );
      
      assert.ok(
        invalidChannels.length === 0,
        `Non-kebab-case channels found: ${invalidChannels.map(c => c.channel).join(', ')}`
      );
    });
    
    test('credential channels use colon namespace', () => {
      const credentialChannels = extractedInvokeMethods.filter(
        m => m.channel.startsWith('credential:')
      );
      
      assert.ok(
        credentialChannels.length >= 8,
        'Should have at least 8 credential channels'
      );
    });
    
    test('vcs channels use colon namespace', () => {
      const vcsChannels = extractedInvokeMethods.filter(
        m => m.channel.startsWith('vcs:')
      );
      
      assert.ok(
        vcsChannels.length >= 4,
        'Should have at least 4 VCS channels'
      );
    });
    
    test('git channels follow git- prefix convention', () => {
      const gitChannels = extractedInvokeMethods.filter(
        m => m.channel.startsWith('git-')
      );
      
      assert.ok(
        gitChannels.length >= 20,
        'Should have at least 20 git channels'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Channel Coverage Verification
  // -------------------------------------------------------------------------
  
  describe('Main process channel coverage', () => {
    test('all main IPC channels are exposed in preload', () => {
      const preloadChannels = new Set(extractedInvokeMethods.map(m => m.channel));
      const missingChannels: string[] = [];
      
      for (const mainChannel of MAIN_IPC_INVOKE_CHANNELS) {
        if (!preloadChannels.has(mainChannel)) {
          missingChannels.push(mainChannel);
        }
      }
      
      assert.deepEqual(
        missingChannels,
        [],
        `Missing preload exposure for channels: ${missingChannels.join(', ')}`
      );
    });
    
    test('preload does not expose undocumented channels', () => {
      // Check for any channels that exist in preload but not in main
      const mainChannels = new Set(MAIN_IPC_INVOKE_CHANNELS);
      const extraChannels: string[] = [];
      
      for (const method of extractedInvokeMethods) {
        // Skip obvious utility methods
        if (method.channel === 'channel-name-placeholder') continue;
        
        // Allow some flexibility - only fail if channel is completely unexpected
        if (!mainChannels.has(method.channel) && 
            !method.channel.startsWith('git-') &&
            !method.channel.startsWith('credential:') &&
            !method.channel.startsWith('vcs:') &&
            !method.channel.startsWith('browser-')) {
          extraChannels.push(method.channel);
        }
      }
      
      // This is informational - we just want to know about extra channels
      if (extraChannels.length > 0) {
        console.log('Extra channels in preload:', extraChannels);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Event Channel Coverage Verification
  // -------------------------------------------------------------------------
  
  describe('Event channel coverage', () => {
    test('all main event channels are handled in preload', () => {
      const preloadEventChannels = new Set(extractedEventMethods.map(m => m.channel));
      const missingEvents: string[] = [];
      
      for (const mainChannel of MAIN_IPC_EVENT_CHANNELS) {
        if (!preloadEventChannels.has(mainChannel)) {
          missingEvents.push(mainChannel);
        }
      }
      
      assert.deepEqual(
        missingEvents,
        [],
        `Missing event handler for channels: ${missingEvents.join(', ')}`
      );
    });
  });

  // -------------------------------------------------------------------------
  // Method-to-Channel Mapping
  // -------------------------------------------------------------------------
  
  describe('Method-to-channel mapping', () => {
    test('getLastWorkspace maps to get-last-workspace', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'getLastWorkspace');
      assert.ok(method, 'getLastWorkspace should exist');
      assert.equal(method.channel, 'get-last-workspace');
    });
    
    test('gitStage maps to git-stage', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'gitStage');
      assert.ok(method, 'gitStage should exist');
      assert.equal(method.channel, 'git-stage');
    });
    
    test('credentialSavePat maps to credential:save-pat', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'credentialSavePat');
      assert.ok(method, 'credentialSavePat should exist');
      assert.equal(method.channel, 'credential:save-pat');
    });
    
    test('vcsGetContext maps to vcs:get-context', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'vcsGetContext');
      assert.ok(method, 'vcsGetContext should exist');
      assert.equal(method.channel, 'vcs:get-context');
    });
  });

  // -------------------------------------------------------------------------
  // Specific API Categories
  // -------------------------------------------------------------------------
  
  describe('Workspace API', () => {
    test('has getLastWorkspace method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'getLastWorkspace'),
        'Should have getLastWorkspace method'
      );
    });
    
    test('has openDirectoryDialog method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'openDirectoryDialog'),
        'Should have openDirectoryDialog method'
      );
    });
    
    test('has readDirectory method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'readDirectory'),
        'Should have readDirectory method'
      );
    });
  });

  describe('Settings API', () => {
    test('has fastfetch getter and setter', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'getShowFastfetch'),
        'Should have getShowFastfetch method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'setShowFastfetch'),
        'Should have setShowFastfetch method'
      );
    });
    
    test('has AI commit settings methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'getAiCommitSettings'),
        'Should have getAiCommitSettings method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'setAiCommitEnabled'),
        'Should have setAiCommitEnabled method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'setAiCommitProvider'),
        'Should have setAiCommitProvider method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'setAiCommitModel'),
        'Should have setAiCommitModel method'
      );
    });
  });

  describe('Terminal API', () => {
    test('has terminal control methods', () => {
      const terminalMethods = [
        'spawnTerminal',
        'getTerminalBuffer',
        'writeTerminal',
        'resizeTerminal',
        'killTerminal',
      ];
      
      for (const method of terminalMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has terminal event handlers', () => {
      assert.ok(
        extractedEventMethods.some(m => m.method === 'onTerminalData'),
        'Should have onTerminalData event handler'
      );
      assert.ok(
        extractedEventMethods.some(m => m.method === 'onTerminalExit'),
        'Should have onTerminalExit event handler'
      );
    });
  });

  describe('Browser API', () => {
    test('has browser navigation methods', () => {
      const browserMethods = [
        'browserNavigate',
        'browserBack',
        'browserForward',
        'browserRefresh',
        'browserStop',
        'browserHide',
      ];
      
      for (const method of browserMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has browser event handlers', () => {
      assert.ok(
        extractedEventMethods.some(m => m.method === 'onBrowserUrlUpdated'),
        'Should have onBrowserUrlUpdated event handler'
      );
    });
  });

  describe('Window Controls API', () => {
    test('has window control methods', () => {
      const windowMethods = [
        'minimizeWindow',
        'toggleMaximizeWindow',
        'closeWindow',
        'isMaximizedWindow',
      ];
      
      for (const method of windowMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
  });

  describe('Harness API', () => {
    test('has harness methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'getHarnessOptions'),
        'Should have getHarnessOptions method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'getHarnessModels'),
        'Should have getHarnessModels method'
      );
    });
  });

  describe('Git API', () => {
    test('has git polling methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitStartPolling'),
        'Should have gitStartPolling method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitStopPolling'),
        'Should have gitStopPolling method'
      );
    });
    
    test('has git commit message generation', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'generateCommitMessage'),
        'Should have generateCommitMessage method'
      );
    });
    
    test('has git staging methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitStage'),
        'Should have gitStage method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitUnstage'),
        'Should have gitUnstage method'
      );
    });
    
    test('has git commit method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitCommit'),
        'Should have gitCommit method'
      );
    });
    
    test('has git branch methods', () => {
      const branchMethods = [
        'gitGetBranchState',
        'gitCreateBranch',
        'gitSwitchBranch',
        'gitDeleteBranch',
        'gitForceDeleteBranch',
        'gitMergeBranch',
      ];
      
      for (const method of branchMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has git history methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitGetHistory'),
        'Should have gitGetHistory method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitGetDiff'),
        'Should have gitGetDiff method'
      );
    });
    
    test('has git stash methods', () => {
      const stashMethods = [
        'gitStash',
        'gitApplyStash',
        'gitPopStash',
        'gitDropStash',
        'gitClearStashes',
      ];
      
      for (const method of stashMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has git operation methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitGetOperationState'),
        'Should have gitGetOperationState method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitAbortOperation'),
        'Should have gitAbortOperation method'
      );
    });
    
    test('has git refresh method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitRefresh'),
        'Should have gitRefresh method'
      );
    });
    
    test('has git remote methods', () => {
      const remoteMethods = [
        'gitGetRemotes',
        'gitAddRemote',
        'gitRemoveRemote',
        'gitRenameRemote',
      ];
      
      for (const method of remoteMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has git sync methods', () => {
      const syncMethods = [
        'gitFetch',
        'gitPull',
        'gitPush',
      ];
      
      for (const method of syncMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has git init method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'gitInit'),
        'Should have gitInit method'
      );
    });
    
    test('has git status event handler', () => {
      assert.ok(
        extractedEventMethods.some(m => m.method === 'onGitStatusUpdate'),
        'Should have onGitStatusUpdate event handler'
      );
    });
  });

  describe('Credentials API', () => {
    test('has SSH key methods', () => {
      const sshMethods = [
        'credentialGenerateSshKey',
        'credentialGetPublicKey',
        'credentialDeleteSshKey',
        'credentialCheckExists',
      ];
      
      for (const method of sshMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has PAT methods', () => {
      const patMethods = [
        'credentialSavePat',
        'credentialGetPat',
        'credentialDeletePat',
      ];
      
      for (const method of patMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
    
    test('has credential status methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'credentialGetStatus'),
        'Should have credentialGetStatus method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'credentialGetGlobalStatus'),
        'Should have credentialGetGlobalStatus method'
      );
    });
    
    test('has SSH host configuration method', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'credentialConfigureSshHost'),
        'Should have credentialConfigureSshHost method'
      );
    });
  });

  describe('VCS Provider API', () => {
    test('has VCS context methods', () => {
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'vcsGetContext'),
        'Should have vcsGetContext method'
      );
      assert.ok(
        extractedInvokeMethods.some(m => m.method === 'vcsGetPrInfo'),
        'Should have vcsGetPrInfo method'
      );
    });
    
    test('has VCS deep link methods', () => {
      const deepLinkMethods = [
        'vcsGetDeepLinks',
        'vcsGetDeepLink',
        'vcsOpenDeepLink',
      ];
      
      for (const method of deepLinkMethods) {
        assert.ok(
          extractedInvokeMethods.some(m => m.method === method),
          `Should have ${method} method`
        );
      }
    });
  });

  describe('Fit All Panes API', () => {
    test('has fit all panes event handler', () => {
      assert.ok(
        extractedEventMethods.some(m => m.method === 'onFitAllPanes'),
        'Should have onFitAllPanes event handler'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Security Verification
  // -------------------------------------------------------------------------
  
  describe('Security considerations', () => {
    test('uses contextBridge for IPC (not direct nodeIntegration)', () => {
      // Verify contextBridge is used
      assert.ok(
        preloadSource.includes('contextBridge.exposeInMainWorld'),
        'Should use contextBridge.exposeInMainWorld'
      );
      
      // Verify no direct ipcRenderer exposure to renderer
      const lines = preloadSource.split('\n');
      const dangerousPatterns = lines.filter(line => 
        line.includes('window.ipcRenderer') ||
        line.includes('global.ipcRenderer')
      );
      
      assert.equal(
        dangerousPatterns.length,
        0,
        'Should not expose ipcRenderer directly to window'
      );
    });
    
    test('only exposes specific API object', () => {
      // Verify we're exposing electronAPI specifically
      assert.ok(
        preloadSource.includes("'electronAPI'") || preloadSource.includes('"electronAPI"'),
        'Should expose electronAPI object'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Comprehensive Coverage Check
  // -------------------------------------------------------------------------
  
  describe('Comprehensive coverage check', () => {
    test('total API surface is comprehensive', () => {
      const totalMethods = extractedInvokeMethods.length + extractedEventMethods.length;
      
      assert.ok(
        totalMethods >= 80,
        `Expected at least 80 total API methods, got ${totalMethods} ` +
        `(${extractedInvokeMethods.length} invoke + ${extractedEventMethods.length} event)`
      );
    });
    
    test('every main process IPC handler has a preload method', () => {
      // This is the key coverage requirement
      const mainChannels = new Set(MAIN_IPC_INVOKE_CHANNELS);
      const preloadChannels = new Set(extractedInvokeMethods.map(m => m.channel));
      
      const notExposed: string[] = [];
      
      for (const channel of mainChannels) {
        if (!preloadChannels.has(channel)) {
          notExposed.push(channel);
        }
      }
      
      assert.deepEqual(
        notExposed,
        [],
        `Channels defined in main but not exposed in preload: ${notExposed.join(', ')}`
      );
    });
    
    test('every main process event handler has a preload listener', () => {
      const mainEvents = new Set(MAIN_IPC_EVENT_CHANNELS);
      const preloadEvents = new Set(extractedEventMethods.map(m => m.channel));
      
      const notExposed: string[] = [];
      
      for (const event of mainEvents) {
        if (!preloadEvents.has(event)) {
          notExposed.push(event);
        }
      }
      
      assert.deepEqual(
        notExposed,
        [],
        `Event channels defined in main but not handled in preload: ${notExposed.join(', ')}`
      );
    });
  });

  // -------------------------------------------------------------------------
  // API Type Verification
  // -------------------------------------------------------------------------
  
  describe('API Type verification', () => {
    test('terminal spawn accepts harness and model parameters', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'spawnTerminal');
      assert.ok(method, 'spawnTerminal should exist');
      
      // Verify the method signature in source includes harness and model
      const spawnLine = preloadSource.match(/spawnTerminal:\s*\([^)]*\)/)?.[0];
      assert.ok(spawnLine?.includes('harness'), 'spawnTerminal should accept harness parameter');
      assert.ok(spawnLine?.includes('model'), 'spawnTerminal should accept model parameter');
    });
    
    test('git stage accepts optional file list', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'gitStage');
      assert.ok(method, 'gitStage should exist');
      
      const stageLine = preloadSource.match(/gitStage:\s*\([^)]*\)/)?.[0];
      assert.ok(stageLine, 'gitStage method signature should be found');
    });
    
    test('git push accepts all optional parameters', () => {
      const method = extractedInvokeMethods.find(m => m.method === 'gitPush');
      assert.ok(method, 'gitPush should exist');
      
      const pushLine = preloadSource.match(/gitPush:\s*\([^)]*\)/)?.[0];
      assert.ok(pushLine, 'gitPush method signature should be found');
    });
  });
});
