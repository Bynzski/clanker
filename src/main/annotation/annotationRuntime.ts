/**
 * Annotation Runtime
 *
 * JavaScript code injected into browser content via webContents.executeJavaScript().
 * Lives as a string template in main process, injected when annotation mode is enabled.
 *
 * This is the core user-facing code that:
 * - Provides crosshair cursor on enable
 * - Shows hover highlights on mousemove
 * - Displays click-to-select with element metadata capture
 * - Renders in-page popup for note entry
 * - Handles Escape to cancel
 */

/**
 * Injected runtime state interface
 * Lives on window to persist across calls and to enable cleanup
 */
export interface AnnotationRuntimeState {
  active: boolean;
  selectedElement: ElementAnnotationData | null;
  hoveredElement: ElementAnnotationData | null;
}

export interface ElementAnnotationData {
  tagName: string;
  id: string | null;
  className: string | null;
  textContent: string | null;
  attributes: Record<string, string>;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  selector: string;
  fallbackSelectors: string[];
  role: string | null;
  accessibleName: string | null;
  uiRegion: string | null;
  elementRoleInContext: string | null;
  nearbyText: string[];
  ancestorContext: string | null;
}

/**
 * Escape a value for inclusion inside a CSS attribute selector string.
 */
function escapeCssString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Escape a value for inclusion in a CSS id selector.
 */
function escapeCssIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`);
}

/**
 * Build a valid nth-of-type fallback selector using same-tag siblings only.
 */
function buildNthOfTypeSelector(el: Element): string {
  const parent = el.parentElement;
  const tagName = el.tagName.toLowerCase();

  if (!parent) {
    return tagName;
  }

  const sameTagSiblings = Array.from(parent.children).filter(sibling => sibling.tagName === el.tagName);
  const index = sameTagSiblings.indexOf(el);
  return `${tagName}:nth-of-type(${index >= 0 ? index + 1 : 1})`;
}

/**
 * Selector builder with priority order:
 * 1. data-testid (most stable)
 * 2. id (usually stable)
 * 3. role + aria-label (semantic)
 * 4. tag + class (descriptive, more useful than nth-of-type)
 * 5. tag + nth-of-type (last resort)
 */
function buildSelector(el: Element): string {
  // Priority 1: data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${escapeCssString(testId)}"]`;

  // Priority 2: id
  if (el.id) return `#${escapeCssIdent(el.id)}`;

  // Priority 3: role + accessible name
  const role = el.getAttribute('role');
  const ariaLabel = el.getAttribute('aria-label');
  if (role && ariaLabel) {
    return `[role="${escapeCssString(role)}"][aria-label="${escapeCssString(ariaLabel)}"]`;
  }

  // Priority 4: tag + class (more descriptive than nth-of-type)
  const tagClassSelector = buildTagClassSelector(el);
  if (tagClassSelector) return tagClassSelector;

  // Priority 5: tag + nth-of-type fallback (last resort)
  return buildNthOfTypeSelector(el);
}

/**
 * Normalize whitespace in a text snippet.
 */
function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Truncate text to a useful annotation-friendly length.
 */
function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

/**
 * Extract a short text snippet from the element's content.
 */
function getElementTextSnippet(el: Element, maxLength: number): string | null {
  const text = normalizeText(el.textContent);
  if (!text) return null;
  return truncateText(text, maxLength);
}

/**
 * Extract a compact class selector from the element.
 */
function buildClassSelector(el: Element): string | null {
  const classList = normalizeText(el.getAttribute('class'))
    .split(' ')
    .map(className => className.trim())
    .filter(Boolean)
    .filter((className, index, array) => array.indexOf(className) === index)
    .slice(0, 5);

  if (classList.length === 0) {
    return null;
  }

  return `.${classList.map(escapeCssIdent).join('.')}`;
}

/**
 * Build a tag + class selector when the element has useful classes.
 */
