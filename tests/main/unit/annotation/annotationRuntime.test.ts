import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  captureElement,
  generateAnnotationRuntime,
} from '../../../../src/main/annotation/annotationRuntime';

describe('annotationRuntime', () => {
  it('escapes ids before emitting selectors', () => {
    const dom = new JSDOM('<button id="save:btn">Save</button>');
    const element = dom.window.document.querySelector('button');

    expect(element).not.toBeNull();
    expect(captureElement(element as Element).selector).toBe('#save\\:btn');
  });

  it('uses same-tag nth-of-type fallback for mixed sibling trees', () => {
    const dom = new JSDOM('<div></div><span></span><button>Save changes</button>');
    const element = dom.window.document.querySelector('button');

    expect(element).not.toBeNull();
    expect(captureElement(element as Element).selector).toBe('button:nth-of-type(1)');
    expect(captureElement(element as Element).selector).not.toContain(':contains(');
  });

  it('extracts repository list context for a GitHub-style sidebar entry', () => {
    const dom = new JSDOM(`
      <aside aria-label="Sidebar">
        <section>
          <h2>Top repositories</h2>
          <div class="repo-list">
            <div class="width-full d-flex mt-2">Bynzski/clanker-built</div>
            <div class="width-full d-flex mt-2">Bynzski/base_app</div>
            <div class="width-full d-flex mt-2">Bynzski/LandSnag</div>
            <div class="width-full d-flex mt-2">Bynzski/clanker</div>
            <div class="width-full d-flex mt-2">Bynzski/clanker-grid</div>
          </div>
        </section>
      </aside>
    `);
    const element = dom.window.document.querySelector('.width-full.d-flex.mt-2');

    expect(element).not.toBeNull();

    const capture = captureElement(element as Element);
    expect(capture.uiRegion).toBe('Top repositories');
    expect(capture.elementRoleInContext).toBe('repository list entry');
    expect(capture.ancestorContext).toContain('sidebar repository list');
    expect(capture.fallbackSelectors).toContain('.width-full.d-flex.mt-2');
    expect(capture.nearbyText).toEqual(
      expect.arrayContaining([
        'Bynzski/base_app',
        'Bynzski/LandSnag',
        'Bynzski/clanker',
        'Bynzski/clanker-grid',
      ])
    );
  });

  it('extracts form context without relying on list-specific heuristics', () => {
    const dom = new JSDOM(`
      <form aria-label="Project settings">
        <section>
          <h2>Profile</h2>
          <label>Display name <input type="text" value="Clanker Grid" /></label>
          <label>Handle <input type="text" value="@clanker" /></label>
        </section>
      </form>
    `);
    const element = dom.window.document.querySelector('input');

    expect(element).not.toBeNull();

    const capture = captureElement(element as Element);
    expect(capture.uiRegion).toBe('Profile');
    expect(capture.elementRoleInContext).toBe('form field');
    expect(capture.ancestorContext).toBe('form section');
    expect(capture.nearbyText).toEqual(expect.arrayContaining(['Handle']));
  });

  it('embeds the DOM helpers in the injected runtime', () => {
    const runtime = generateAnnotationRuntime();

    expect(runtime).toContain('function captureElement');
    expect(runtime).toContain('function buildSelector');
    expect(runtime).toContain('background: #1a1a1a');
    expect(runtime).toContain('border-radius: 4px');
    expect(runtime).toContain("font-family: var(--font-ui, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace)");
    expect(runtime).not.toContain(':contains(');
  });
});
