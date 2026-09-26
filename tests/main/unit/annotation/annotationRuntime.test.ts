import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  captureElement,
  generateCaptureCode,
  generateDisableCode,
  generateDrainActionsCode,
  generateAnnotationRuntime,
} from '../../../../src/main/annotation/annotationRuntime';
import { mapRawCaptureToAnnotationData, type RawCaptureResult } from '../../../../src/main/annotation/annotationCaptureParser';
import { formatAnnotationMarkdown } from '../../../../src/main/annotation/annotationMarkdownFormatter';

describe('annotationRuntime', () => {
  it('escapes ids before emitting selectors', () => {
    const dom = new JSDOM('<button id="save:btn">Save</button>');
    const element = dom.window.document.querySelector('button');

    expect(element).not.toBeNull();
    expect(captureElement(element as Element).selector).toBe('#save\\:btn');
  });

  it('prefers a unique data-test attribute over generated classes', () => {
    const dom = new JSDOM('<span data-test="issue-label" class="prc-Text-Text-9mHv3">enhancement</span>');
    expect(captureElement(dom.window.document.querySelector('span') as Element).selector).toBe('[data-test="issue-label"]');
  });

  it('does not use a generated class as the primary selector even when it is unique', () => {
    const dom = new JSDOM('<main><span class="prc-Text-Text-9mHv3">enhancement</span></main>');
    const capture = captureElement(dom.window.document.querySelector('span') as Element);
    expect(capture.selector).toBe('span:nth-of-type(1)');
    expect(capture.fallbackSelectors).toEqual([]);
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
    expect(dom.window.document.querySelectorAll(capture.selector)).toHaveLength(1);
    expect(capture.fallbackSelectors).not.toContain('.width-full.d-flex.mt-2');
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

  it('resolves accessible labels and excludes form values from captured attributes', () => {
    const dom = new JSDOM('<label id="account-label">Account token</label><input aria-labelledby="account-label" value="private-token" />');
    const input = dom.window.document.querySelector('input');
    const capture = captureElement(input as Element);
    expect(capture.accessibleName).toBe('Account token');
    expect(capture.attributes).not.toHaveProperty('value');
  });

  it('sends the computed context and an exact selector for a repeated issue label', () => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body><main>
      <article class="issue-row"><h2>Improve browser annotations</h2><div><span class="prc-Text-Text-9mHv3">enhancement</span></div></article>
      <article class="issue-row"><h2>Fix terminal startup</h2><div><span class="prc-Text-Text-9mHv3">enhancement</span></div></article>
    </main></body></html>`, { runScripts: 'dangerously', url: 'https://github.com/Bynzski/clanker/issues' });
    const selected = dom.window.document.querySelector('.issue-row span');
    const directCapture = captureElement(selected as Element);
    expect(dom.window.document.querySelectorAll(directCapture.selector)).toHaveLength(1);
    expect(directCapture.selector).not.toBe('span.prc-Text-Text-9mHv3');
    expect(directCapture.uiRegion).toBe('Improve browser annotations');

    const windowEval = (dom.window as unknown as { eval: (source: string) => unknown }).eval;
    windowEval(generateAnnotationRuntime());
    const runtimeApi = dom.window as Window & { __clankerAnnotationEnable__?: () => void };
    runtimeApi.__clankerAnnotationEnable__?.();
    const MouseEventCtor = (dom.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
    selected?.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
    const note = dom.window.document.querySelector<HTMLTextAreaElement>('#clanker-annotation-note');
    if (note) note.value = 'Make this label easier to see';
    dom.window.document.querySelector('#clanker-annotation-send')?.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));
    const captured = windowEval(generateCaptureCode()) as RawCaptureResult;
    expect(captured).toMatchObject({
      selector: directCapture.selector,
      fallbackSelectors: directCapture.fallbackSelectors,
      uiRegion: 'Improve browser annotations',
      nearbyText: directCapture.nearbyText,
      ancestorContext: directCapture.ancestorContext,
      elementRoleInContext: directCapture.elementRoleInContext,
      note: 'Make this label easier to see',
    });
    const markdown = formatAnnotationMarkdown(mapRawCaptureToAnnotationData(captured));
    expect(markdown).toContain('- UI Region: Improve browser annotations');
    expect(markdown).toContain(`- Primary Selector: \`${directCapture.selector}\``);
    expect(markdown).toContain('Make this label easier to see');
    expect(markdown).not.toContain('not further classified');
    expect(markdown).not.toContain('.clanker-annotation-overlay {');
  });

  it('embeds the DOM helpers in the injected runtime', () => {
    const runtime = generateAnnotationRuntime();

    expect(runtime).toContain('function captureElement');
    expect(runtime).toContain('function buildSelector');
    expect(runtime).toContain('function inferRegionByRoleOrTag');
    expect(runtime).toContain('function inferSectionRegionType');
    expect(runtime).toContain('function isRepositoryLikeText');
    expect(runtime).toContain('function inferCollectionFromRegion');
    expect(runtime).toContain('function inferCollectionByRegionContext');
    expect(runtime).toContain('function inferCollectionByTag');
    expect(runtime).toContain('background: #1a1a1a');
    expect(runtime).toContain('border-radius: 4px');
    expect(runtime).toContain("font-family: var(--font-ui, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace)");
    expect(runtime).not.toContain(':contains(');
  });

  it('runtime capture path does not throw during mousemove', () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><main><button id="save:btn">Save</button></main></body></html>',
      { runScripts: 'dangerously' }
    );
    const runtime = generateAnnotationRuntime();

    const windowEval = (dom.window as unknown as { eval: (source: string) => unknown }).eval;
    expect(() => windowEval(runtime)).not.toThrow();

    const enable = (dom.window as Window & { __clankerAnnotationEnable__?: () => void }).__clankerAnnotationEnable__;
    expect(enable).toBeTypeOf('function');
    enable?.();

    const button = dom.window.document.querySelector('button');
    expect(button).not.toBeNull();

    expect(() => {
      const MouseEventCtor = (dom.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
      const event = new MouseEventCtor('mousemove', { bubbles: true, clientX: 10, clientY: 10 });
      button?.dispatchEvent(event);
    }).not.toThrow();
  });

  it('removes only its own stylesheet when annotation mode closes', () => {
    const dom = new JSDOM('<!doctype html><html><head><style id="site-style">.clanker-annotation-userstyle { color: red; }</style></head><body></body></html>', { runScripts: 'dangerously' });
    const windowEval = (dom.window as unknown as { eval: (source: string) => unknown }).eval;
    windowEval(generateAnnotationRuntime());
    const runtimeApi = dom.window as Window & { __clankerAnnotationEnable__?: () => void };
    runtimeApi.__clankerAnnotationEnable__?.();
    windowEval(generateDisableCode());
    expect(dom.window.document.querySelector('#site-style')).not.toBeNull();
    expect(dom.window.document.querySelectorAll('style')).toHaveLength(1);
  });

  it('executes initialization, hover, selection, copy, and capture in the injected context', () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><main aria-label="Toolbar"><button id="save:btn" data-testid="save-button">Save changes</button></main></body></html>',
      {
        runScripts: 'dangerously',
        url: 'https://example.com/settings',
      }
    );
    const runtime = generateAnnotationRuntime();
    const windowEval = (dom.window as unknown as { eval: (source: string) => unknown }).eval;

    expect(() => windowEval(runtime)).not.toThrow();

    const runtimeApi = dom.window as Window & {
      __clankerAnnotationEnable__?: () => void;
      __clankerAnnotation__?: {
        active: boolean;
        hoveredElement: { selector: string } | null;
        selectedElement: { selector: string } | null;
      };
    };
    runtimeApi.__clankerAnnotationEnable__?.();

    const button = dom.window.document.querySelector('button');
    expect(button).not.toBeNull();

    const MouseEventCtor = (dom.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
    button?.dispatchEvent(new MouseEventCtor('mousemove', { bubbles: true }));

    expect(runtimeApi.__clankerAnnotation__?.active).toBe(true);
    expect(runtimeApi.__clankerAnnotation__?.hoveredElement?.selector).toBe('[data-testid="save-button"]');

    button?.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));

    expect(runtimeApi.__clankerAnnotation__?.selectedElement?.selector).toBe('[data-testid="save-button"]');

    const note = dom.window.document.querySelector<HTMLTextAreaElement>('#clanker-annotation-note');
    expect(note).not.toBeNull();
    if (note) {
      note.value = 'Capture this control';
    }

    const copyButton = dom.window.document.querySelector<HTMLButtonElement>('#clanker-annotation-copy');
    expect(copyButton).not.toBeNull();
    copyButton?.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));

    const captured = windowEval(generateCaptureCode());
    expect(captured).toMatchObject({
      url: 'https://example.com/settings',
      tagName: 'BUTTON',
      selector: '[data-testid="save-button"]',
      note: 'Capture this control',
    });

    button?.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
    const sendButton = dom.window.document.querySelector<HTMLButtonElement>('#clanker-annotation-send');
    expect(sendButton).not.toBeNull();
    sendButton?.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));
    expect(windowEval(generateDrainActionsCode())).toMatchObject({ actions: [
      { type: 'copy', annotation: { selector: '[data-testid="save-button"]' } },
      { type: 'send', annotation: { selector: '[data-testid="save-button"]' } },
    ] });
    expect(windowEval(generateDrainActionsCode())).toEqual({ actions: [], overflowed: false });
    expect(windowEval(generateCaptureCode())).toMatchObject({ selector: '[data-testid="save-button"]' });
  });

  it('keeps separate copy and send snapshots until the next poll', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body><button id="first">First</button><button id="second">Second</button></body></html>', {
      runScripts: 'dangerously', url: 'https://example.com',
    });
    const windowEval = (dom.window as unknown as { eval: (source: string) => unknown }).eval;
    windowEval(generateAnnotationRuntime());
    const runtimeApi = dom.window as Window & { __clankerAnnotationEnable__?: () => void };
    runtimeApi.__clankerAnnotationEnable__?.();
    const MouseEventCtor = (dom.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;

    dom.window.document.querySelector('#first')?.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
    const firstNote = dom.window.document.querySelector<HTMLTextAreaElement>('#clanker-annotation-note');
    if (firstNote) firstNote.value = 'Copy first';
    dom.window.document.querySelector('#clanker-annotation-copy')?.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));

    dom.window.document.querySelector('#second')?.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
    const secondNote = dom.window.document.querySelector<HTMLTextAreaElement>('#clanker-annotation-note');
    if (secondNote) secondNote.value = 'Send second';
    dom.window.document.querySelector('#clanker-annotation-send')?.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));

    expect(windowEval(generateDrainActionsCode())).toMatchObject({ actions: [
      { type: 'copy', annotation: { selector: '#first', note: 'Copy first' } },
      { type: 'send', annotation: { selector: '#second', note: 'Send second' } },
    ] });
  });
});
