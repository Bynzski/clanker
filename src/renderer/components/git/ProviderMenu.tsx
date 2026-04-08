/**
 * ProviderMenu Component
 * Dropdown menu with quick links to provider pages.
 */

import { useState, useRef, useEffect } from 'react';
import {
  ExternalLink,
  GitBranch,
  GitPullRequest,
  AlertCircle,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import type { DeepLink, ProviderContext } from '../../store/vcsStore';
import './ProviderMenu.css';

interface ProviderMenuProps {
  /** Provider context */
  provider: ProviderContext | null;
  /** Available deep links */
  deepLinks: DeepLink[];
  /** Whether menu is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Callback to refresh context */
  onRefresh?: () => void;
  /** Callback when a link is clicked */
  onLinkClick?: (link: DeepLink) => void;
  /** Current workspace path */
  workspacePath: string;
}

/**
 * Get icon for deep link type.
 */
function getLinkIcon(type: DeepLink['type']) {
  switch (type) {
    case 'pr':
    case 'create-pr':
      return <GitPullRequest size={12} />;
    case 'branches':
      return <GitBranch size={12} />;
    default:
      return <ExternalLink size={12} />;
  }
}

export default function ProviderMenu({
  provider,
  deepLinks,
  isLoading,
  error,
  onRefresh,
  onLinkClick,
  workspacePath,
}: ProviderMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLinkClick = (link: DeepLink) => {
    onLinkClick?.(link);
    setIsOpen(false);

    // Open in system browser (could also open in browser panel)
    window.electronAPI.vcsOpenDeepLink(workspacePath, link.type);
  };

  const handleRefresh = () => {
    onRefresh?.();
  };

  const providerName = provider?.provider === 'github'
    ? 'GitHub'
    : provider?.provider === 'gitlab'
      ? 'GitLab'
      : provider?.provider === 'bitbucket'
        ? 'Bitbucket'
        : 'Provider';

  return (
    <div className="provider-menu-container" ref={menuRef}>
      <button
        type="button"
        className="provider-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || !provider}
        title={`View on ${providerName}`}
      >
        {isLoading ? (
          <Loader2 size={14} className="spin" />
        ) : (
          <>
            <ExternalLink size={14} />
            <span className="provider-menu-label">View on {providerName}</span>
            <ChevronDown size={12} className={`provider-menu-chevron ${isOpen ? 'open' : ''}`} />
          </>
        )}
      </button>

      {isOpen && provider && (
        <div className="provider-menu-dropdown">
          {/* Provider info header */}
          <div className="provider-menu-header">
            <span className="provider-repo-name">
              {provider.owner}/{provider.repo}
            </span>
            <button
              type="button"
              className="provider-menu-refresh"
              onClick={handleRefresh}
              title="Refresh"
            >
              <Loader2 size={12} />
            </button>
          </div>

          {/* Error state */}
          {error && (
            <div className="provider-menu-error">
              <AlertCircle size={12} />
              <span>{error}</span>
            </div>
          )}

          {/* Deep links */}
          <div className="provider-menu-links">
            {deepLinks.map((link) => (
              <button
                key={link.type}
                type="button"
                className="provider-menu-link"
                onClick={() => handleLinkClick(link)}
              >
                {getLinkIcon(link.type)}
                <span>{link.label}</span>
                <ExternalLink size={10} className="provider-menu-link-arrow" />
              </button>
            ))}
          </div>

          {deepLinks.length === 0 && !error && !isLoading && (
            <div className="provider-menu-empty">
              No links available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
