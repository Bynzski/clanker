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
