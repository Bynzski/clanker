import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
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