function buildTagClassSelector(el: Element): string | null {
  const classSelector = buildClassSelector(el);
  if (!classSelector) return null;
  return `${el.tagName.toLowerCase()}${classSelector}`;
}

/**
 * Build alternate selectors to help anchor the exact element in a larger UI.
 */
function buildFallbackSelectors(el: Element): string[] {
  const fallbacks: string[] = [];
  const primary = buildSelector(el);

  const candidates: Array<string | null> = [];

  const testId = el.getAttribute('data-testid');
  if (testId) {
    candidates.push(`[data-testid="${escapeCssString(testId)}"]`);
  }

  if (el.id) {
    candidates.push(`#${escapeCssIdent(el.id)}`);
  }

  const dataTest = el.getAttribute('data-test');
  if (dataTest) {
    candidates.push(`[data-test="${escapeCssString(dataTest)}"]`);
  }

  const dataQa = el.getAttribute('data-qa');
  if (dataQa) {
    candidates.push(`[data-qa="${escapeCssString(dataQa)}"]`);
  }

  const role = el.getAttribute('role');
  const ariaLabel = el.getAttribute('aria-label');
  if (role && ariaLabel) {
    candidates.push(`[role="${escapeCssString(role)}"][aria-label="${escapeCssString(ariaLabel)}"]`);
  }

  const classSelector = buildClassSelector(el);
  if (classSelector) {
    candidates.push(classSelector);
  }

  const tagClassSelector = buildTagClassSelector(el);
  if (tagClassSelector) {
    candidates.push(tagClassSelector);
  }

  for (const candidate of candidates) {
    if (!candidate || candidate === primary || fallbacks.includes(candidate)) continue;
    fallbacks.push(candidate);
    if (fallbacks.length >= 4) break;
  }

  return fallbacks;
}

/**
 * Resolve the nearest meaningful heading or label for an element.
 */
function findNearestRegionLabel(el: Element): string | null {
  let current: Element | null = el.parentElement;

  while (current) {
    const labelled = normalizeText(current.getAttribute('aria-label')) ||
      normalizeText(current.getAttribute('title'));
    if (labelled) {
      return truncateText(labelled, 80);
    }

    const heading = current.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (heading) {
      const headingText = getElementTextSnippet(heading, 80);
      if (headingText) {
        return headingText;
      }
    }

    current = current.parentElement;
  }

  return null;
}

/**
 * Infer the broad UI region type from the nearest landmark or container.
 */
function inferRegionType(el: Element): string | null {
  let current: Element | null = el.parentElement;

  while (current) {
    const role = normalizeText(current.getAttribute('role')).toLowerCase();
    const tagName = current.tagName.toLowerCase();

    if (role === 'navigation' || tagName === 'nav') return 'navigation';
    if (role === 'complementary' || tagName === 'aside') return 'sidebar';
    if (role === 'main' || tagName === 'main') return 'main content';
    if (role === 'dialog' || tagName === 'dialog') return 'dialog';
    if (role === 'menu') return 'menu';
    if (role === 'tablist') return 'tab list';
    if (role === 'list' || tagName === 'ul' || tagName === 'ol' || tagName === 'dl') return 'list';
    if (role === 'table' || tagName === 'table') return 'table';
    if (role === 'form' || tagName === 'form') return 'form section';
    if (tagName === 'section' || tagName === 'article') {
      const formAncestor = current.closest('form, [role="form"]');
      if (formAncestor) return 'form section';

      const sidebarAncestor = current.closest('aside, [role="complementary"]');
      if (sidebarAncestor) return 'sidebar';

      const navAncestor = current.closest('nav, [role="navigation"]');
      if (navAncestor) return 'navigation';

      const mainAncestor = current.closest('main, [role="main"]');
      if (mainAncestor) return 'main content';

      return 'section';
    }

    current = current.parentElement;
  }

  return null;
}

