import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { useThemeStore, applyThemeToDocument } from './theme/themeStore'
import { startTerminalThemeSync } from './theme/themeRuntime'
import { DEFAULT_THEME_ID } from '../shared/types/theme'

// Global exception handlers for renderer process
window.addEventListener('unhandledrejection', (event) => {
  console.error('[clanker-grid] Unhandled promise rejection:', event.reason);
  if (event.reason?.stack) {
    console.error(event.reason.stack);
  }
});

window.addEventListener('error', (event) => {
  console.error('[clanker-grid] Uncaught error:', event.message);
  if (event.error?.stack) {
    console.error(event.error.stack);
  }
});

export async function bootstrap(rootElement?: HTMLElement | null): Promise<void> {
  const root = rootElement ?? (typeof document !== 'undefined' ? document.getElementById('root') : null);
  if (!root) {
    throw new Error('Root element not found');
  }

  startTerminalThemeSync();

  try {
    await useThemeStore.getState().initializeTheme();
  } catch (error) {
    console.error('[clanker-grid] Theme initialization error:', error);
    applyThemeToDocument(DEFAULT_THEME_ID);
  }

  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    console.error('React render error:', error);
    root.innerHTML = `<div style="color: white; padding: 20px;">Error: ${error}</div>`;
  } finally {
    if (typeof window !== 'undefined' && window.electronAPI?.windowReadyToShow) {
      try {
        await window.electronAPI.windowReadyToShow();
      } catch (e) {
        console.error('[clanker-grid] Failed to notify windowReadyToShow:', e);
      }
    }
  }
}

if (typeof document !== 'undefined' && process.env.NODE_ENV !== 'test') {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    void bootstrap(rootElement);
  }
}
