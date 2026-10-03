import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../src/renderer/index.html'), 'utf8');

describe('boot splash', () => {
  it('is static markup inside #root, so it paints before the bundle and React replaces it on first render', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const splash = doc.querySelector('#root > .boot-splash');
    expect(splash).not.toBeNull();
    // vite.config.ts inlines the logo here, so dev (branding outside the Vite root) and build both work.
    expect(splash?.querySelector('img')?.getAttribute('src')).toBe('%BOOT_SPLASH_LOGO%');
    expect(readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8')).toContain("'%BOOT_SPLASH_LOGO%'");
  });

  it('applies the theme passed by main before first paint, accepting only plain theme ids', () => {
    const script = new DOMParser().parseFromString(html, 'text/html').querySelector('head script:not([type])')!.textContent!;
    const run = (search: string) => {
      document.documentElement.removeAttribute('data-theme');
      window.history.replaceState(null, '', `/${search}`);
      new Function(script)();
      return document.documentElement.getAttribute('data-theme');
    };
    expect(run('?theme=light')).toBe('light');
    expect(run('?theme=slate')).toBe('slate');
    expect(run('?theme=%22%3E%3Cimg')).toBeNull();
    expect(run('')).toBeNull();
    window.history.replaceState(null, '', '/');
  });
});