/**
 * Collect nearby sibling/ancestor text that helps explain the local UI.
 */
function collectNearbyText(el: Element): string[] {
  const snippets: string[] = [];
  const seen = new Set<string>();
  let target: Element | null = el;
  let container = el.parentElement;

  while (container && snippets.length < 4) {
    const children = Array.from(container.children);
    const index = children.indexOf(target as Element);
    if (index >= 0) {
      const orderedSiblings = [...children.slice(index + 1), ...children.slice(0, index).reverse()];

      for (const sibling of orderedSiblings) {
        if (snippets.length >= 4) break;
        if (sibling === target) continue;

        const siblingTag = sibling.tagName.toLowerCase();
        const siblingRole = normalizeText(sibling.getAttribute('role')).toLowerCase();
        if (siblingTag.match(/^h[1-6]$/) || siblingRole === 'heading') continue;

        const text = getElementTextSnippet(sibling, 80);
        if (!text || seen.has(text)) continue;

        seen.add(text);
        snippets.push(text);
      }
    }

    target = container;
    container = container.parentElement;
  }

  return snippets;
}

/**
 * Classify the collection/container that the selected element belongs to.
 */
function inferCollectionLabel(
  el: Element,
  regionType: string | null,
  nearbyText: string[],
  selectedText: string | null
): string | null {
  const repoLike = (text: string | null): boolean => {
    if (!text) return false;
    return /^[\w.-]+\/[\w.-]+/.test(text) || text.includes('/');
  };

  if (regionType === 'table') return 'table';
  if (regionType === 'form section') return 'form section';
  if (regionType === 'dialog') return 'modal';
  if (regionType === 'menu') return 'menu';
  if (regionType === 'tab list') return 'tab list';
  if (regionType === 'navigation') return 'navigation';
  if (regionType === 'main content') return 'main content';

  const isCollection = nearbyText.length >= 1 || repoLike(selectedText);
  if (regionType === 'sidebar' && isCollection) {
    if (repoLike(selectedText) || nearbyText.some(repoLike)) {
      return 'repository list';
    }
    return 'sidebar list';
  }

  if (regionType === 'list' && isCollection) {
    if (repoLike(selectedText) || nearbyText.some(repoLike)) {
      return 'repository list';
    }
    return 'list';
  }

  if (repoLike(selectedText) || nearbyText.some(repoLike)) {
    return 'repository list';
  }

  const tagName = el.tagName.toLowerCase();
  if (tagName === 'li') return 'list';
  if (tagName === 'tr') return 'table';
  if (tagName === 'td' || tagName === 'th') return 'table';

  return null;
}

/**
 * Infer a short, human-readable role for the selected element in its local UI.
 */
function inferElementRoleInContext(
  el: Element,
  collectionLabel: string | null,
  regionType: string | null
): string | null {
  const explicitRole = normalizeText(el.getAttribute('role')).toLowerCase();
  const tagName = el.tagName.toLowerCase();

  if (collectionLabel === 'repository list') {
    return 'repository list entry';
  }

  if (collectionLabel === 'sidebar list') {
    return 'sidebar list entry';
  }

  if (collectionLabel === 'table') {
    if (tagName === 'tr' || explicitRole === 'row') return 'table row';
    if (tagName === 'td' || tagName === 'th' || explicitRole === 'cell') return 'table cell';
    return 'table entry';
  }

  if (collectionLabel === 'form section') {
    if (tagName === 'button' || explicitRole === 'button') return 'action button';
    if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') return 'form field';
    return 'form item';
  }

  if (tagName === 'button' || explicitRole === 'button') return 'button';
  if (tagName === 'a' || explicitRole === 'link') return 'link';
  if (tagName === 'input' || tagName === 'select' || tagName === 'textarea' || explicitRole === 'textbox') {
    return 'form field';
  }
  if (tagName === 'li' || explicitRole === 'listitem') return 'list item';
  if (tagName === 'tr' || explicitRole === 'row') return 'table row';
  if (tagName === 'td' || tagName === 'th' || explicitRole === 'cell') return 'table cell';
  if (tagName.match(/^h[1-6]$/) || explicitRole === 'heading') return 'heading';

  if (regionType === 'sidebar') return 'sidebar item';
  if (regionType === 'navigation') return 'navigation item';
  if (regionType === 'main content' && tagName === 'article') return 'content card';

  return null;
}

