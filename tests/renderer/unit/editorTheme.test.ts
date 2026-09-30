import { describe, expect, it } from 'vitest';
import { Compartment, EditorSelection, EditorState, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { highlightingFor } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';
import { THEME_IDS, getThemeMetadata } from '../../../src/shared/types/theme';
import { getEditorTheme } from '../../../src/renderer/theme/editorTheme';

describe('editor theme contract', () => {
  it.each(THEME_IDS)('resolves %s with UI and syntax highlighting', (theme) => {
    const state = EditorState.create({ extensions: getEditorTheme(theme) });
    expect(state.facet(EditorView.darkTheme)).toBe(getThemeMetadata(theme).colorScheme === 'dark');
    const roles = theme === 'dark' ? [tags.comment, tags.string, tags.number, tags.keyword] : [tags.comment, tags.string, tags.number, tags.bool, tags.null, tags.keyword,
      tags.variableName, tags.function(tags.variableName), tags.typeName, tags.propertyName,
      tags.operator, tags.punctuation, tags.tagName, tags.attributeName, tags.heading, tags.link,
      tags.emphasis, tags.strong];
    for (const role of roles) {
      expect(highlightingFor(state, [role])).toBeTruthy();
    }
  });
  it.each(['light', 'slate'] as const)('provides readable %s UI and syntax foregrounds', (theme) => {
    const parent = document.createElement('div'); document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({ extensions: getEditorTheme(theme) }) });
    const luminance = (color: string) => {
      const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map((n) => {
        const value = n / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    try {
      const background = getComputedStyle(view.dom).backgroundColor;
      expect(background).toBe(theme === 'light' ? 'rgb(243, 244, 246)' : 'rgb(34, 39, 46)');
      for (const role of [tags.comment, tags.string, tags.number, tags.bool, tags.keyword,
        tags.function(tags.variableName), tags.typeName, tags.propertyName, tags.operator, tags.heading, tags.link]) {
        const sample = document.createElement('span'); sample.className = highlightingFor(view.state, [role])!;
        sample.textContent = 'sample'; view.dom.appendChild(sample);
        const foreground = getComputedStyle(sample).color;
        const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a);
        expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
        sample.remove();
      }
    } finally { view.destroy(); parent.remove(); }
  });
  it('retains One Dark and gives callers independent extension lists', () => {
    const dark = getEditorTheme('dark') as unknown[];
    expect(dark).toContain(oneDark);
    dark.length = 0;
    expect(getEditorTheme('dark')).toContain(oneDark);
    const light = getEditorTheme('light') as unknown[];
    light.length = 0;
    expect((getEditorTheme('light') as unknown[]).length).toBeGreaterThan(0);
  });
  it('reconfigures only presentation while retaining document, selection and unrelated state fields', () => {
    const compartment = new Compartment();
    const retainedState = StateField.define({ create: () => ({ edits: ['unsaved edit'] }), update: (value) => value });
    let state = EditorState.create({ doc: 'unsaved document', selection: EditorSelection.range(2, 8),
      extensions: [retainedState, compartment.of(getEditorTheme('dark'))] });
    const doc = state.doc, selection = state.selection, marker = state.field(retainedState);
    for (const theme of ['light', 'slate', 'dark'] as const) {
      const transaction = state.update({ effects: compartment.reconfigure(getEditorTheme(theme)) });
      expect(transaction.docChanged).toBe(false);
      state = transaction.state;
      expect(state.doc).toBe(doc); expect(state.selection).toBe(selection);
      expect(state.field(retainedState)).toBe(marker);
      expect(state.facet(EditorView.darkTheme)).toBe(getThemeMetadata(theme).colorScheme === 'dark');
    }
  });
});
