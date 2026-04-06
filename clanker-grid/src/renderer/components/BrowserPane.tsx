import { useState, useRef } from 'react';
import { Globe, ArrowLeft, RotateCw, ExternalLink } from 'lucide-react';
import './BrowserPane.css';

interface BrowserPaneProps {
  url: string;
  onUrlChange: (url: string) => void;
}

export default function BrowserPane({ url, onUrlChange }: BrowserPaneProps) {
  const [inputUrl, setInputUrl] = useState(url);
  const [key, setKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleNavigate = () => {
    let navigateUrl = inputUrl.trim();
    if (!navigateUrl) return;

    if (!navigateUrl.startsWith('http://') && !navigateUrl.startsWith('https://')) {
      navigateUrl = 'https://' + navigateUrl;
    }

    onUrlChange(navigateUrl);
    setKey(k => k + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
    }
  };

  const handleRefresh = () => {
    setKey(k => k + 1);
  };

  const handleBack = () => {
    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.history.back();
      }
    } catch {
      // Cross-origin restriction - just reload
      setKey(k => k + 1);
    }
  };

  const handleOpenExternal = () => {
    window.electronAPI.openExternal(url);
  };

  return (
    <div className="browser-pane">
      <div className="browser-pane-header">
        <Globe size={14} strokeWidth={2} className="browser-pane-icon" />
        <span className="browser-pane-title">Browser</span>
        <div className="browser-pane-nav">
          <button 
            className="browser-pane-btn" 
            onClick={handleBack} 
            title="Back"
          >
            <ArrowLeft size={14} strokeWidth={2} />
          </button>
          <button 
            className="browser-pane-btn" 
            onClick={handleRefresh} 
            title="Refresh"
          >
            <RotateCw size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="browser-pane-url-container">
          <input
            type="text"
            className="browser-pane-url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
          />
        </div>
        <button className="browser-pane-btn browser-pane-go" onClick={handleNavigate}>
          Go
        </button>
        <button 
          className="browser-pane-btn browser-pane-external" 
          onClick={handleOpenExternal} 
          title="Open in system browser"
        >
          <ExternalLink size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="browser-pane-content">
        <iframe
          key={key}
          ref={iframeRef}
          src={url}
          className="browser-pane-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock"
          title="Web Browser"
        />
      </div>
    </div>
  );
}