/**
 * Build a concise context bundle for the selected element.
 */
function extractContextInfo(el: Element, selectedText: string | null): {
  uiRegion: string | null;
  elementRoleInContext: string | null;
  nearbyText: string[];
  ancestorContext: string | null;
} {
  const regionLabel = findNearestRegionLabel(el);
  const regionType = inferRegionType(el);
  const nearbyText = collectNearbyText(el);
  const collectionLabel = inferCollectionLabel(el, regionType, nearbyText, selectedText);
  const elementRoleInContext = inferElementRoleInContext(el, collectionLabel, regionType);

  const viewport = el.ownerDocument?.defaultView;
  const rect = el.getBoundingClientRect();
  const viewportWidth = viewport?.innerWidth || 0;
  let sideLabel: string | null = null;

  if (viewportWidth > 0 && (regionType === 'sidebar' || regionType === 'navigation' || regionType === 'main content')) {
    if (rect.x < viewportWidth * 0.33) {
      sideLabel = 'left sidebar';
    } else if (rect.x > viewportWidth * 0.66) {
      sideLabel = 'right sidebar';
    } else {
      sideLabel = 'main content';
    }
  } else if (regionType === 'sidebar') {
    sideLabel = 'sidebar';
  }

  const ancestorContextParts = [sideLabel, collectionLabel].filter(Boolean) as string[];
  const ancestorContext = ancestorContextParts.length > 0 ? ancestorContextParts.join(' ') : regionType;

  return {
    uiRegion: regionLabel,
    elementRoleInContext,
    nearbyText,
    ancestorContext,
  };
}

/**
 * Extract accessibility info from element
 */
function getAccessibilityInfo(el: Element): { role: string | null; accessibleName: string | null } {
  return {
    role: el.getAttribute('role') || null,
    accessibleName: el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.getAttribute('aria-describedby') ||
      null,
  };
}

/**
 * Extract element info from a DOM element
 */
export function captureElement(el: Element): ElementAnnotationData {
  const rect = el.getBoundingClientRect();
  const attrs: Record<string, string> = {};

  // Capture common attributes
  const attrWhitelist = ['id', 'name', 'type', 'href', 'src', 'alt', 'title',
    'placeholder', 'value', 'disabled', 'checked',
    'data-testid', 'data-test', 'data-qa'];

  for (const attr of attrWhitelist) {
    const val = el.getAttribute(attr);
    if (val !== null) attrs[attr] = val;
  }

  const { role, accessibleName } = getAccessibilityInfo(el);
  const textContent = getElementTextSnippet(el, 200);
  const fallbackSelectors = buildFallbackSelectors(el);
  const context = extractContextInfo(el, textContent);

  return {
    tagName: el.tagName,
    id: el.id || null,
    className: el.className || null,
    textContent,
    attributes: attrs,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    selector: buildSelector(el),
    fallbackSelectors,
    role,
    accessibleName,
    uiRegion: context.uiRegion,
    elementRoleInContext: context.elementRoleInContext,
    nearbyText: context.nearbyText,
    ancestorContext: context.ancestorContext,
  };
}

