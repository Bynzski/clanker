import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { useThemeStore } from './theme/themeStore'

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

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Root element not found');
  }

  try {
    await useThemeStore.getState().initializeTheme();
  } catch (error) {
    console.error('[clanker-grid] Theme initialization error:', error);
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
  }
}

void bootstrap();
