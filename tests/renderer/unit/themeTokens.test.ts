import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_IDS, getThemeMetadata, type ThemeId } from '../../../src/shared/types/theme';

const rendererRoot = resolve(__dirname, '../../../src/renderer');
const globalCss = readFileSync(resolve(rendererRoot, 'styles/global.css'), 'utf8');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css: string) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const declarations = (body: string) => new Map(
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);
function palette(theme: ThemeId) {
  const rule = rules(globalCss).find((match) => match[1].includes(`:root[data-theme="${theme}"]`));
  expect(rule, `${theme} palette must exist`).toBeDefined();
  return declarations(rule![2]);
}
const dark = palette('dark');
const light = palette('light');
const coreTokens = [
  'surface-app', 'surface-raised', 'surface-elevated', 'surface-sunken', 'surface-control',
  'surface-control-hover', 'surface-header', 'surface-hover', 'surface-active', 'surface-selected',
  'surface-preview', 'surface-preview-active', 'text-primary', 'text-secondary', 'text-muted',
  'text-inverse', 'text-link', 'border-subtle', 'border-default', 'border-strong', 'focus-ring',
  'control-primary-bg', 'control-primary-bg-hover', 'control-primary-fg', 'control-primary-fg-hover',
  'control-danger-bg', 'control-danger-fg', 'status-success', 'status-warning', 'status-error',
  'status-info', 'status-merged', 'git-added', 'git-modified', 'git-deleted', 'git-renamed',
  'git-untracked', 'overlay-backdrop', 'shadow-popover', 'shadow-dialog', 'selection-bg',
  'selection-fg', 'scrollbar-track', 'scrollbar-thumb', 'scrollbar-thumb-hover',
];
const cssFiles = readdirSync(rendererRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .map((entry) => resolve(entry.parentPath, entry.name));

// Radix provides only these positioning dimensions at runtime. Keep the theme
// contract strict for every other reference, including all color/focus roles.
const runtimeDimensions = new Map([
  [resolve(rendererRoot, 'components/ChatHistoryDropdown.css'), new Set([
    '--radix-popover-content-available-height',
  ])],
  [resolve(rendererRoot, 'components/UsageDropdown.css'), new Set([
    '--radix-popover-content-available-height',
  ])],
  [resolve(rendererRoot, 'components/ui/Popover.css'), new Set([
    '--radix-popover-content-available-width', '--radix-popover-content-available-height',
  ])],
]);

// WCAG relative luminance for the opaque text/control palette contract.
function luminance(hex: string) {
  const rgb = hex.slice(1).length === 3 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = parseInt(rgb.slice(index * 2, index * 2 + 2), 16) / 255;
    return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  }, 0);
}
function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('renderer semantic theme contract', () => {
  it.each(THEME_IDS)('matches the native window background to the %s application surface', (theme) => {
    expect(getThemeMetadata(theme).windowBackground).toBe(palette(theme).get('--surface-app'));
  });

  it('defines the same nonempty color contract in every registered palette', () => {
    for (const theme of THEME_IDS) {
      const colors = palette(theme);
      expect([...colors.keys()].sort()).toEqual([...dark.keys()].sort());
      for (const token of coreTokens) {
        expect(colors.get(`--${token}`), `${theme} ${token}`).toBeTruthy();
      }
    }
  });

  it('keeps structural tokens shared and the missing-theme fallback Dark', () => {
    const shared = rules(globalCss).find((rule) => rule[1].trim() === ':root');
    expect(shared).toBeDefined();
    const structural = declarations(shared![2]);
    expect(structural.has('--font-ui')).toBe(true);
    expect(structural.has('--space-md')).toBe(true);
    expect(structural.has('--radius-md')).toBe(true);
    expect(structural.has('--transition')).toBe(true);
    for (const token of structural.keys()) {
      expect(dark.has(token)).toBe(false);
      expect(light.has(token)).toBe(false);
    }
    const fallback = rules(globalCss).find((rule) => rule[1].includes(':root[data-theme="dark"]'))!;
    expect(fallback[1].split(',').map((selector) => selector.trim())).toContain(':root');
    expect(fallback[2]).toMatch(/color-scheme:\s*dark;/);
    expect(globalCss).toMatch(/:root\[data-theme="light"\][\s\S]*?color-scheme:\s*light;/);
    expect(dark.get('--surface-app')).toBe('#121212');
    expect(dark.get('--text-primary')).toBe('#e8e8e8');
  });

  it('resolves every CSS token and removes the old brightness-based contract', () => {
    const defined = new Set(rules(globalCss).flatMap((rule) => [...declarations(rule[2]).keys()]));
    for (const file of cssFiles) {
      const css = withoutComments(readFileSync(file, 'utf8'));
      expect(css, file).not.toMatch(/--(?:bg-(?:primary|secondary|tertiary|hover|active)|border-color|accent-(?:primary|secondary|success|warning|error)|text-tertiary)\b/);
      for (const reference of css.matchAll(/var\((--[\w-]+)/g)) {
        expect(defined.has(reference[1]) || runtimeDimensions.get(file)?.has(reference[1]) === true, `${file}: ${reference[1]}`).toBe(true);
      }
    }
  });

  it('limits component color literals to provider identities', () => {
    for (const file of cssFiles.filter((file) => file !== resolve(rendererRoot, 'styles/global.css'))) {
      for (const rule of rules(readFileSync(file, 'utf8'))) {
        if (!/#[\da-f]{3,8}\b|rgba?\(|:\s*(?:white|black)\b/i.test(rule[2])) continue;
        const providerIdentity = file === resolve(rendererRoot, 'components/GitButton.css') && /\.provider-(?:bitbucket|gitlab)\b/.test(rule[1]);
        expect(providerIdentity, `${file}: ${rule[1].trim()}`).toBe(true);
      }
    }
  });

  it('provides readable Slate text, statuses, actions and focus', () => {
    const slate = palette('slate');
    for (const foreground of ['text-primary', 'text-secondary', 'text-muted', 'text-link',
      'status-success', 'status-warning', 'status-error', 'status-info', 'status-merged',
      'git-added', 'git-modified', 'git-deleted', 'git-renamed', 'git-untracked']) {
      for (const background of ['surface-app', 'surface-raised', 'surface-elevated', 'surface-control']) {
        expect(contrast(slate.get(`--${foreground}`)!, slate.get(`--${background}`)!), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const [foreground, background] of [
      ['control-primary-fg', 'control-primary-bg'], ['control-primary-fg-hover', 'control-primary-bg-hover'],
      ['control-danger-fg', 'control-danger-bg'], ['text-inverse', 'control-success-bg'],
      ['text-inverse', 'control-success-bg-hover'],
    ]) {
      expect(contrast(slate.get(`--${foreground}`)!, slate.get(`--${background}`)!), background).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(slate.get('--focus-ring')!, slate.get('--surface-app')!)).toBeGreaterThanOrEqual(3);
  });

  it('provides readable Light text, statuses and filled actions', () => {
    const text = ['text-primary', 'text-secondary', 'text-muted', 'text-link', 'status-success',
      'status-warning', 'status-error', 'status-info', 'status-merged', 'git-added', 'git-modified',
      'git-deleted', 'git-renamed', 'git-untracked'];
    for (const foreground of text) {
      for (const background of ['surface-app', 'surface-raised', 'surface-elevated', 'surface-control']) {
        expect(contrast(light.get(`--${foreground}`)!, light.get(`--${background}`)!), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Badges and status actions also use translucent status colors over chrome.
    for (const token of text.filter((name) => name.startsWith('status-') || name.startsWith('git-'))) {
      const foreground = light.get(`--${token}`)!;
      const base = light.get('--surface-raised')!;
      const tinted = '#' + [0, 1, 2].map((index) => {
        const offset = 1 + index * 2;
        const channel = Math.round(parseInt(foreground.slice(offset, offset + 2), 16) * 0.25
          + parseInt(base.slice(offset, offset + 2), 16) * 0.75);
        return channel.toString(16).padStart(2, '0');
      }).join('');
      expect(contrast(foreground, tinted), `${token} on its 25% tint`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [foreground, background] of [
      ['control-primary-fg', 'control-primary-bg'], ['control-primary-fg', 'control-primary-bg-hover'],
      ['control-primary-fg-hover', 'control-primary-bg-hover'], ['control-danger-fg', 'control-danger-bg'],
      ['text-inverse', 'control-success-bg'], ['text-inverse', 'control-success-bg-hover'],
    ]) {
      expect(contrast(light.get(`--${foreground}`)!, light.get(`--${background}`)!), background).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(light.get('--focus-ring')!, light.get('--surface-app')!)).toBeGreaterThanOrEqual(3);
  });
});