function getRuntimeHelperSource(): string {
  return [
    escapeCssString.toString(),
    escapeCssIdent.toString(),
    buildNthOfTypeSelector.toString(),
    buildSelector.toString(),
    normalizeText.toString(),
    truncateText.toString(),
    getElementTextSnippet.toString(),
    buildClassSelector.toString(),
    buildTagClassSelector.toString(),
    buildFallbackSelectors.toString(),
    findNearestRegionLabel.toString(),
    inferRegionType.toString(),
    collectNearbyText.toString(),
    inferCollectionLabel.toString(),
    inferElementRoleInContext.toString(),
    extractContextInfo.toString(),
    getAccessibilityInfo.toString(),
    captureElement.toString(),
  ].join('\n\n');
}

/**
 * CSS injected for annotation overlay
 */
function generateAnnotationCSS(): string {
  return `
    .clanker-annotation-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483646;
      font-family: var(--font-ui, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace);
      color: #e8e8e8;
    }
    .clanker-annotation-highlight {
      position: absolute;
      border: 1px solid rgba(139, 148, 158, 0.8);
      background: rgba(139, 148, 158, 0.12);
      border-radius: 4px;
      pointer-events: none;
      transition: border-color 0.1s ease, background-color 0.1s ease, box-shadow 0.1s ease;
      box-sizing: border-box;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.55);
    }
    .clanker-annotation-highlight.hover {
      border-color: rgba(139, 148, 158, 1);
      background: rgba(139, 148, 158, 0.16);
    }
    .clanker-annotation-highlight.selected {
      border-color: rgba(139, 148, 158, 1);
      background: rgba(139, 148, 158, 0.2);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 0 0 1px rgba(139, 148, 158, 0.24);
    }
    .clanker-annotation-label {
      position: absolute;
      background: #1a1a1a;
      color: #e8e8e8;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #2f2f2f;
      font-size: 11px;
      white-space: nowrap;
      pointer-events: none;
      transform: translateX(-50%);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .clanker-annotation-popup {
      position: fixed;
      z-index: 2147483647;
      background: #1a1a1a;
      border: 1px solid #2f2f2f;
      border-radius: 4px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      padding: 12px;
      min-width: 340px;
      max-width: 420px;
      pointer-events: auto;
      color: #e8e8e8;
      font-family: var(--font-ui, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace);
      opacity: 1;
    }
    .clanker-annotation-popup-header {
      font-weight: 600;
      font-size: 13px;
      color: #e8e8e8;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .clanker-annotation-popup-tag {
      background: #232323;
      color: #e8e8e8;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid #2f2f2f;
    }
    .clanker-annotation-popup-close {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      color: #9b9b9b;
      font-size: 16px;
      line-height: 1;
      flex: 0 0 auto;
    }
    .clanker-annotation-popup-close:hover {
      color: #e8e8e8;
      background: #232323;
      border-color: #2f2f2f;
    }
    .clanker-annotation-popup-info {
      font-size: 11px;
      color: #9b9b9b;
      margin-bottom: 8px;
      line-height: 1.5;
      padding: 8px 10px;
      background: #232323;
      border: 1px solid #2f2f2f;
      border-radius: 4px;
      word-break: break-word;
    }
    .clanker-annotation-popup-note {
      width: 100%;
      min-height: 72px;
      padding: 9px 10px;
      border: 1px solid #2f2f2f;
      border-radius: 4px;
      background: #121212;
      color: #e8e8e8;
      font-size: 13px;
      line-height: 1.45;
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;
      margin-bottom: 8px;
    }
    .clanker-annotation-popup-note:focus {
      outline: none;
      border-color: #8b949e;
      box-shadow: 0 0 0 2px #6f7680;
    }
    .clanker-annotation-popup-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .clanker-annotation-btn {
      padding: 7px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
    }
    .clanker-annotation-btn-primary {
      background: #8b949e;
      color: #121212;
      border-color: #8b949e;
    }
    .clanker-annotation-btn-primary:hover {
      background: #a1a8b0;
      border-color: #a1a8b0;
    }
    .clanker-annotation-btn-secondary {
      background: #232323;
      color: #e8e8e8;
      border-color: #2f2f2f;
    }
    .clanker-annotation-btn-secondary:hover {
      background: #2f2f2f;
    }
    .clanker-annotation-cursor {
      cursor: crosshair !important;
    }
  `.trim();
}

/**
 * Generate the full runtime code as a string
 * This is what gets injected via executeJavaScript()
 */
export function generateAnnotationRuntime(): string {
  return `
${getRuntimeHelperSource()}

(function() {
  // Prevent double-injection
  if (window.__clankerAnnotation__) {
    return;
  }
  window.__clankerAnnotation__ = {
    active: false,
    selectedElement: null,
    hoveredElement: null,
    overlayEl: null,
    highlightEl: null,
    labelEl: null,
    popupEl: null,
    injectedStyles: false
  };

  var state = window.__clankerAnnotation__;

  function injectCSS() {
    if (state.injectedStyles) return;
    var style = document.createElement('style');
    style.textContent = ${JSON.stringify(generateAnnotationCSS())};
    document.head.appendChild(style);
    state.injectedStyles = true;
  }

  function createOverlay() {
    if (state.overlayEl) return;

    var overlay = document.createElement('div');
    overlay.className = 'clanker-annotation-overlay';
    overlay.innerHTML = '<div class="clanker-annotation-highlight"></div><div class="clanker-annotation-label"></div>';
    document.body.appendChild(overlay);

    state.overlayEl = overlay;
    state.highlightEl = overlay.querySelector('.clanker-annotation-highlight');
    state.labelEl = overlay.querySelector('.clanker-annotation-label');
  }

  function updateHighlight(info, isHover) {
    if (!state.highlightEl || !state.labelEl || !info) return;

    var hl = state.highlightEl;
    var label = state.labelEl;

    hl.style.left = info.bounds.x + 'px';
    hl.style.top = info.bounds.y + 'px';
    hl.style.width = info.bounds.width + 'px';
    hl.style.height = info.bounds.height + 'px';
    hl.className = 'clanker-annotation-highlight' + (isHover ? ' hover' : ' selected');

    // Label position (above element, centered)
    label.style.left = (info.bounds.x + info.bounds.width / 2) + 'px';
    label.style.top = (info.bounds.y - 24) + 'px';

    // Label content
    var labelText = info.tagName.toLowerCase();
    if (info.id) labelText += '#' + info.id;
    else if (info.attributes && info.attributes['data-testid']) labelText += '[data-testid]';
    if (info.textContent && info.textContent.length < 30) {
      labelText += ': ' + info.textContent;
    }
    label.textContent = labelText;
    label.style.display = 'block';
  }

  function hideHighlight() {
    if (!state.highlightEl || !state.labelEl) return;
    state.highlightEl.style.width = '0';
    state.highlightEl.style.height = '0';
    state.labelEl.style.display = 'none';
  }

  function removePopup() {
    if (state.popupEl) {
      state.popupEl.remove();
      state.popupEl = null;
    }
  }

  function showPopup(elementInfo) {
    removePopup();

    var popup = document.createElement('div');
    popup.className = 'clanker-annotation-popup';

    // Popup dimensions (fixed min/max from CSS)
    var popupWidth = 350; // min-width
    var popupHeight = 200; // estimated height for safety margin

    // Determine preferred horizontal position (below element, left-aligned)
    var preferredX = elementInfo.bounds.x;
    var preferredY = elementInfo.bounds.y + elementInfo.bounds.height + 8;

    // Calculate actual position with viewport bounds checking
    // Clamp left edge to stay within viewport
    var left = Math.max(8, Math.min(preferredX, window.innerWidth - popupWidth - 8));

    // For vertical: try below first, then above, then clamp to viewport
    var top;
    if (preferredY + popupHeight <= window.innerHeight - 8) {
      // Fits below the element
      top = preferredY;
    } else if (elementInfo.bounds.y - popupHeight - 8 >= 8) {
      // Fits above the element
      top = elementInfo.bounds.y - popupHeight - 8;
    } else {
      // Clamp to available space at top of viewport
      top = 8;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';

    // Selector info for display
    var selectorPreview = elementInfo.selector;
    if (selectorPreview.length > 50) selectorPreview = selectorPreview.slice(0, 50) + '...';

    popup.innerHTML =
      '<div class="clanker-annotation-popup-header">' +
        '<span class="clanker-annotation-popup-tag">' + elementInfo.tagName + '</span>' +
        '<button class="clanker-annotation-popup-close" id="clanker-annotation-close">&times;</button>' +
      '</div>' +
      '<div class="clanker-annotation-popup-info">' +
        'Selector: ' + selectorPreview + '<br>' +
        'Size: ' + Math.round(elementInfo.bounds.width) + 'x' + Math.round(elementInfo.bounds.height) +
      '</div>' +
      '<textarea class="clanker-annotation-popup-note" id="clanker-annotation-note" ' +
        'placeholder="Add your annotation note here..."></textarea>' +
      '<div class="clanker-annotation-popup-actions">' +
        '<button class="clanker-annotation-btn clanker-annotation-btn-secondary" id="clanker-annotation-cancel">Cancel</button>' +
        '<button class="clanker-annotation-btn clanker-annotation-btn-primary" id="clanker-annotation-copy">Copy Annotation</button>' +
      '</div>';

    document.body.appendChild(popup);
    state.popupEl = popup;

    // Event handlers
    popup.querySelector('#clanker-annotation-close').addEventListener('click', function() {
      removePopup();
      state.selectedElement = null;
      document.body.classList.remove('clanker-annotation-cursor');
    });

    popup.querySelector('#clanker-annotation-cancel').addEventListener('click', function() {
      removePopup();
      state.selectedElement = null;
      document.body.classList.remove('clanker-annotation-cursor');
    });

    popup.querySelector('#clanker-annotation-copy').addEventListener('click', function() {
      var note = popup.querySelector('#clanker-annotation-note').value;
      var annotation = buildAnnotation(elementInfo, note);
      // Store for capture and signal main process that copy was requested
      window.__clankerAnnotationData__ = annotation;
      window.__clankerAnnotationCopyTrigger__ = true;
      removePopup();
      state.selectedElement = null;
      document.body.classList.remove('clanker-annotation-cursor');
    });

    // Focus the textarea
    popup.querySelector('#clanker-annotation-note').focus();
  }

  function buildAnnotation(info, note) {
    return {
      url: window.location.href,
      title: document.title,
      tagName: info.tagName,
      selector: info.selector,
      id: info.id,
      className: info.className,
      text: info.textContent,
      role: info.role,
      accessibleName: info.accessibleName,
      attributes: info.attributes,
      bounds: info.bounds,
      note: note,
      timestamp: new Date().toISOString()
    };
  }

  function handleMouseMove(e) {
    if (!state.active) return;

    var target = e.target;
    // Skip overlay elements
    if (target.closest && target.closest('.clanker-annotation-overlay, .clanker-annotation-popup')) {
      hideHighlight();
      return;
    }

    var info = captureElement(target);
    state.hoveredElement = info;
    updateHighlight(info, true);
  }

  function handleClick(e) {
    if (!state.active) return;

    var target = e.target;
    if (target.closest && target.closest('.clanker-annotation-popup')) return;

    e.preventDefault();
    e.stopPropagation();

    var info = captureElement(target);
    state.selectedElement = info;
    updateHighlight(info, false);
    showPopup(info);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && state.active) {
      cleanup();
      // Signal to main process that annotation was escaped from the page side.
      // The main process before-input-event handler is the authoritative escape
      // detector; this is a fallback for cases where the main handler is not attached.
      window.__clankerAnnotationEscaped__ = true;
    }
  }

  function cleanup() {
    state.active = false;
    document.body.classList.remove('clanker-annotation-cursor');

    // Remove document listeners to prevent accumulation across enable/disable cycles
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeydown, true);

    if (state.overlayEl) {
      state.overlayEl.remove();
      state.overlayEl = null;
    }

    removePopup();

    // Remove injected CSS (by finding and removing it)
    var styles = document.querySelectorAll('style');
    styles.forEach(function(s) {
      if (s.textContent && s.textContent.includes('clanker-annotation')) {
        s.remove();
      }
    });
    state.injectedStyles = false;
  }

  // Export public API
  window.__clankerAnnotationEnable__ = function() {
    if (state.active) return;
    injectCSS();
    createOverlay();
    state.active = true;
    document.body.classList.add('clanker-annotation-cursor');
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown, true);
  };

  window.__clankerAnnotationDisable__ = function() {
    cleanup();
  };

  window.__clankerAnnotationIsActive__ = function() {
    return state.active;
  };

  // Return current annotation for capture
  window.__clankerAnnotationGetData__ = function() {
    return window.__clankerAnnotationData__ || null;
  };

  // Clear pending annotation
  window.__clankerAnnotationClearData__ = function() {
    window.__clankerAnnotationData__ = null;
  };

  // Check and clear copy trigger flag (returns true once when copy was triggered)
  window.__clankerAnnotationCheckCopyTrigger__ = function() {
    if (window.__clankerAnnotationCopyTrigger__) {
      window.__clankerAnnotationCopyTrigger__ = false;
      return true;
    }
    return false;
  };

  // Check if user pressed Escape (reset flag after reading)
  window.__clankerAnnotationCheckEscaped__ = function() {
    if (window.__clankerAnnotationEscaped__) {
      window.__clankerAnnotationEscaped__ = false;
      return true;
    }
    return false;
  };

  console.log('[Clanker Annotation] Runtime injected');
})();
  `.trim();
}

/**
 * Generate capture code that extracts annotation from the page
 * This is what gets executed via executeJavaScript() on demand
 */
export function generateCaptureCode(): string {
  return `
(function() {
  if (!window.__clankerAnnotation__) {
    return { error: 'Runtime not initialized' };
  }

  var annotation = window.__clankerAnnotationData__;
  if (!annotation) {
    return { error: 'No annotation pending' };
  }

  // Clear after capture
  window.__clankerAnnotationData__ = null;

  return annotation;
})()
  `.trim();
}

/**
 * Generate enable code that arms the runtime
 */
export function generateEnableCode(): string {
  return `
(function() {
  if (window.__clankerAnnotationEnable__) {
    window.__clankerAnnotationEnable__();
    return { success: true, active: window.__clankerAnnotationIsActive__() };
  }
  return { error: 'Runtime not found' };
})()
  `.trim();
}

/**
 * Generate disable code that cleans up
 */
export function generateDisableCode(): string {
  return `
(function() {
  if (window.__clankerAnnotationDisable__) {
    window.__clankerAnnotationDisable__();
    return { success: true };
  }
  return { success: true };
})()
  `.trim();
}

/**
 * Generate status check code
 */
export function generateStatusCode(): string {
  return `
(function() {
  if (!window.__clankerAnnotation__) {
    return { initialized: false, active: false };
  }
  return {
    initialized: true,
    active: window.__clankerAnnotationIsActive__(),
    hasAnnotation: !!(window.__clankerAnnotationData__),
    copyTriggered: !!(window.__clankerAnnotationCopyTrigger__)
  };
})()
  `.trim();
}

/**
 * Generate copy trigger check code.
 * Returns true if the copy trigger is set and clears it atomically.
 */
export function generateCheckCopyTriggerCode(): string {
  return `
(function() {
  if (window.__clankerAnnotationCopyTrigger__) {
    window.__clankerAnnotationCopyTrigger__ = false;
    return true;
  }
  return false;
})()
  `.trim();
}
